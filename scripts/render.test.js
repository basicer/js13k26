import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("all entities use model batches without separate transparent draws", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const pipelines = [], draws = [];
	let texture, activePipeline;
	const entity = (id, kind, z, transparency) => {
		const value = new Float32Array(28);
		value.id = id;
		value[0] = kind;
		value[6] = z;
		value[7] = transparency;
		return value;
	};
	const context = vm.createContext({
		d: { createRenderPipeline: descriptor => {
			pipelines.push(descriptor);
			return descriptor;
		} },
		shader: {}, renderBindGroup: {}, vertexBuffer: {}, indexBuffer: {},
		idx: { length: 36 }, ENTITY_COUNT: 16,
		cameraPosition: new Float32Array(3), cameraRotation: new Float32Array(3),
		voxT: Array.from({ length: 256 }, (_, kind) => [0, 1].map(variant => ({ createView: () => kind * 2 + variant }))),
		BG: (pipeline, group, ...views) => views,
		EArray: [
			entity(0, 254, 0, 0), entity(1, 7, -2, 0),
			entity(2, 134, -3, 0.5), entity(3, 129, -8, 0.4),
			entity(4, 134, -12, 1), entity(5, 255, -20, 0),
		],
		pass: {
			setPipeline: value => { activePipeline = value; },
			setBindGroup: (group, value) => { if (group === 1) texture = value; },
			setVertexBuffer() {}, setIndexBuffer() {},
			drawIndexed: (indices, count, first, base, instance) => {
				draws.push({ count, instance, texture, pipeline: activePipeline });
			},
		},
	});
	vm.runInContext(source.slice(source.indexOf("const pipeline ="), source.indexOf("const bloomPipeline =")), context);
	vm.runInContext(source.slice(source.indexOf("\tpass.setBindGroup(0, renderBindGroup)"), source.indexOf("\tpass.end();")), context);
	assert.equal(pipelines.length, 1);
	assert.equal(pipelines[0].fragment.targets[0].blend.color.srcFactor, "src-alpha");
	assert.equal(pipelines[0].depthStencil.depthWriteEnabled, true);
	assert.equal(draws.length, 127);
	assert.ok(draws.every(draw => draw.count === 16));
	assert.deepEqual(draws.map(({ instance, texture }) => [instance >>> 16, texture]),
		Array.from({ length: 127 }, (_, i) => [i + 1, [(i + 1) * 2, (i + 1) * 2 + 1]]));
	assert.ok(draws.every(draw => draw.pipeline === pipelines[0]));
});

test("recycling resets velocity, TTL and model variant in the shared 28-float layout", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	assert.equal(vm.runInContext("ENTITY_DATA_SIZE", context), 28);
	assert.equal(vm.runInContext("const first = spawn(2); first[15]", context), 0);
	vm.runInContext("first[15] = 1; first[24] = .5; first.set([3, 4, 5, -1], 20); first[0] = 255;", context);
	assert.equal(vm.runInContext("spawn(2)[15]", context), 0);
	assert.deepEqual(Array.from(vm.runInContext("first.subarray(20)", context)), [0, 0, 0, Infinity, Math.fround(Math.PI * 2), 0, 0, 0]);
	// WGSL reads the TTL lane as integer bits so infinite lifetimes survive
	// transfer without relying on non-finite GPU floating-point arithmetic.
	assert.equal(vm.runInContext("new Uint32Array(first.buffer, first.byteOffset, 28)[23]", context), 0x7f800000);
	vm.runInContext("const snapshot = entities.slice(); mergeEntityFrame(snapshot, snapshot.slice());", context);
	assert.equal(vm.runInContext("first[23]", context), Infinity);
});

test("GPU readback publishes movement and expiry but preserves concurrent CPU edits and spawns", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext(`
		const particle = spawn(134), edited = spawn(7), dying = spawn(6);
		particle.set([1, 2, 3, .5], 20);
		const submitted = entities.slice(), simulated = submitted.slice();
		simulated[particle.id * 28 + 4] = 12;
		simulated[particle.id * 28 + 23] = .25;
		simulated.fill(0, dying.id * 28, (dying.id + 1) * 28);
		simulated[dying.id * 28] = 255;
		edited[4] = 99;
		const duringFrame = spawn(6);
		duringFrame[23] = .035;
		mergeEntityFrame(submitted, simulated);
	`, context);
	assert.equal(vm.runInContext("particle[4]", context), 12);
	assert.equal(vm.runInContext("particle[23]", context), .25);
	assert.equal(vm.runInContext("edited[4]", context), 99);
	assert.equal(vm.runInContext("duringFrame[0]", context), 6);
	assert.equal(vm.runInContext("dying[0]", context), 255);
	assert.equal(vm.runInContext("spawn(7).id === dying.id", context), true);
});

test("simulation dispatch finishes and merges readback before drawing; pause sends zero dt", async () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const entitySource = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	for (const paused of [false, true]) {
		const calls = [];
		let finishReadback, uploaded;
		const context = vm.createContext({ GenArray: (n, fn) => Array.from({ length: n }, (_, i) => fn(i)) });
		vm.runInContext(entitySource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
		const result = new Float32Array(vm.runInContext("entities.length", context));
		const readback = {
			mapAsync: () => new Promise(resolve => { finishReadback = resolve; calls.push("map"); }),
			getMappedRange: () => result.buffer,
			unmap: () => calls.push("unmap"),
		};
		Object.assign(context, {
			time: 1, deltaTime: .05, c: { width: 800, height: 600 }, cameraFov: 60,
			isPaused: () => paused, renderState: new Float32Array(4), renderStateBuffer: {},
			entityBuffer: {}, entityReadback: readback, simulationPipeline: {}, simulationBindGroup: {},
			GPUMapMode: { READ: 1 },
			Q: { writeBuffer: (_, offset, data) => { uploaded = data; }, submit: () => calls.push("submit") },
			d: { createCommandEncoder: () => ({
				beginComputePass: () => ({ setPipeline() {}, setBindGroup() {},
					dispatchWorkgroups: n => { assert.equal(n, 30); calls.push("dispatch"); }, end() {} }),
				copyBufferToBuffer: () => calls.push("copy"), finish() {},
			}) },
		});
		const operation = vm.runInContext(`(async () => {
			${source.slice(source.indexOf("\trenderState.set("), source.indexOf("\tlet canvasTexture ="))}
		})()`, context);
		assert.deepEqual(calls, ["dispatch", "copy", "submit", "map"]);
		assert.ok(Math.abs(context.renderState[3] - (paused ? 0 : .05)) < 1e-8);
		result.set(uploaded);
		vm.runInContext("EArray[1][4] = 123", context);
		finishReadback();
		await operation;
		assert.equal(calls.at(-1), "unmap");
		assert.equal(vm.runInContext("EArray[1][4]", context), 123);
	}
});

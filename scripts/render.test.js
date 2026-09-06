import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("shader lifetime logic handles forever, exact expiry, overshoot and pause", () => {
	// Execute the actual scalar lifetime block with WGSL literal/type syntax removed.
	const source = readFileSync(new URL("../shaders/compute.wgsl", import.meta.url), "utf8");
	const lifetime = source.slice(source.indexOf("    var entity = input;"), source.indexOf("    entity.pos +="))
		.replace(/(\d+\.\d+)f/g, "$1").replace("Entity()", "({kind: 0, ttl: 0, age: 0})");
	const step = vm.runInNewContext(`(input, dt) => { ${lifetime} return entity; }`);
	assert.equal(step({age: 0, kind: 2, ttl: 0}, 100).kind, 2);
	assert.equal(step({age: 0, kind: 6, ttl: .5}, .25).ttl, .5);
	assert.equal(step({age: 0, kind: 6, ttl: .5}, .25).age, .25);
	assert.equal(step({age: 0, kind: 2, ttl: 0}, 100).age, 100);
	assert.equal(step({age: 0, kind: 6, ttl: .5}, .5).kind, 0);
	assert.equal(step({age: 0, kind: 6, ttl: .5}, 1).kind, 0);
	assert.equal(step({age: 0, kind: 7, ttl: -1}, .01).kind, 0);
	assert.equal(step({age: 0, kind: 6, ttl: .5}, 0).ttl, .5);
	const particle = (age = 0) => ({ age, kind: 6, ttl: 1, spotlight: 0, dissolve: 0 });
	assert.equal(step(particle(), .25).dissolve, .625);
	assert.equal(step(particle(.25), .5).dissolve, .875);
	assert.equal(step({...particle(), kind: 134}, .5).dissolve, .75);
	assert.equal(step(particle(.9), .1).kind, 0);
	assert.equal(step(particle(), 0).dissolve, 0);
	assert.equal(step({...particle(), ttl: 0}, 2).dissolve, 0);
	assert.equal(step({...particle(), spotlight: 5}, .5).dissolve, 0);
	assert.equal(step({...particle(), kind: 7}, .5).dissolve, 0);
});

test("all entities use model batches without separate transparent draws", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const pipelines = [], draws = [];
	let texture, activePipeline;
	const entity = (id, kind, z, transparency) => {
		const value = new Float32Array(32);
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
			entity(4, 134, -12, 1), entity(5, 0, -20, 0),
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

test("recycling resets velocity, TTL and model variant in the shared 32-float layout", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext("setupEntities();", context);
	assert.equal(vm.runInContext("ENTITY_DATA_SIZE", context), 32);
	assert.equal(vm.runInContext("const first = spawn(2); first[15]", context), 0);
	vm.runInContext("first[28] = 1;", context);
	vm.runInContext("first[15] = 1; first[24] = .5; first[25] = 4; first[26] = 1.5; first[27] = 10; first.set([3, 4, 5, -1], 20); first[0] = 0;", context);
	assert.equal(vm.runInContext("spawn(2)[15]", context), 0);
	assert.equal(vm.runInContext("first[28]", context), 0);
	assert.deepEqual(Array.from(vm.runInContext("first.subarray(20)", context)), [0, 0, 0, 0, Math.fround(Math.PI * 2), 0, 0, 0, 0, 0, 0, 0]);
	// WGSL reads the TTL lane as integer bits so infinite lifetimes survive
	// transfer without relying on non-finite GPU floating-point arithmetic.
	assert.equal(vm.runInContext("new Uint32Array(first.buffer, first.byteOffset, 32)[23]", context), 0);
	vm.runInContext("const snapshot = entities.slice(); mergeEntityFrame(snapshot, snapshot.slice());", context);
	assert.equal(vm.runInContext("first[23]", context), 0);
});

test("GPU readback publishes movement and expiry but preserves concurrent CPU edits and spawns", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext("setupEntities();", context);
	vm.runInContext(`
		const particle = spawn(134), edited = spawn(7), dying = spawn(6), actor = spawn(2), reset = spawn(6);
		reset[23] = 5; reset[27] = 4;
		actor[25] = 4; actor[26] = .5;
		particle.set([1, 2, 3, .5], 20);
		const submitted = entities.slice(), simulated = submitted.slice();
		simulated[particle.id * 32 + 4] = 12;
		simulated[particle.id * 32 + 27] = .25;
		simulated[actor.id * 32 + 27] = .25;
		simulated.fill(0, dying.id * 32, (dying.id + 1) * 32);
		simulated[dying.id * 32] = 0;
		edited[4] = 99;
		// CPU damage and walking after submission must beat stale GPU state.
		actor[25] = 3; actor[26] = .75;
		reset[27] = 0;
		const duringFrame = spawn(6);
		duringFrame[23] = .035;
		mergeEntityFrame(submitted, simulated);
	`, context);
	assert.equal(vm.runInContext("particle[4]", context), 12);
	assert.equal(vm.runInContext("particle[23]", context), .5);
	assert.equal(vm.runInContext("particle[27]", context), .25);
	assert.equal(vm.runInContext("actor[27]", context), .25);
	assert.equal(vm.runInContext("reset[27]", context), 0);
	assert.equal(vm.runInContext("edited[4]", context), 99);
	assert.equal(vm.runInContext("actor[25]", context), 3);
	assert.equal(vm.runInContext("actor[26]", context), .75);
	assert.equal(vm.runInContext("duringFrame[0]", context), 6);
	assert.equal(vm.runInContext("dying[0]", context), 0);
	assert.equal(vm.runInContext("spawn(7).id === dying.id", context), true);
});

test("simulation readback does not block rendering and preserves concurrent edits", async () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const entitySource = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const calls = [];
	let finishReadback, uploaded;
	const context = vm.createContext({ GenArray: (n, fn) => Array.from({ length: n }, (_, i) => fn(i)) });
	vm.runInContext(entitySource.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext("setupEntities();", context);
	const result = new Float32Array(vm.runInContext("entities.length", context));
	const readback = {
		mapAsync: () => new Promise(resolve => { finishReadback = resolve; calls.push("map"); }),
		getMappedRange: () => result.buffer,
		unmap: () => calls.push("unmap"),
	};
	Object.assign(context, {
		time: 1, c: { width: 800, height: 600 }, cameraFov: 60,
		pendingSimulationTime: .05, renderState: new Float32Array(8), renderStateBuffer: {},
		entityInputBuffer: {}, spotlightCounterBuffer: {}, spotlightBuffer: {}, entityBuffer: {}, entityReadbacks: [{ buffer: readback, busy: false }], simulationPipeline: {}, simulationBindGroup: {},
		GPUMapMode: { READ: 1 },
		Q: { writeBuffer: (_, offset, data) => { uploaded = data; }, submit: () => calls.push("submit") },
		d: { createCommandEncoder: () => ({
			clearBuffer: () => calls.push("clear"),
			beginComputePass: () => ({ setPipeline() {}, setBindGroup() {},
				dispatchWorkgroups: n => { assert.equal(n, 30); calls.push("dispatch"); }, end() {} }),
			copyBufferToBuffer: () => calls.push("copy"), finish() {},
		}) },
	});
	const frame = source.slice(source.indexOf("\trenderState.set([time"), source.indexOf("\n\tlet canvasTexture ="));
	vm.runInContext(`{${frame}}`, context);
	assert.deepEqual(calls, ["clear", "clear", "dispatch", "copy", "submit", "map"]);
	assert.ok(Math.abs(context.renderState[3] - .05) < 1e-8);
	assert.equal(context.entityReadbacks[0].busy, true);
	result.set(uploaded);
	context.renderState.set([120, 80, 800, 600], 4);
	vm.runInContext(`{${frame}}`, context);
	assert.equal(uploaded.length, 8, "mouse uniforms upload even while the readback is busy");
	assert.deepEqual(Array.from(uploaded.slice(4)), [120, 80, 800, 600]);
	vm.runInContext("EArray[1][4] = 123", context);
	finishReadback();
	await Promise.resolve();
	assert.equal(calls.at(-1), "unmap");
	assert.equal(context.entityReadbacks[0].busy, false);
	assert.equal(vm.runInContext("EArray[1][4]", context), 123);
});

test("crosshair follows canvas-local CSS coordinates and hides on pointer leave", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const listeners = {}, renderState = new Float32Array(8);
	let aim;
	const context = vm.createContext({
		renderState, isPaused: () => false, isFlying: () => false,
		aimMarineAtCursor: (...args) => { aim = args; },
		c: {
			addEventListener: (name, handler) => { listeners[name] = handler; },
			getBoundingClientRect: () => ({ left: 20, top: 30, width: 800, height: 600 }),
		},
	});
	vm.runInContext(source.slice(source.indexOf('c.addEventListener("pointermove"'), source.indexOf("// Bit-packed")), context);
	listeners.pointermove({ clientX: 140, clientY: 110 });
	assert.deepEqual(Array.from(renderState.slice(4)), [120, 80, 800, 600]);
	assert.deepEqual(aim, [120, 80, 800, 600]);
	listeners.pointerleave();
	assert.equal(renderState[4], -1000);
});

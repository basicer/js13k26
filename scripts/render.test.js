import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function entityContext() {
	const context = vm.createContext({ E, GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(readFileSync(new URL("../src/entities.js", import.meta.url), "utf8")
		.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext("setupEntities();", context);
	return context;
}

test("CPU lifetimes handle forever, exact expiry, overshoot, negative TTL and pause", () => {
	const context = entityContext();
	const step = (kind, ttl, dt, age = 0, light = 0) => {
		Object.assign(context, { kind, ttl, dt, age, light });
		return vm.runInContext(`{
			const entity = spawn(kind); entity[23] = ttl; entity[27] = age; entity[1] = light;
			updateEntities(dt); entity;
		}`, context);
	};
	assert.equal(step(2, 0, 100)[0], 2);
	assert.equal(step(2, 0, 100)[27], 100);
	assert.equal(step(6, .5, .25)[27], .25);
	assert.equal(step(6, .5, .5)[0], 0);
	assert.equal(step(6, .5, 1)[0], 0);
	assert.equal(step(7, -1, .01)[0], 0);
	assert.equal(step(6, .5, 0)[23], .5);
	assert.equal(step(6, 1, .25)[3], 0, "TTL alone does not enable dissolve");
});

test("timed particles share gravity and floor settling while tracers keep constant velocity", () => {
	const context = entityContext();
	const result = vm.runInContext(`
		const blood = spawn(134), spark = spawn(6), tracer = spawn(7), still = spawn(6);
		for (const e of [blood, spark, tracer]) { e[5] = 3; e.set([2, 1, -4], 20); }
		blood[19] = 249; blood[23] = spark[23] = 2;
		blood[E.GRAVITY] = spark[E.GRAVITY] = 9;
		updateEntities(.25);
		[blood, spark, tracer, still];
	`, context);
	for (const e of result.slice(0, 3)) assert.deepEqual(Array.from(e.slice(4, 7)), [.5, 3.25, -1]);
	assert.equal(result[0][21], -1.25);
	assert.equal(result[1][21], -1.25);
	assert.equal(result[2][21], 1);
	assert.equal(result[3][21], 0);
	vm.runInContext("blood[5] = -2; updateEntities(.01)", context);
	assert.ok(Math.abs(result[0][5] - (-30 / 64 + .38)) < 1e-6);
	assert.equal(result[0][21], 0);
	const paused = Array.from(result[0]);
	vm.runInContext("updateEntities(0)", context);
	assert.deepEqual(Array.from(result[0]), paused);
});

test("light IDs reflect expiry, toggles, reuse and the 32-light limit even while paused", () => {
	const context = entityContext();
	const run = code => vm.runInContext(code, context);
	run(`entities.fill(0); cameraEntity[0] = 254; cameraEntity[1] = 100;
		const parent = spawn(1), light = spawn(11), expired = spawn(6), inactive = spawn(6);
		light[2] = parent.id; light[1] = 8.4; light[24] = Math.PI / 6;
		expired[1] = 4; expired[23] = .01; inactive[1] = -1;
		updateEntities(.02);`);
	assert.deepEqual(Array.from(run("lightEntities.slice(0, 3)")), [0, run("light.id"), 0xffffffff]);
	assert.equal(run("expired[0]"), 0);
	run("cameraEntity[1] = light[1] = 0; updateEntities(0)");
	assert.ok(Array.from(run("lightEntities")).every(n => n === 0xffffffff));
	run("const recycled = spawn(6); recycled[1] = 5; updateEntities(0)");
	assert.equal(run("lightEntities[0]"), run("expired.id"));
	run("for (let i = 0; i < 40; i++) spawn(6)[1] = 1; updateEntities(0)");
	assert.equal(new Set(Array.from(run("lightEntities"))).size, 32);
	assert.ok(Array.from(run("lightEntities")).every(n => n > 0));
	run("entities.fill(0); updateEntities(0)");
	assert.ok(Array.from(run("lightEntities")).every(n => n === 0xffffffff));
});

test("all entities use model batches without separate transparent draws", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const pipelines = [], draws = [];
	let texture, activePipeline;
	const entity = (id, kind, z, transparency) => {
		const value = new Float32Array(E.STRIDE);
		value.id = id;
		value[0] = kind;
		value[6] = z;
		value[7] = transparency;
		return value;
	};
	const context = vm.createContext({ E,
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
			draw: (vertices, count, first, instance) => {
				assert.equal(vertices, 36);
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

test("recycling resets velocity, TTL and model variant in the generated entity layout", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ E, GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	vm.runInContext("setupEntities();", context);
	assert.equal(vm.runInContext("ENTITY_DATA_SIZE", context), E.STRIDE);
	assert.equal(vm.runInContext("const first = spawn(2); first[15]", context), 0);
	vm.runInContext("first[28] = 1;", context);
	vm.runInContext("first[15] = 1; first[24] = .5; first[25] = 4; first[26] = 1.5; first[27] = 10; first.set([3, 4, 5, -1], 20); first[0] = 0;", context);
	assert.equal(vm.runInContext("spawn(2)[15]", context), 0);
	assert.equal(vm.runInContext("first[28]", context), 0);
	assert.deepEqual(Array.from(vm.runInContext("first.subarray(20, 32)", context)), [0, 0, 0, 0, Math.fround(Math.PI * 2), 0, 0, 0, 0, 0, 0, 0]);
});

test("render uploads current CPU entities and light IDs without compute or readback", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const context = entityContext(), calls = [];
	Object.assign(context, {
		simulationTime: 1, deltaTime: .05, isPaused: () => false,
		c: { width: 800, height: 600 }, cameraFov: 60,
		renderState: new Float32Array(8), renderStateBuffer: "uniforms",
		entityBuffer: "entities", spotlightBuffer: "lights",
		Q: { writeBuffer: (buffer, offset, data) => calls.push([buffer, Array.from(data)]) },
	});
	vm.runInContext("const moving = spawn(6); moving[20] = 2; moving[1] = 3;", context);
	const frame = source.slice(source.indexOf("\tupdateEntities(isPaused()"), source.indexOf("\n\tlet canvasTexture ="));
	vm.runInContext(frame, context);
	assert.deepEqual(calls.map(c => c[0]), ["uniforms", "entities", "lights"]);
	const id = vm.runInContext("moving.id", context);
	assert.ok(Math.abs(calls[1][1][id * E.STRIDE + E.POS_X] - .1) < 1e-6);
	assert.ok(calls[2][1].includes(id));
	context.isPaused = () => true;
	vm.runInContext("moving[1] = 0", context);
	vm.runInContext(frame, context);
	assert.equal(calls[4][1][id * E.STRIDE + E.POS_X], calls[1][1][id * E.STRIDE + E.POS_X]);
	assert.ok(!calls[5][1].includes(id));
	assert.doesNotMatch(source, /beginComputePass|createComputePipeline|entityReadbacks|mergeEntityFrame/);
});

test("crosshair follows canvas-local CSS coordinates and hides on pointer leave", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const listeners = {}, renderState = new Float32Array(8);
	let aim;
	const context = vm.createContext({ E,
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


test("dissolve and gravity properties work on arbitrary kinds, pause, and reset on reuse", () => {
	const context = entityContext();
	const run = code => vm.runInContext(code, context);
	run(`const prop = spawn(7);
		prop[E.DISSOLVE_RATE] = .5; prop[E.DISSOLVE_TARGET] = .25;
		prop[E.GRAVITY] = 4; prop[E.POS_Y] = 10;
		updateEntities(.25);`);
	assert.equal(run("prop[E.DISSOLVE]"), .125);
	assert.equal(run("prop[E.VELOCITY_Y]"), -1);
	run("updateEntities(0)");
	assert.equal(run("prop[E.DISSOLVE]"), .125);
	run("updateEntities(1)");
	assert.equal(run("prop[E.DISSOLVE]"), .25, "partial targets preserve the entity");
	assert.equal(run("prop[E.KIND]"), 7);
	run("prop[E.DISSOLVE_TARGET] = 1; updateEntities(2)");
	assert.equal(run("prop.every(n => n === 0)"), true);
	assert.equal(run("spawn(15) === prop"), true);
	assert.equal(run("prop[E.DISSOLVE_RATE] + prop[E.GRAVITY] + prop[E.WALK_STRIDE]"), 0);
});

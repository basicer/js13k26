import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("one blended pipeline draws opaque types before sorted transparent model aliases", () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const pipelines = [], draws = [];
	let texture, activePipeline;
	const entity = (id, kind, z, transparency) => {
		const value = new Float32Array(20);
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
	const firstTransparent = draws.findIndex(draw => draw.count === 1);
	assert.ok(firstTransparent > 0);
	assert.ok(draws.slice(0, firstTransparent).every(draw => draw.instance >>> 16 < 128));
	assert.deepEqual(draws.slice(firstTransparent).map(({ instance, texture }) => [instance & 65535, instance >>> 16, texture]), [
		[3, 129, [2, 3]], [2, 134, [12, 13]],
	]);
	assert.ok(draws.every(draw => draw.pipeline === pipelines[0]));
});

test("new and recycled entities default to model variant zero in the existing stride", () => {
	const source = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	const context = vm.createContext({ GenArray: (count, fn) => Array.from({ length: count }, (_, i) => fn(i)) });
	vm.runInContext(source.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	assert.equal(vm.runInContext("ENTITY_DATA_SIZE", context), 20);
	assert.equal(vm.runInContext("const first = spawn(2); first[15]", context), 0);
	vm.runInContext("first[15] = 1; first[0] = 255;", context);
	assert.equal(vm.runInContext("spawn(2)[15]", context), 0);
});

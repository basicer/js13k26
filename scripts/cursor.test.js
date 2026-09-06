import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("cursor readback round-trips the shader's 128-unit range at 1/256 precision", async () => {
	const shader = readFileSync(new URL("../shaders/scene.wgsl", import.meta.url), "utf8");
	const fields = [...shader.matchAll(/hit_position\.[xz] \+ ([\d.]+)f\) \* ([\d.]+)f, 0\.0f, ([\d.]+)f/g)];
	assert.equal(fields.length, 2);
	const encode = (value, axis) => {
		const [, offset, scale, maximum] = fields[axis].map(Number);
		return Math.trunc(Math.max(0, Math.min(maximum, (value + offset) * scale)));
	};
	let data;
	const context = vm.createContext({
		entityIndexTexture: {}, c: { width: 100, height: 100 },
		GPUBufferUsage: { COPY_DST: 1, MAP_READ: 2 }, GPUMapMode: { READ: 1 },
		Q: { submit() {} },
		d: {
			createBuffer: () => ({ mapAsync() {}, getMappedRange: () => data.buffer, unmap() {}, destroy() {} }),
			createCommandEncoder: () => ({ copyTextureToBuffer() {}, finish() {} }),
		},
	});
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	vm.runInContext(source.slice(source.indexOf("export async function pickEntity")).replace("export ", ""), context);
	for (const [x,z] of [[-64,-64],[0,0],[63.99609375,63.99609375],[-48.125,52.75],[42.123,-55.123]]) {
		data = new Uint32Array([123, encode(x,0) + encode(z,1)*65536]);
		const [id, decodedX, decodedZ] = await context.pickEntity(50,50);
		assert.equal(id,123);
		assert.ok(Math.abs(decodedX-x) < 1/256);
		assert.ok(Math.abs(decodedZ-z) < 1/256);
	}
	data = new Uint32Array([123, encode(-100,0) + encode(100,1)*65536]);
	assert.deepEqual(Array.from(await context.pickEntity(0,0)), [123,-64,64-1/256]);
	data = new Uint32Array([0xffffffff,0xffffffff]);
	assert.deepEqual(Array.from(await context.pickEntity(0,0)), [-1,-1]);
});

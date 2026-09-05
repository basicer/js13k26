import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { assemble } from "../src/vvm-tools.js";
import * as opcodes from "../src/vvm-const.js";
import { compileVoxelSource } from "../src/debug/voxelValidation.js";
import { voxelInstructionEnds, voxelParameterIndices } from "../src/debug/voxelPrograms.js";
import { vec3, vec3_add } from "../src/math.js";


// Execute the real CPU interpreter with only its GPU upload dependencies mocked.
const source = readFileSync(new URL("../src/vvm.js", import.meta.url), "utf8");
const buildVoxelVariants = vm.runInNewContext(source.slice(source.indexOf("export function buildVoxelVariants"), source.indexOf("// Publish both variants"))
	.replace("export ", "") + "\nbuildVoxelVariants");
const interpreter = source.slice(source.indexOf("export function runByteCode"), source.indexOf("\nbuffers.forEach"))
	.replace("export ", "").replaceAll("import.meta.env.DEBUG", "true");
function run(code, parameters = []) {
	return runBytes(compileVoxelSource(code, parameters), index => parameters[index] ?? 0);
}
function runBytes(bytecode, parameter) {
	const context = vm.createContext({
		...opcodes, vec3, vec3_add, VOXEL_SIZE: 64, DEBUG: true,
		GenArray: (n, fn) => Array.from({ length: n }, fn),
		tex: () => ({}), label: String.raw, buffers: new Map(), flush() {}, voxT: [],
		bytecode, parameter,
	});
	return vm.runInContext(interpreter + "\nbuffers.get(runByteCode(bytecode, parameter))", context, { timeout: 1000 });
}

test("LOADP calls the supplied function with the subopcode on every execution", () => {
	const requested = [];
	const buffer = runBytes(assemble("LOADP:7 FSTORE:MATERIAL LOADP:3 FSTORE:RADIUS SPHERE FSTORE:BRUSH STROKE"), index => {
		requested.push(index);
		return index === 7 ? 14 : 0;
	});
	assert.deepEqual(requested, [7, 3]);
	assert.equal(buffer[0], 14);
});

test("variant builder aliases non-P0 models and builds both P0 values when requested", () => {
	let runs = 0;
	const execute = (code, parameter) => { runs++; return runBytes(code, parameter); };
	const simple = buildVoxelVariants(assemble("88 FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE"), execute);
	assert.equal(runs, 1); assert.equal(simple[0], simple[1]);
	const skipped = buildVoxelVariants(assemble("1 JUMPIF end LOADP end:"), execute);
	assert.equal(runs, 2); assert.equal(skipped[0], skipped[1]);
	const otherParam = buildVoxelVariants(assemble("LOADP:7 FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE"), execute, index => index === 7 ? 19 : 0);
	assert.equal(runs, 3); assert.equal(otherParam[0], otherParam[1]); assert.equal(otherParam[0][0], 19);
	const unicorn = readFileSync(new URL("../vox/unicorn.vp", import.meta.url), "utf8");
	const variants = buildVoxelVariants(assemble(unicorn), execute);
	assert.equal(runs, 5); assert.notEqual(variants[0], variants[1]);
	assert.deepEqual(Buffer.from(variants[0].buffer), Buffer.from(run(unicorn, [0]).buffer));
	assert.deepEqual(Buffer.from(variants[1].buffer), Buffer.from(run(unicorn, [1]).buffer));
});

test("model rebuild retires aliased textures once and preserves old variants on failure", async () => {
	let destroyed = 0;
	const old = { destroy: () => destroyed++ };
	const context = vm.createContext({
		DEBUG: true, voxT: [[old, old]], buffers: new Map([[old, {}]]), empty: {}, cube: {}, sphere: {},
		Q: { onSubmittedWorkDone: () => Promise.resolve() }, buildVoxelVariants,
		runByteCode: (code, load) => { load(0); return { destroy() {} }; },
	});
	vm.runInContext(source.slice(source.indexOf("export function buildModel"), source.indexOf("\n// Load authored models."))
		.replace("export ", ""), context);
	vm.runInContext("buildModel(0, [])", context);
	await Promise.resolve();
	assert.equal(destroyed, 1); assert.equal(context.buffers.has(old), false);
	const previous = context.voxT[0];
	let calls = 0, discarded = 0;
	context.runByteCode = (code, load) => {
		load(0);
		if (++calls === 2) throw Error("variant failed");
		return { destroy: () => discarded++ };
	};
	assert.throws(() => vm.runInContext("buildModel(0, [])", context), /variant failed/);
	assert.equal(context.voxT[0], previous); assert.equal(discarded, 1);
});

test("JUMPIF encodes signed offsets from the end of its two bytes", () => {
	assert.deepEqual([...assemble("1 JUMPIF end 9 FSTORE:0 end:")], [57, 1, 96, 3, 57, 9, 48]);
	assert.deepEqual([...assemble("start: 0 JUMPIF start")], [57, 0, 103, 252]);
	assert.deepEqual([...assemble("0 JUMPIF end end:")], [57, 0, 96, 0]);
});

test("labels respect literal batching, vector fusion, comments and line breaks", () => {
	const bytes = assemble("1 JUMPIF done // branch\n 1 2 3 VEC VSTORE:START done: 4");
	assert.equal(bytes[3], 5);
	assert.deepEqual([...assemble("1 split: 2")], [57, 1, 57, 2]);
	assert.deepEqual([...assemble("1 2 3 VEC vstore: VSTORE:0")], [59, 1, 2, 3, 16, 32]);
	assert.deepEqual([...assemble("0 JUMPIF // target on next line\n end\nend:")], [57, 0, 96, 0]);
});

test("all eleven offset bits and signed range boundaries", () => {
	for (const n of [255, 256, 1023]) {
		const bytes = assemble(`0 JUMPIF end ${"FLOAD ".repeat(n)} end:`);
		assert.equal(bytes[2] & 7, n >> 8);
		assert.equal(bytes[3], n & 255);
	}
	const bytes = assemble(`start: ${"FLOAD ".repeat(1022)} JUMPIF start`);
	assert.deepEqual([...bytes.slice(-2)], [100, 0]);
	assert.throws(() => assemble(`0 JUMPIF end ${"FLOAD ".repeat(1024)} end:`), /out of range/);
	assert.throws(() => assemble(`start: ${"FLOAD ".repeat(1023)} JUMPIF start`), /out of range/);
});

test("bad label references are rejected", () => {
	assert.throws(() => assemble("JUMPIF missing"), /Undefined label/);
	assert.throws(() => assemble("a: a:"), /Duplicate label/);
	assert.throws(() => assemble("JUMPIF"), /requires a label/);
	assert.throws(() => assemble("JUMPIF 123"), /Invalid jump label/);
	assert.throws(() => assemble("JUMPIF:2"), /Use JUMPIF/);
});

test("VM consumes zero and nonzero conditions and uses the remaining stack", () => {
	for (const condition of [0, 1, -2]) {
		const buffer = run(`9 LOADP JUMPIF draw 7 FSTORE:MATERIAL draw:
			FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE`, [condition]);
		assert.equal(buffer[0], 9);
	}
	const code = "LOADP JUMPIF draw 7 FSTORE:MATERIAL draw: BOX FSTORE:BRUSH STROKE";
	assert.equal(run(code, [0])[0], 7);
	assert.equal(run(code, [1])[0], 1);
	assert.equal(run(code, [-2])[0], 1);
});

test("VM executes a backward branch and then falls through", () => {
	const buffer = run("0 1 loop: JUMPIF loop BOX FSTORE:BRUSH STROKE");
	assert.equal(buffer[0], 1);
});

test("VM uses subopcode bits for jumps larger than one byte", () => {
	assert.equal(run(`1 JUMPIF draw ${"FSTORE ".repeat(300)} draw: BOX FSTORE:BRUSH STROKE`)[0], 1);
	assert.equal(run(`0 1 loop: ${"FLOAD FSTORE ".repeat(150)} JUMPIF loop BOX FSTORE:BRUSH STROKE`)[0], 1);
});

test("editor follows branches, validates condition types, and rejects infinite loops", () => {
	assert.doesNotThrow(() => compileVoxelSource("1 JUMPIF end FSTORE end:"));
	assert.throws(() => compileVoxelSource("0 JUMPIF end FSTORE end:"), /Expected a number/);
	assert.throws(() => compileVoxelSource("JUMPIF end end:"), /Expected a number/);
	assert.throws(() => compileVoxelSource("VLOAD JUMPIF end end:"), /Expected a number/);
	assert.throws(() => compileVoxelSource("loop: 1 JUMPIF loop"), /instruction limit/);
});

test("editor counts jump payloads and does not mistake label names for parameters", () => {
	assert.deepEqual(voxelInstructionEnds(assemble("1 JUMPIF end end:")), [0, 2, 4]);
	assert.throws(() => voxelInstructionEnds(new Uint8Array([96])), /Incomplete/);
	assert.deepEqual(voxelParameterIndices("LOADP:3 JUMPIF LOADP LOADP:"), [3]);
});

test("existing voxel programs still compile and retain complete instruction boundaries", () => {
	for (const file of readdirSync(new URL("../vox/", import.meta.url)).filter(name => name.endsWith(".vp"))) {
		const text = readFileSync(new URL(`../vox/${file}`, import.meta.url), "utf8");
		const bytes = compileVoxelSource(text);
		assert.deepEqual(bytes, assemble(text), file);
		assert.equal(voxelInstructionEnds(bytes).at(-1), bytes.length, file);
	}
});

test("unicorn parameter zero swaps opposite hoof poses between sides", () => {
	const source = readFileSync(new URL("../vox/unicorn.vp", import.meta.url), "utf8");
	assert.deepEqual(voxelParameterIndices(source), [0]);
	const standing = run(source, [0]);
	const stride = run(source, [1]);
	const at = (buffer, x, y, z) => buffer[((z * 64 + y) * 64 + x) * 4];
	for (const x of [25, 38]) {
		const planted = x === 25 ? standing : stride;
		const lifted = x === 25 ? stride : standing;
		assert.equal(at(planted, x, 6, 26), 28);
		assert.equal(at(lifted, x, 6, 26), 0);
		assert.equal(at(planted, x, 6, 18), 0);
		assert.equal(at(lifted, x, 6, 18), 28);
		assert.equal(at(planted, x, 6, 44), 28);
		assert.equal(at(lifted, x, 6, 44), 0);
		assert.equal(at(planted, x, 11, 49), 0);
		assert.equal(at(lifted, x, 11, 49), 28);
	}
	for (let z = 0; z < 64; z++) {
		for (let y = 0; y < 64; y++) {
			for (let x = 0; x < 64; x++) {
				assert.equal(at(standing, x, y, z), at(stride, 63 - x, y, z));
				if (y >= 36) assert.equal(at(standing, x, y, z), at(stride, x, y, z));
			}
		}
	}
	assert.deepEqual(Buffer.from(run(source, [-1]).buffer), Buffer.from(stride.buffer));
});

test("FLIP swaps voxels only inside its box on each axis, including empty cells", () => {
	for (const [axis, letter] of ["X", "Y", "Z"].entries()) {
		for (const extent of [3, 4]) {
			const a = [10, 11, 12], b = [...a];
			b[axis] += extent;
			const middle = [...a]; middle[axis] += 2;
			const reflected = [...middle]; reflected[axis] = a[axis] + b[axis] - middle[axis];
			const point = p => `${p.join(" ")} VEC VSTORE:START STROKE`;
			const setup = `SPHERE FSTORE:BRUSH 0 FSTORE:RADIUS
				7 FSTORE:MATERIAL ${point(a)} 9 FSTORE:MATERIAL ${point(b)}
				14 FSTORE:MATERIAL ${point(middle)} ${point([1, 1, 1])}
				${b.join(" ")} VEC VSTORE:START ${a.join(" ")} VEC VSTORE:END`;
			const flipped = run(`${setup} FLIP:${letter}`);
			const at = p => flipped[((p[2] * 64 + p[1]) * 64 + p[0]) * 4];
			assert.equal(at(a), 9); assert.equal(at(b), 7);
			assert.equal(at(reflected), 14); assert.equal(at([1, 1, 1]), 14);
			if (extent === 3) assert.equal(at(middle), 0);
			assert.deepEqual(Buffer.from(run(`${setup} FLIP:${letter} FLIP:${letter}`).buffer), Buffer.from(run(setup).buffer));
		}
	}
	assert.throws(() => compileVoxelSource("FLIP:3"), /Invalid subopcode/);
});

test("marine parts preserve the original shape above the animated lower legs", (t) => {
	const load = name => run(readFileSync(new URL(`../vox/${name}.vp`, import.meta.url), "utf8"));
	const original = load("marine");
	const parts = ["legs", "body", "arms", "gun"].map(name => load(`marine-${name}`));
	let occupied = 0, shapeChanges = 0, materialChanges = 0;
	for (let i = 0; i < original.length; i += 4) {
		if (Math.floor(i / 4 / 64) % 64 < 28) continue;
		const combined = parts.reduce((value, part) => part[i] || value, 0);
		if (original[i] || combined) occupied++;
		if (!!original[i] !== !!combined) shapeChanges++;
		if (original[i] !== combined) materialChanges++;
	}
	t.diagnostic(`${occupied} occupied cells, ${shapeChanges} shape changes, ${materialChanges} material differences at part overlaps`);
	assert.ok(shapeChanges / occupied < 0.01);
	assert.ok(materialChanges / occupied < 0.03);
});

test("marine legs have opposite P0 poses with stable hip attachments", () => {
	const source = readFileSync(new URL("../vox/marine-legs.vp", import.meta.url), "utf8");
	assert.deepEqual(voxelParameterIndices(source), [0]);
	const a = run(source, [0]), b = run(source, [1]);
	let changed = 0;
	for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
		const i = ((z * 64 + y) * 64 + x) * 4;
		assert.equal(a[i], b[((z * 64 + y) * 64 + 63 - x) * 4]);
		if (a[i] !== b[i]) changed++;
		if (y >= 28) assert.equal(a[i], b[i]);
	}
	assert.ok(changed > 100);
});

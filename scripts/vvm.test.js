import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { assemble } from "../src/vvm-tools.js";
import { palette } from "../src/palette.js";
import * as opcodes from "../src/vvm-const.js";
import { compileVoxelSource } from "../src/debug/voxelValidation.js";
import { voxelInstructionEnds, voxelParameterIndices } from "../src/debug/voxelPrograms.js";
import { vec3, vec3_add } from "../src/math.js";


// Execute the real CPU interpreter with only its GPU upload dependencies mocked.
const source = readFileSync(new URL("../src/vvm.js", import.meta.url), "utf8");
const buildVoxelVariants = vm.runInNewContext(source.slice(source.indexOf("export function buildVoxelVariants"), source.indexOf("// Publish both material planes"))
	.replace("export ", "") + "\nbuildVoxelVariants");
const interpreter = source.slice(source.indexOf("export function runByteCode"), source.indexOf("\nif (DEBUG) buffers.forEach"))
	.replace("export ", "").replaceAll("import.meta.env.DEBUG", "true");
function run(code, parameters = []) {
	return runBytes(compileVoxelSource(code, parameters), index => parameters[index] ?? 0);
}
function runBytes(bytecode, parameter, debug = true) {
	const context = vm.createContext({
		...opcodes, vec3, vec3_add, VOXEL_SIZE: 64, DEBUG: debug,
		GenArray: (n, fn) => Array.from({ length: n }, fn),
		tex: () => ({}), label: String.raw, buffers: new Map(), flush(texture, data) { texture.data = data; }, voxT: [],
		bytecode, parameter,
	});
	return vm.runInContext(interpreter + "\nrunByteCode(bytecode, parameter)[1]", context, { timeout: 1000 });
}

test("single-channel release volumes preserve every material in both authored poses", () => {
	for (const name of readdirSync(new URL("../vox/", import.meta.url)).filter(name => name.endsWith(".vp"))) {
		const bytecode = assemble(readFileSync(new URL(`../vox/${name}`, import.meta.url), "utf8"));
		for (const pose of [0, 1]) {
			const parameter = name === "sphere.vp" ? index => index ? 31.5 : 24.32 : () => pose;
			const editor = runBytes(bytecode, parameter), release = runBytes(bytecode, parameter, false);
			assert.equal(editor.length, release.length * 4, name);
			for (let i = 0; i < release.length; i++) {
				assert.equal(release[i], editor[i * 4], `${name}: voxel ${i}`);
				assert.equal(editor[i * 4 + 1] + editor[i * 4 + 2] + editor[i * 4 + 3], 0);
			}
		}
	}
});


test("compact wall program preserves every original voxel and material", () => {
	const code = readFileSync(new URL("../vox/walltile.vp", import.meta.url), "utf8");
	const grid = run(code);
	assert.equal(createHash("sha256").update(new Uint8Array(grid.buffer)).digest("hex"),
		"fcaf7eda8a51c2b897611a128f8ebf640a8d315c3b916a8aa8195a18a0b5250b");
	assert.ok(compileVoxelSource(code, []).length <= 306, "original program used 441 bytes");
});

test("window bulkhead has transparent cyan glass and a continuous steel frame", () => {
	const grid = run(readFileSync(new URL("../vox/wall-window.vp", import.meta.url), "utf8"));
	const at = (x,y,z) => grid[((z*64+y)*64+x)*4];
	for (let x=0; x<64; x++) {
		for (const [y,z] of [[4,4],[32,32],[59,59]]) assert.equal(at(x,y,z),241);
		for (const [y,z] of [[3,32],[60,32],[32,3],[32,60],[0,0],[63,63]]) assert.equal(at(x,y,z),179);
	}
	assert.equal(palette[241 * 4 + 3], 32);
});

test("wooden crate has steel edge bands, parallel inset boards, and one diagonal per face", () => {
	const grid = run(readFileSync(new URL("../vox/wooden-crate.vp", import.meta.url), "utf8"));
	assert.equal(grid.length, 32 ** 3 * 4);
	const at = (x, y, z) => grid[((z * 32 + y) * 32 + x) * 4];
	assert.equal(palette[1024 + 184 * 4], 210, "strap uses a metallic material");
	const materials = new Set();
	for (let i = 0; i < grid.length; i += 4) materials.add(grid[i]);
	assert.deepEqual([...materials].sort((a,b) => a-b), [0, 81, 100, 184, 187]);
	for (const side of [d => d, d => 31-d]) {
		for (const face of [(a,b,d) => at(a,b,side(d)), (a,b,d) => at(side(d),b,a), (a,b,d) => at(b,side(d),a)]) {
			for (let a = 0; a < 2; a++) {
				for (const edge of [[a,15], [31-a,15], [15,a], [15,31-a]])
					assert.equal(face(...edge,0), 184, "steel bands wrap every edge");
			}
			for (const a of [3, 4, 27, 28]) for (const b of [7, 8, 15, 16, 23, 24])
				assert.equal(face(a,b,0), 187, "raised rivets at both ends of every board");
			assert.equal(face(6,15,0), 0, "rivet heads stay small and separate");
			assert.equal(face(2,15,0), 0, "edge bands are narrower than the old frame");
			assert.equal(face(12,12,0), 184, "steel diagonal reaches outer face");
			assert.equal(face(13,12,0), 184, "steel strap spans the diagonal");
			assert.equal(face(14,12,0), 0, "strap is narrower than the old timber brace");
			assert.equal(face(10,21,0), 0, "no second diagonal");
			assert.equal(face(18,7,0), 0, "shallow recess above boards");
			assert.equal(face(18,7,1), 81, "inset board surface");
			assert.equal(face(18,10,1), 0, "open joint between boards");
			assert.equal(face(18,10,2), 100, "backing directly below joint");
			assert.equal(face(10,18,1), 81, "parallel boards have no perpendicular joint");
		}
	}
});

test("wall panel P0 raises the left lever and turns the right screen green", () => {
	const code = readFileSync(new URL("../vox/computer-console.vp", import.meta.url), "utf8");
	const red = run(code, [0]), green = run(code, [1]);
	for (const [grid, hash] of [[red, "b21eb148155f9712b52c85fbc2d18671448c15b364f4a188507d45f9c6f04271"], [green, "c54d16b367f2d38670d6bf00a66c2a2793431d268aafc83d46b430d31c70fa4a"]])
		assert.equal(createHash("sha256").update(new Uint8Array(grid.buffer)).digest("hex"), hash, "console draw reordering preserves every voxel");
	assert.equal(red.length, 40 * 32 * 12 * 4);
	const at = (grid, x, y, z) => grid[((z * 32 + y) * 40 + x) * 4];
	assert.equal(at(red, 8, 7, 10), 2, "ivory grip down");
	assert.equal(at(red, 8, 24, 10), 0);
	assert.equal(at(green, 8, 7, 10), 0);
	assert.equal(at(green, 8, 24, 10), 2, "ivory grip up");
	for (let z = 0; z < 12; z++) for (let y = 0; y < 32; y++) for (let x = 0; x < 40; x++) {
		if (x < 14) assert.equal(at(red, x, y, z), at(green, x, 31-y, z));
		else if (z === 6 && x >= 17 && x <= 34 && y >= 9 && y <= 24) {
			assert.equal(at(red, x, y, z), 243);
			assert.equal(at(green, x, y, z), 244);
		} else assert.equal(at(red, x, y, z), at(green, x, y, z));
	}
	for (const material of [243, 244]) assert.ok(palette[1024 + material * 4 + 2] > 0);
});

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
	const unicorn = readFileSync(new URL("../vox/unicorn-body.vp", import.meta.url), "utf8");
	const variants = buildVoxelVariants(assemble(unicorn), execute);
	assert.equal(runs, 5); assert.notEqual(variants[0], variants[1]);
	assert.deepEqual(Buffer.from(variants[0].buffer), Buffer.from(run(unicorn, [0]).buffer));
	assert.deepEqual(Buffer.from(variants[1].buffer), Buffer.from(run(unicorn, [1]).buffer));
});

test("model rebuild retires the old texture once and preserves it on failure", async () => {
	let destroyed = 0;
	const old = { destroy: () => destroyed++ };
	const context = vm.createContext({
		DEBUG: true, voxT: [old], buffers: new Map([[old, {}]]), empty: {}, cube: {}, sphere: {}, flush() {},
		Q: { onSubmittedWorkDone: () => Promise.resolve() }, buildVoxelVariants,
		tex: () => ({ destroy() {} }),
		uploadModel: () => ({ destroy() {} }),
		runByteCode: (code, load) => { load(0); return [[1, 1, 1], new Uint8Array(1)]; },
	});
	vm.runInContext(source.slice(source.indexOf("export function buildModel"), source.indexOf("\n// Load authored models."))
		.replace("export ", "").replaceAll("import.meta.env.DEBUG", "true"), context);
	vm.runInContext("buildModel(0, [])", context);
	await Promise.resolve();
	assert.equal(destroyed, 1); assert.equal(context.buffers.has(old), false);
	const previous = context.voxT[0];
	let calls = 0, allocated = 0;
	context.uploadModel = () => { allocated++; return { destroy() {} }; };
	context.runByteCode = (code, load) => {
		load(0);
		if (++calls === 2) throw Error("variant failed");
		return [[1, 1, 1], new Uint8Array(1)];
	};
	assert.throws(() => vm.runInContext("buildModel(0, [])", context), /variant failed/);
	assert.equal(context.voxT[0], previous); assert.equal(allocated, 0, "failed poses allocate no GPU textures");
});

test("JUMPIF encodes signed offsets from the end of its two bytes", () => {
	assert.deepEqual([...assemble("1 JUMPIF end 9 FSTORE:0 end:")], [57, 1, 96, 3, 57, 9, 48]);
	assert.deepEqual([...assemble("start: 0 JUMPIF start")], [57, 0, 103, 252]);
	assert.deepEqual([...assemble("0 JUMPIF end end:")], [57, 0, 96, 0]);
});

test("FORJUMP checks stack occupancy without consuming or testing the top value", () => {
	assert.deepEqual([...assemble("FORJUMP end end:")], [0, 0]);
	assert.deepEqual(voxelInstructionEnds(assemble("FORJUMP end end:")), [0, 2]);
	assert.equal(run("FORJUMP end 9 FSTORE:MATERIAL end: BOX FSTORE:BRUSH STROKE")[0], 9);
	for (const value of [0, -1, 9])
		assert.equal(run(`${value} FORJUMP end 7 FSTORE:MATERIAL end: FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE`)[0], value & 255);
	assert.equal(run("2 3 4 VEC FORJUMP end 9 FSTORE:MATERIAL end: VSTORE:START 0 FSTORE:RADIUS SPHERE FSTORE:BRUSH STROKE")[(4 * 64 * 64 + 3 * 64 + 2) * 4], 1);
	let visits = 0;
	runBytes(compileVoxelSource("1 2 3 each: FSTORE:7 LOADP:7 FSTORE:6 FORJUMP each"), () => { visits++; return 0; });
	assert.equal(visits, 3);
	assert.throws(() => assemble("FORJUMP absent"), /Undefined label/);
	assert.throws(() => assemble("FORJUMP"), /requires a label/);
	assert.throws(() => compileVoxelSource("0 again: FORJUMP again"), /infinite loop/);
	assert.throws(() => assemble(`FORJUMP end ${"FLOAD ".repeat(1024)} end:`), /out of range/);
	assert.deepEqual(voxelParameterIndices("FORJUMP loadp loadp:"), []);
});

test("removed counted LOOP instructions are rejected", () => {
    assert.throws(() => assemble("1 LOOP again again:"));
    assert.throws(() => compileVoxelSource("1 LOOP again again:"));
});

test("labels respect literal batching, vector fusion, comments and line breaks", () => {
	const bytes = assemble("1 JUMPIF done // branch\n 1 2 3 VEC VSTORE:START done: 4");
	assert.equal(bytes[3], 4);
	assert.deepEqual([...assemble("1 split: 2")], [57, 1, 57, 2]);
	assert.deepEqual([...assemble("1 2 3 VEC vstore: VSTORE:0")], [59, 1, 2, 3, 16, 32]);
	assert.deepEqual([...assemble("0 JUMPIF // target on next line\n end\nend:")], [57, 0, 96, 0]);
});

test("SIZE creates compact volumes and literal payloads are signed bytes", () => {
	const buffer = run("8 6 4 VEC SIZE -7 FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE");
	assert.equal(buffer.length, 8 * 6 * 4 * 4);
	assert.equal(buffer[0], 249);
	assert.deepEqual([...assemble("-1")], [57, 255]);
	assert.throws(() => compileVoxelSource("-1 1 1 VEC SIZE"), /Model size/);
	assert.throws(() => compileVoxelSource("128"), /Literal out of range/);
});

test("immediate vectors occupy four bytes and editor stepping skips their payloads", () => {
	for (let register = 0; register < 8; register++) {
		const bytes = assemble(`VSTOREI:${register} -128 88 127`);
		assert.deepEqual([...bytes], [(opcodes.OP_VSTOREI << 3) | register, 128, 88, 127]);
		assert.deepEqual(voxelInstructionEnds(bytes), [0, 4]);
		assert.throws(() => voxelInstructionEnds(bytes.slice(0, 3)), /Incomplete/);
	}
	assert.deepEqual([...assemble("STROKEI -1 88 96")], [(opcodes.OP_STROKEI << 3) | 2, 255, 88, 96]);
	assert.deepEqual(assemble("STROKEI 1 2 3"), assemble("1 2 3 VEC VSTORE:END STROKE:SWAP"));
	assert.throws(() => compileVoxelSource("STROKEI:PAINT 1 2 3"), /always swaps/);
	assert.throws(() => compileVoxelSource("STROKEI 1 2"), /missing immediate/);
	assert.throws(() => compileVoxelSource("VSTOREI 64 0 0"), /declared model size/);
});

test("high-resolution railing keeps polished steel below its frequent caution bands", () => {
 const rail = run(readFileSync(new URL("../vox/railing.vp", import.meta.url), "utf8"));
 assert.equal(rail.length, 128 * 64 * 16 * 4);
 const at = (x,y,z) => rail[((z * 64 + y) * 128 + x) * 4];
 assert.equal(at(64,15,8),0);
 assert.equal(at(64,47,8),0);
 assert.equal(at(0,15,8),188);
 assert.equal(at(64,31,8),188);
 for(let x=4;x<64;x+=8) { assert.equal(at(x,61,8),5); assert.equal(at(127-x,61,8),5); }
 for(let x=0;x<64;x+=8) { assert.equal(at(x,61,8),242); assert.equal(at(127-x,61,8),242); }
 for(let y=0;y<64;y++) for(let z=0;z<16;z++) assert.equal(!!at(0,y,z),!!at(127,y,z));
});

test("fusion preserves stack prefixes, dynamic vectors and branch entry points", () => {
	const code = "9 8 7 6 5 4 3 2 1 2 3 VEC VSTORE:START FSTORE:MATERIAL STROKEI 4 5 6 STROKEI 7 8 9";
	assert.deepEqual(Buffer.from(run(code).buffer), Buffer.from(run(code.replaceAll("VEC", "barrier: VEC").replace("STROKEI 4 5 6", "4 5 6 stop: VEC VSTORE:END STROKE:SWAP")).buffer));
	assert.equal(run("LOADP 2 3 VEC VSTORE:START 0 FSTORE:RADIUS SPHERE FSTORE:BRUSH STROKE", [1.5]).some(Boolean), false);
	assert.deepEqual([...assemble("1 2 3 VEC boundary: VSTORE:END STROKE:SWAP")], [59, 1, 2, 3, 16, 33, 10]);
	assert.doesNotThrow(() => compileVoxelSource("0 JUMPIF strokei 1 2 3 VEC VSTORE:START strokei:"));
});

test("fused and unfused programs produce identical voxels for every model and pose", () => {
	for (const file of readdirSync(new URL("../vox/", import.meta.url)).filter(file => file.endsWith(".vp"))) {
		const source = readFileSync(new URL(`../vox/${file}`, import.meta.url), "utf8");
		let label = 0;
		const unfused = source.replace(/\bVEC\b/g, () => `fusion_barrier_${label++}: VEC`);
		for (const pose of [0, 1])
			assert.deepEqual(Buffer.from(run(source, [pose]).buffer), Buffer.from(run(unfused, [pose]).buffer), `${file}, pose ${pose}`);
	}
});

for (const DEBUG of [false, true]) test(`wall rebuilds preserve independent door textures (DEBUG=${DEBUG})`, async () => {
	const old = { destroy() {} };
	const context = vm.createContext({
		DEBUG, voxT: Array.from({ length: 20 }, () => old), buffers: new Map([[old, {}]]), flush() {},
		empty: {}, cube: {}, sphere: {}, Q: { onSubmittedWorkDone: () => Promise.resolve() },
		tex: () => ({ destroy() {} }),
		buildVoxelVariants, runByteCode: () => [[1, 1, 1], new Uint8Array(1)],
		uploadModel: () => ({ destroy() {} }),
	});
	vm.runInContext(source.slice(source.indexOf("export function buildModel"), source.indexOf("\n// Load authored models."))
		.replace("export ", "").replaceAll("import.meta.env.DEBUG", "true"), context);
	const door = vm.runInContext("buildModel(19, [])", context);
	const first = vm.runInContext("buildModel(7, [])", context);
	assert.equal(context.voxT[19], door);
	assert.equal(context.voxT[7], first);
	const second = vm.runInContext("buildModel(7, [])", context);
	assert.notEqual(first, second);
	assert.equal(context.voxT[19], door);
	if (DEBUG) {
		context.runByteCode = () => { throw Error("bad tile"); };
		assert.throws(() => vm.runInContext("buildModel(7, [])", context), /bad tile/);
		assert.equal(context.voxT[7], second);
		assert.equal(context.voxT[19], door);
	}
	await Promise.resolve();
});

test("embedded numeric arrays match typed bytecode for every model and pose", () => {
	for (const file of readdirSync(new URL("../vox/", import.meta.url)).filter(file => file.endsWith(".vp"))) {
		const source = readFileSync(new URL(`../vox/${file}`, import.meta.url), "utf8");
		const bytes = assemble(source);
		const embedded = JSON.parse(JSON.stringify([...bytes]));
		assert.deepEqual(embedded, [...bytes]);
		for (const pose of [0, 1])
			assert.deepEqual(Buffer.from(runBytes(embedded, () => pose).buffer),
				Buffer.from(runBytes(bytes, () => pose).buffer), `${file}, pose ${pose}`);
	}
});

test("SIZE_128 allocates full-size axes while ordinary literals remain signed", () => {
	const buffer = run("SIZE_128 SIZE_128 32 VEC SIZE BOX FSTORE:BRUSH 127 127 31 VEC VSTORE:START VLOAD:START VSTORE:END STROKE");
	assert.equal(buffer.length, 128 * 128 * 32 * 4);
	assert.equal(buffer[buffer.length - 4], 1);
	assert.equal(run("SIZE_128 FSTORE:MATERIAL BOX FSTORE:BRUSH STROKE")[0], 128);
});

test("G&G logo is one connected angular sign with a single emissive material", () => {
 const logo = run(readFileSync(new URL("../vox/gg-logo.vp", import.meta.url), "utf8"));
 assert.equal(logo.length, 128 * 128 * 32 * 4);
 const materials = new Set(), occupied = new Set();
 let minZ = 32, maxZ = 0, bottom = Infinity;
 for (let i = 0; i < logo.length; i += 4) {
  if (!logo[i]) continue;
  materials.add(logo[i]); occupied.add(i / 4);
  const y = Math.floor(i / 4 / 128) % 128, z = Math.floor(i / 4 / 16384);
  minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  for (const dz of [0, 1])
   bottom = Math.min(bottom, .894 + Math.cos(-.32) * (y / 128 - .5) * 5.25 - Math.sin(-.32) * ((z + dz) / 32 - .5) * 1.3);
 }
 assert.deepEqual([...materials], [216]);
 assert.ok(maxZ - minZ >= 4, "rounded strokes have real depth");
 assert.ok(Math.abs(bottom + 30 / 64) < .001, "lowest tilted voxel rests on the floor");
 const queue = [occupied.values().next().value]; occupied.delete(queue[0]);
 for (let head = 0; head < queue.length; head++) {
  const i = queue[head], x = i % 128, y = Math.floor(i / 128) % 128, z = Math.floor(i / 16384);
  for (const n of [x > 0 ? i - 1 : -1, x < 127 ? i + 1 : -1, y > 0 ? i - 128 : -1, y < 127 ? i + 128 : -1, z > 0 ? i - 16384 : -1, z < 31 ? i + 16384 : -1])
   if (occupied.delete(n)) queue.push(n);
 }
 assert.equal(occupied.size, 0, "every occupied voxel belongs to the connected G&G");
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
	const source = readFileSync(new URL("../vox/unicorn-body.vp", import.meta.url), "utf8");
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

test("split unicorn retains every original voxel and material in both walking poses", () => {
	const read = file => readFileSync(new URL(file, import.meta.url), "utf8");
	const headSource = read("../vox/unicorn-head.vp");
	const head = run(headSource);
	assert.deepEqual(Buffer.from(head.buffer), Buffer.from(run(headSource, [1]).buffer), "head has no walking variant");
	for (const pose of [0, 1]) {
		const body = run(read("../vox/unicorn-body.vp"), [pose]);
		const original = run(read("./fixtures/unicorn-original.vp"), [pose]);
		for (let i = 0; i < original.length; i += 4)
			assert.equal(head[i] || body[i], original[i], `pose ${pose}, voxel ${i / 4}`);
	}
});

test("FLIP reflects the whole volume on each axis and preserves the cursor", () => {
    for (const [axis, letter] of ["X", "Y", "Z"].entries()) {
        const setup = "SPHERE FSTORE:BRUSH 0 FSTORE:RADIUS 9 FSTORE:MATERIAL 1 2 3 VEC VSTORE:START STROKE";
        const before = run(setup), flipped = run(setup + " FLIP:" + letter);
        for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
            const p = [x,y,z]; p[axis] = 63 - p[axis];
            assert.equal(flipped[((z*64+y)*64+x)*4], before[((p[2]*64+p[1])*64+p[0])*4]);
        }
        assert.deepEqual(Buffer.from(run(setup + " FLIP:" + letter + " FLIP:" + letter).buffer), Buffer.from(before.buffer));
        assert.equal(run(setup + " FLIP:" + letter + " 7 FSTORE:MATERIAL STROKE")[((3*64+2)*64+1)*4], 7);
    }
    assert.throws(() => compileVoxelSource("FLIP:3"), /Invalid subopcode/);
});

test("sphere program exactly matches the original procedural particle volume", () => {
	const actual = run(readFileSync(new URL("../vox/sphere.vp", import.meta.url), "utf8"), [24.32, 31.5]);
	const expected = new Float32Array(64 ** 3 * 4);
	for (let z = 0; z < 64; z++) for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
		if ((x - 31.5) ** 2 + (y - 31.5) ** 2 + (z - 31.5) ** 2 <= (64 * 0.38) ** 2)
			expected[((z * 64 + y) * 64 + x) * 4] = 20;
	}
	assert.deepEqual(Buffer.from(actual.buffer), Buffer.from(expected.buffer));
});

test("marine gun uses a compact voxel volume", () => {
	const gun = run(readFileSync(new URL("../vox/marine-gun.vp", import.meta.url), "utf8"));
	assert.equal(gun.length, 16 * 20 * 32 * 4);
	assert.ok(gun.some(value => value !== 0));
});

test("high-resolution portal preserves all six bands and the recessed rainbow core", () => {
	const portal = run(readFileSync(new URL("../vox/unicorn-portal.vp", import.meta.url), "utf8"));
	assert.equal(portal.length, 120 * 120 * 8 * 4);
	assert.equal(portal[((4 * 120 + 68) * 120 + 60) * 4], 255);
	const bands = [15, 19, 22, 26, 30, 34].map(x => portal[((4 * 120 + 60) * 120 + x) * 4]);
	assert.deepEqual(bands, [218, 223, 228, 225, 232, 221]);
	for (const material of bands) assert.ok(palette[1024 + material * 4 + 2] > 0);
});

test("editor validates coordinates against each model's declared dimensions", () => {
	assert.doesNotThrow(() => compileVoxelSource("120 120 8 VEC SIZE 119 119 7 VEC VSTORE:START"));
	assert.throws(() => compileVoxelSource("120 120 8 VEC SIZE 120 119 7 VEC VSTORE:START"), /model size/);
	assert.throws(() => compileVoxelSource("120 120 8 VEC SIZE 119 119 8 VEC VSTORE:START"), /model size/);
	assert.throws(() => compileVoxelSource("64 0 0 VEC VSTORE:START"), /model size/);
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

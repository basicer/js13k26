import { GenArray, label, d, Q, c } from "./globals.js";
import { vec3, vec3_add } from "./math.js";
import {
	COMMAND_NAMES,
	OP_MIRROR,
	OP_FLIP,
	OP_PUSHI,
	OP_STROKE,
	OP_VEC,
	OP_VLOAD,
	OP_VSTORE,
	OP_VSTORE3,
	OP_FLOAD,
	OP_FSTORE,
	OP_LOADP,
	OP_JUMPIF,
} from "./vvm-const.js";
const VOXEL_SIZE = 64;

const tex = (name, size = [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE]) => {
	let t = d.createTexture({
		"label": label`${name} voxel texture`,
		"size": size,
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	t.ROB_SIZE = size;
	return t;
};

let buffers = new Map();
const empty = tex("Empty");
buffers.set(empty, new Float32Array(VOXEL_SIZE ** 3 * 4));

export var cube = tex(label`cube`);
buffers.set(cube, new Float32Array(VOXEL_SIZE ** 3 * 4).fill(1));

const sphereCenter = (VOXEL_SIZE - 1) / 2;
const sphereRadius = VOXEL_SIZE * 0.38;

export var sphere = tex("sphere");
const sphereVoxels = new Float32Array(VOXEL_SIZE ** 3 * 4);
// Walk the flat texture once; recover the three voxel coordinates.
for (let i = 0; i < VOXEL_SIZE ** 3; i++) {
	const dx = i % VOXEL_SIZE - sphereCenter;
	const dy = (i / VOXEL_SIZE | 0) % VOXEL_SIZE - sphereCenter;
	const dz = (i / VOXEL_SIZE ** 2 | 0) - sphereCenter;
	if (Math.hypot(dx, dy, dz) <= sphereRadius) sphereVoxels[i * 4] = 20;
}
buffers.set(sphere, sphereVoxels);

export var voxT = GenArray(256, () => [empty, empty]);

voxT[2] = [cube, cube];
voxT[6] = [sphere, sphere];
voxT[7] = [cube, cube]; // Arena fallback until the metallic wall program loads.

export const flush = (texture) => {
	Q.writeTexture(
		{ "texture": texture },
		buffers.get(texture),
		{
			"bytesPerRow": texture.ROB_SIZE[0] * 4 * 4,
			"rowsPerImage": texture.ROB_SIZE[1],
		},
		texture.ROB_SIZE,
	);
};

if (DEBUG && import.meta.env.DEBUG) {
	let { ddsVolume } = await import("./dds.js");

	[
		"../dds/Projector.dds.gz",
		//"../dds/FloorTile-LR01.dds.gz",
		//"../dds/FloorTile-S04.dds.gz",
	].map(async (dds, i) => {
		let { size, voxels } = await ddsVolume(
			(await import(dds)).default,
			true,
		);
		var T = tex("projector", size);
		if (voxels) buffers.set(T, voxels);
		voxT.map((texture, kind) => {
			if (kind == i + 3) voxT[kind] = [T, T];
		});
		flush(T);
	});
}

/**
 *
 * RESITERS:
 * FLOAT [ PALETTE, BRUSH, BRUSH_ARG ]
 * VEC   [ CURSOR, PREV_CURSOR ]
 *
 * @param {*} bytecode
 * @param {function(number): number} parameter Called by LOADP with its subopcode.
 */

export function runByteCode(bytecode, parameter = () => 0) {
	let pc = 0;
	let size = vec3(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
	let buffer = new Float32Array(VOXEL_SIZE ** 3 * 4);

	let reg_vec = GenArray(8, () => vec3());
	reg_vec[7] = vec3_add(size, vec3(-1, -1, -1));
	let reg_float = [1, 2, 5, 0, 0, 0, 0, 0];
	let stack = [];

	while (pc < bytecode.length) {
		let cmd = bytecode[pc++];
		switch (cmd >> 3) {
			case OP_JUMPIF: {
				// Signed 11-bit byte offset, relative to the end of this instruction.
				const offset = (((cmd & 7) << 8 | bytecode[pc++]) << 21) >> 21;
				if (stack.pop() !== 0) pc += offset;
				break;
			}
			case OP_STROKE: {
				// Flags: 1 paints occupied cells only; 2 swaps endpoints after drawing.
				let a = reg_vec[0],
					b = reg_vec[1],
					brush = reg_float[1],
					r = reg_float[2],
					lo = [],
					hi = [];
				for (let i = 3; i--;) {
					let pad = brush == 1 ? 0 : r,
						min = brush ? Math.min(a[i], b[i]) : a[i],
						max = brush ? Math.max(a[i], b[i]) : a[i];
					lo[i] = Math.max(reg_vec[6][i], Math.ceil(min - pad));
					hi[i] = Math.min(reg_vec[7][i], Math.floor(max + pad));
				}
				let abx = b[0] - a[0],
					aby = b[1] - a[1],
					abz = b[2] - a[2],
					rr = r * r,
					length = abx * abx + aby * aby + abz * abz || 1;
				for (let z = lo[2]; z <= hi[2]; z++)
					for (let y = lo[1]; y <= hi[1]; y++)
						for (let x = lo[0]; x <= hi[0]; x++) {
							let dx = x - a[0],
								dy = y - a[1],
								dz = z - a[2],
								hit = brush == 1;
							if (brush == 0)
								hit = dx * dx + dy * dy + dz * dz <= rr;
							if (brush == 1) hit = true;
							if (brush == 2) {
								let t = Math.max(
									0,
									Math.min(
										1,
										(dx * abx + dy * aby + dz * abz) /
											length,
									),
								);
								dx -= abx * t;
								dy -= aby * t;
								dz -= abz * t;
								hit = dx * dx + dy * dy + dz * dz <= rr;
							}
							let index = ((z * size[1] + y) * size[0] + x) * 4;
							if (hit && (!(cmd & 1) || buffer[index]))
								buffer[index] = reg_float[0];
						}
				if (cmd & 2) {
					reg_vec[0] = b;
					reg_vec[1] = a;
				}
				break;
			}
			case OP_PUSHI: {
				GenArray(cmd & 7, () => stack.push(bytecode[pc++]));
				break;
			}
			case OP_VEC:
			case OP_VSTORE3: {
				let z = stack.pop(),
					y = stack.pop(),
					x = stack.pop();
				let v = vec3(x, y, z);
				if (cmd >> 3 === OP_VEC) stack.push(v);
				else reg_vec[cmd & 7] = v;
				break;
			}
			case OP_VLOAD: {
				let val = reg_vec[cmd & 7];
				stack.push(val);
				break;
			}
			case OP_VSTORE: {
				let val = stack.pop();
				reg_vec[cmd & 7] = val;
				break;
			}
			case OP_FLOAD: {
				let val = reg_float[cmd & 7];
				stack.push(val);
				break;
			}
			case OP_FSTORE: {
				let val = stack.pop();
				reg_float[cmd & 7] = val;
				break;
			}
			case OP_LOADP: {
				stack.push(parameter(cmd & 7));
				break;
			}
			case OP_FLIP:
			case OP_MIRROR: {
				const flip = cmd >> 3 === OP_FLIP;
				const axis = cmd & 7;
				const a = reg_vec[flip ? 0 : 6], b = reg_vec[flip ? 1 : 7];
				const lo = flip ? a.map((v, i) => Math.ceil(Math.min(v, b[i]))) : [...a];
				const hi = flip ? a.map((v, i) => Math.floor(Math.max(v, b[i]))) : b;
				const sum = flip ? lo[axis] + hi[axis] : size[axis] - 1;
				lo[axis] = Math.max(lo[axis], Math.floor(sum / 2) + 1);
				for (let z = lo[2]; z <= hi[2]; z++)
					for (let y = lo[1]; y <= hi[1]; y++)
						for (let x = lo[0]; x <= hi[0]; x++) {
							const sx = axis === 0 ? sum - x : x;
							const sy = axis === 1 ? sum - y : y;
							const sz = axis === 2 ? sum - z : z;
							const target = ((z * size[1] + y) * size[0] + x) * 4;
							const source = ((sz * size[1] + sy) * size[0] + sx) * 4;
							for (let channel = 0; channel < (flip ? 4 : 1); channel++) {
								const value = buffer[target + channel];
								buffer[target + channel] = buffer[source + channel];
								if (flip) buffer[source + channel] = value;
							}
						}
				break;
			}
		}
	}

	let result = tex(label`Worked`);
	buffers.set(result, buffer);
	flush(result);
	return result;
}

buffers.forEach((_, texture) => flush(texture));

import marineLegs, { debugSource as legsSource } from "../vox/marine-legs.vp";
import marineBody, { debugSource as bodySource } from "../vox/marine-body.vp";
import marineArms, { debugSource as armsSource } from "../vox/marine-arms.vp";
import marineGun, { debugSource as gunSource } from "../vox/marine-gun.vp";
import program2, { debugSource as source2 } from "../vox/unicorn.vp";
import program3, { debugSource as source3 } from "../vox/floortile.vp";
import program4, { debugSource as source4 } from "../vox/walltile.vp";

let wait = (n) => new Promise((resolve) => setTimeout(resolve, n));

// Discover P0 usage through actual LOADP calls, not by scanning payload bytes.
export function buildVoxelVariants(bytecode, run, parameter = () => 0) {
	let usesP0 = false, p0 = 0;
	const load = index => index === 0 ? (usesP0 = true, p0) : parameter(index);
	const first = run(bytecode, load);
	p0 = 1;
	return [first, usesP0 ? run(bytecode, load) : first];
}

// Publish both variants together, then retire each old texture only once.
export function buildModel(slot, bytecode, parameter = () => 0) {
	// Release builds load each model once; texture retirement is editor-only.
	if (!DEBUG) return voxT[slot] = buildVoxelVariants(bytecode, runByteCode, parameter);
	const previous = voxT[slot];
	const created = [];
	let variants;
	try {
		variants = buildVoxelVariants(bytecode, (code, load) => {
			const texture = runByteCode(code, load);
			created.push(texture);
			return texture;
		}, parameter);
	} catch (error) {
		for (const texture of created) { buffers.delete(texture); texture.destroy(); }
		throw error;
	}
	voxT[slot] = variants;
	for (const texture of new Set(previous)) {
		if (texture !== empty && texture !== cube && texture !== sphere) {
			buffers.delete(texture);
			Q.onSubmittedWorkDone().then(() => texture.destroy());
		}
	}
	return variants;
}

// Load authored models.
{
	const models = [
		[8, marineLegs, legsSource],
		[9, marineBody, bodySource],
		[10, marineArms, armsSource],
		[11, marineGun, gunSource],
		[2, program2, source2],
		[5, program3, source3],
		[7, program4, source4],
	];
	// Kind 1 stays empty: it is the marine's gameplay and transform root.
	for (const [slot, program] of models) {
		if (DEBUG) await wait(1);
		buildModel(slot, Uint8Array.fromBase64(program));
	}
	if (DEBUG && import.meta.env.DEBUG) {
		const { registerVoxelProgram } = await import("./debug/voxelPrograms.js");
		for (const [slot, , source] of models) {
			registerVoxelProgram(slot, source, (bytecode, parameters) => {
				return buildModel(slot, bytecode, index => parameters[index] ?? 0);
			});
		}
	}
}

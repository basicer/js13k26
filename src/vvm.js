import { GenArray, d, Q, c } from "./globals.js";
import {
	COMMAND_NAMES,
	OP_MIRROR,
	OP_FLIP,
	OP_PUSHI,
	OP_STROKE,
	OP_VEC,
	OP_VLOAD,
	OP_VSTORE,
	OP_VSTOREI,
	OP_STROKEI,
	OP_FLOAD,
	OP_FSTORE,
	OP_LOADP,
	OP_JUMPIF,
	OP_LOOP,
	OP_FORJUMP,
	OP_SIZE,
} from "./vvm-const.js";
const VOXEL_SIZE = 64;

const tex = (size = [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE]) => {
	let t = d.createTexture({
		"size": size,
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	});
	t.ROB_SIZE = size;
	return t;
};

let buffers = new Map();
const empty = tex();
if (DEBUG) buffers.set(empty, new Float32Array(VOXEL_SIZE ** 3 * 4));

export var cube = DEBUG ? tex() : empty;
if (DEBUG) buffers.set(cube, new Float32Array(VOXEL_SIZE ** 3 * 4).fill(1));

export var voxT = GenArray(256, () => [empty, empty]);

// Only the editor needs fallback cubes; release models finish loading before rendering.
if (DEBUG) voxT[2] = voxT[7] = [cube, cube];

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
		let { size, voxels } = await ddsVolume((await import(dds)).default, true);
		var T = tex(size);
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
	let size = [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE];
	let buffer = new Float32Array(VOXEL_SIZE ** 3 * 4);

	let reg_vec = GenArray(8, () => [0, 0, 0]);
	reg_vec[7] = size.map((n) => n - 1);
	let reg_float = [1, 2, 5, 0, 0, 0, 0, 0];
	let stack = [];
	const immediate = () => GenArray(3, () => (bytecode[pc++] << 24) >> 24);

	while (pc < bytecode.length) {
		let cmd = bytecode[pc++];
		switch (cmd >> 3) {
			case OP_FORJUMP:
				stack.push(stack.length);
			case OP_LOOP:
			case OP_JUMPIF: {
				// Signed 11-bit byte offset, relative to the end of this instruction.
				const offset = ((((cmd & 7) << 8) | bytecode[pc++]) << 21) >> 21;
				if (cmd >> 3 === OP_LOOP ? stack[stack.length - 1] > 0 && stack[stack.length - 1]-- : stack.pop())
					pc += offset;
				break;
			}
			case OP_STROKEI:
				reg_vec[1] = immediate();
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
							if (brush == 0) hit = dx * dx + dy * dy + dz * dz <= rr;
							if (brush == 1) hit = true;
							if (brush == 2) {
								let t = Math.max(0, Math.min(1, (dx * abx + dy * aby + dz * abz) / length));
								dx -= abx * t;
								dy -= aby * t;
								dz -= abz * t;
								hit = dx * dx + dy * dy + dz * dz <= rr;
							}
							let index = ((z * size[1] + y) * size[0] + x) * 4;
							if (hit && (!(cmd & 1) || buffer[index])) buffer[index] = reg_float[0] & 255;
						}
				if (cmd & 2) {
					reg_vec[0] = b;
					reg_vec[1] = a;
				}
				break;
			}
			case OP_PUSHI: {
				GenArray(cmd & 7, () => stack.push((bytecode[pc++] << 24) >> 24));
				break;
			}
			case OP_SIZE: {
				size = stack.pop().map((n) => (n === -128 ? 128 : n));
				buffer = new Float32Array(size[0] * size[1] * size[2] * 4);
				reg_vec[7] = size.map((n) => n - 1);
				break;
			}
			case OP_VEC:
				stack.push(new Float32Array(stack.splice(-3)));
				break;
			case OP_VLOAD: {
				let val = reg_vec[cmd & 7];
				stack.push(val);
				break;
			}
			case OP_VSTOREI:
				reg_vec[cmd & 7] = immediate();
				break;
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
				const a = reg_vec[flip ? 0 : 6],
					b = reg_vec[flip ? 1 : 7];
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

	let result = tex(size);
	buffers.set(result, buffer);
	flush(result);
	return result;
}

buffers.forEach((_, texture) => flush(texture));

import sphereProgram from "../vox/sphere.vp";
// VP literals are integers; parameters preserve the original fractional shape.
export var sphere = runByteCode(sphereProgram, (index) => (index ? 31.5 : 24.32));
voxT[6] = [sphere, sphere];

import marineLegs, { debugSource as legsSource } from "../vox/marine-legs.vp";
import marineBody, { debugSource as bodySource } from "../vox/marine-body.vp";
import marineArms, { debugSource as armsSource } from "../vox/marine-arms.vp";
import marineGun, { debugSource as gunSource } from "../vox/marine-gun.vp";
import unicornPortal, { debugSource as portalSource } from "../vox/unicorn-portal.vp";
import ggLogo, { debugSource as logoSource } from "../vox/gg-logo.vp";
import railing, { debugSource as railingSource } from "../vox/railing.vp";
import computerConsole, { debugSource as consoleSource } from "../vox/computer-console.vp";
import woodenCrate, { debugSource as crateSource } from "../vox/wooden-crate.vp";
import unicornHead, { debugSource as unicornHeadSource } from "../vox/unicorn-head.vp";
import unicornBody, { debugSource as unicornBodySource } from "../vox/unicorn-body.vp";
import program3, { debugSource as source3 } from "../vox/floortile.vp";
import program4, { debugSource as source4 } from "../vox/walltile.vp";
import windowWall, { debugSource as windowSource } from "../vox/wall-window.vp";
import door, { debugSource as doorSource } from "../vox/door.vp";

let wait = (n) => new Promise((resolve) => setTimeout(resolve, n));

// Discover P0 usage through actual LOADP calls, not by scanning payload bytes.
export function buildVoxelVariants(bytecode, run, parameter = () => 0) {
	let usesP0 = false,
		p0 = 0;
	const load = (index) => (index === 0 ? ((usesP0 = true), p0) : parameter(index));
	const first = run(bytecode, load);
	p0 = 1;
	return [first, usesP0 ? run(bytecode, load) : first];
}

// Publish both variants together, then retire each old texture only once.
export function buildModel(slot, bytecode, parameter = () => 0) {
	// Release builds load each model once; texture retirement is editor-only.
	if (!DEBUG) voxT[slot] = buildVoxelVariants(bytecode, runByteCode, parameter);
	else {
		const previous = voxT[slot];
		const created = [];
		try {
			voxT[slot] = buildVoxelVariants(
				bytecode,
				(code, load) => {
					const texture = runByteCode(code, load);
					created.push(texture);
					return texture;
				},
				parameter,
			);
		} catch (error) {
			for (const texture of created) {
				buffers.delete(texture);
				texture.destroy();
			}
			throw error;
		}

		if (DEBUG && import.meta.env.DEBUG) {
			for (const texture of new Set(previous)) {
				if (texture !== empty && texture !== cube && texture !== sphere) {
					buffers.delete(texture);
					Q.onSubmittedWorkDone().then(() => texture.destroy());
				}
			}
		}
	}
	return voxT[slot];
}

// Load authored models.
{
	const models = [
		[8, marineLegs, legsSource],
		[9, marineBody, bodySource],
		[10, marineArms, armsSource],
		[11, marineGun, gunSource],
		[12, unicornPortal, portalSource],
		[13, ggLogo, logoSource],
		[14, railing, railingSource],
		[15, computerConsole, consoleSource],
		[16, woodenCrate, crateSource],
		[2, unicornBody, unicornBodySource],
		[18, unicornHead, unicornHeadSource],
		[5, program3, source3],
		[7, program4, source4],
		[17, windowWall, windowSource],
		[19, door, doorSource],
	];
	// Kind 1 stays empty: it is the marine's gameplay and transform root.
	for (const [slot, program] of models) {
		buildModel(slot, program);
	}
	if (DEBUG && import.meta.env.DEBUG) {
		const { registerVoxelProgram } = await import("./debug/voxelPrograms.js");
		for (const [slot, , source] of models) {
			registerVoxelProgram(slot, source, (bytecode, parameters) => {
				return buildModel(slot, bytecode, (index) => parameters[index] ?? 0);
			});
		}
	}
}

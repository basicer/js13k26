import { GenArray, label, d, Q, c } from "./globals.js";
import { vec3, vec3_add } from "./math.js";
import {
	COMMAND_NAMES,
	OP_MIRROR,
	OP_PUSHI,
	OP_STROKE,
	OP_VEC,
	OP_VLOAD,
	OP_VSTORE,
	OP_VSTORE3,
	OP_FLOAD,
	OP_FSTORE,
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
buffers.set(empty, new Float32Array(VOXEL_SIZE ** 3 * 4).fill(0));

export var cube = tex(label`cube`);
buffers.set(cube, new Float32Array(VOXEL_SIZE ** 3 * 4).fill(1));

const sphereCenter = (VOXEL_SIZE - 1) / 2;
const sphereRadius = VOXEL_SIZE * 0.38;

export var sphere = tex("sphere");
const sphereVoxels = new Float32Array(VOXEL_SIZE ** 3 * 4);
for (let z = 0; z < VOXEL_SIZE; z++) {
	for (let y = 0; y < VOXEL_SIZE; y++) {
		for (let x = 0; x < VOXEL_SIZE; x++) {
			const dx = x - sphereCenter;
			const dy = y - sphereCenter;
			const dz = z - sphereCenter;
			if (dx * dx + dy * dy + dz * dz > sphereRadius * sphereRadius)
				continue;
			sphereVoxels[((z * VOXEL_SIZE + y) * VOXEL_SIZE + x) * 4] = 20;
		}
	}
}
buffers.set(sphere, sphereVoxels);

export var voxT = GenArray(256, () => empty);

voxT[2] = cube;
voxT[6] = sphere;
voxT[7] = cube; // Arena fallback until the metallic wall program loads.

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
			if (kind == i + 3) voxT[kind] = T;
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
 * @param {*} slot
 * @param {*} bytecode
 */

export function runByteCode(slot, bytecode) {
	let pc = 0;
	let size = vec3(VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE);
	let buffer = new Float32Array(VOXEL_SIZE ** 3 * 4).fill(0);

	let reg_vec = GenArray(8, () => vec3());
	reg_vec[7] = vec3_add(size, vec3(-1, -1, -1));
	let reg_float = [1, 2, 5, 0, 0, 0, 0, 0];
	let stack = [];

	while (pc < bytecode.length) {
		let cmd = bytecode[pc++];
		switch (cmd >> 3) {
			case OP_STROKE: {
				// Flags: 1 paints occupied cells only; 2 swaps endpoints after drawing.
				let a = reg_vec[0], b = reg_vec[1], brush = reg_float[1], r = reg_float[2], lo = [], hi = [];
				for (let i = 3; i--; ) {
					let pad = brush == 1 ? 0 : r,
						min = brush ? Math.min(a[i], b[i]) : a[i],
						max = brush ? Math.max(a[i], b[i]) : a[i];
					lo[i] = Math.max(reg_vec[6][i], Math.ceil(min - pad));
					hi[i] = Math.min(reg_vec[7][i], Math.floor(max + pad));
				}
				let abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2], rr = r * r,
					length = abx * abx + aby * aby + abz * abz || 1;
				for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
					let dx = x - a[0], dy = y - a[1], dz = z - a[2], hit = brush == 1;
					if (brush == 0) hit = dx * dx + dy * dy + dz * dz <= rr;
                    if (brush == 1) hit = true;
					if (brush == 2) {
						let t = Math.max(0, Math.min(1, (dx * abx + dy * aby + dz * abz) / length));
						dx -= abx * t; dy -= aby * t; dz -= abz * t;
						hit = dx * dx + dy * dy + dz * dz <= rr;
					}
					let index = ((z * size[1] + y) * size[0] + x) * 4;
					if (hit && (!(cmd & 1) || buffer[index])) buffer[index] = reg_float[0];
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
			case OP_MIRROR: {
				let axis = cmd & 7, lo = [...reg_vec[6]], hi = reg_vec[7];
				lo[axis] = Math.max(lo[axis], size[axis] / 2);
				for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) for (let x = lo[0]; x <= hi[0]; x++) {
					let sx = x, sy = y, sz = z;
					if (!axis) sx = size[0] - 1 - x;
					else if (axis == 1) sy = size[1] - 1 - y;
					else sz = size[2] - 1 - z;
					buffer[((z * size[1] + y) * size[0] + x) * 4] = buffer[((sz * size[1] + sy) * size[0] + sx) * 4];
				}
				break;
			}
		}
	}

	let result = tex(label`Worked`);
	buffers.set(result, buffer);
	flush(result);
	voxT[slot] = result;
	if (DEBUG && import.meta.env.DEBUG) return buffer;
}

buffers.forEach((_, texture) => flush(texture));

import program1, { debugSource as source1 } from "../vox/marine.vp";
import program2, { debugSource as source2 } from "../vox/unicorn.vp";
import program3, { debugSource as source3 } from "../vox/floortile.vp";
import program4, { debugSource as source4 } from "../vox/walltile.vp";

let wait = (n) => new Promise((resolve) => setTimeout(resolve, n));

let runCached = runByteCode;
if (DEBUG && import.meta.env.DEBUG && false) {
	let cache = await caches.open("vvm-1");
	runCached = async (slot, bytecode) => {
		let hash = [
			...new Uint8Array(await crypto.subtle.digest("SHA-1", bytecode)),
		]
			.map((v) => v.toString(16).padStart(2, "0"))
			.join("");
		let hit = await cache.match("/.vvm/" + hash);
		if (hit) {
			let ids = new Uint8Array(await hit.arrayBuffer());
			if (ids.length == VOXEL_SIZE ** 3) {
				let buffer = new Float32Array(ids.length * 4);
				for (let i = ids.length; i--; ) buffer[i * 4] = ids[i];
				let result = tex(label`Worked`);
				buffers.set(result, buffer);
				flush(result);
				voxT[slot] = result;
				console.log("VVM cache hit", slot, hash);
				return buffer;
			}
		}

		let buffer = runByteCode(slot, bytecode);
		let ids = new Uint8Array(VOXEL_SIZE ** 3);
		for (let i = ids.length; i--; ) ids[i] = buffer[i * 4];
		await cache.put("/.vvm/" + hash, new Response(ids));
		console.log("VVM cache miss", slot, hash);
		return buffer;
	};
}

setTimeout(async () => {
	await wait(1);
	if (DEBUG) console.log(
		"Running bytecode...",
		Uint8Array.fromBase64(program1).byteLength,
		"bytes",
	);
	await runCached(1, Uint8Array.fromBase64(program1));
	await wait(1);
	if (DEBUG) console.log(
		"Running bytecode...",
		Uint8Array.fromBase64(program2).byteLength,
		"bytes",
	);
	await runCached(2, Uint8Array.fromBase64(program2));
	await wait(1);
	if (DEBUG) console.log(
		"Running bytecode...",
		Uint8Array.fromBase64(program3).byteLength,
		"bytes",
	);
	await runCached(5, Uint8Array.fromBase64(program3));
	await wait(1);
	await runCached(7, Uint8Array.fromBase64(program4));

	if (DEBUG && import.meta.env.DEBUG) {
		const { registerVoxelProgram } =
			await import("./debug/voxelPrograms.js");
		for (const [slot, source] of [
			[1, source1],
			[2, source2],
			[5, source3],
			[7, source4],
		]) {
			registerVoxelProgram(slot, source, (bytecode) => {
				const previous = voxT[slot];
				const buffer = runByteCode(slot, bytecode);
				// Preview runs between frames; retire its old CPU/GPU volume after submission.
				if (
					previous !== empty &&
					previous !== cube &&
					previous !== sphere
				) {
					buffers.delete(previous);
					Q.onSubmittedWorkDone().then(() => previous.destroy());
				}
				return buffer;
			});
		}
	}
}, 1);

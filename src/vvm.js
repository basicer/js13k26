import { GenArray, label, d, Q, c } from "./globals.js";
import { vec3, vec3_add } from "./math.js";
import { vec3_dist, dist_point_to_line_segment, point_in_aabb } from "./math.js";
import { COMMAND_NAMES, OP_MIRROR, OP_PUSHI, OP_STROKE, OP_VEC, OP_VLOAD, OP_VSTORE, OP_FLOAD, OP_FSTORE } from "./vvm-const.js";
const VOXEL_SIZE = 64;

const tex = (name, size = [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE]) => {
    let t = d.createTexture({
        "label": label`${name} voxel texture`,
        "size": size,
        "dimension": "3d",
        "format": "rgba32float",
        "usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    t.ROB_SIZE = size;;
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

export const flush = (texture) => {
    Q.writeTexture(
        { "texture": texture },
        buffers.get(texture),
        {
            "bytesPerRow": texture.ROB_SIZE[0] * 4 * 4,
            "rowsPerImage": texture.ROB_SIZE[1],
        },
        texture.ROB_SIZE
    );
};

if (DEBUG && import.meta.env.DEBUG) {
    let {ddsVolume} = await import("./dds.js");

    [
        "../dds/Projector.dds.gz",
        "../dds/FloorTile-LR01.dds.gz",
        "../dds/FloorTile-S04.dds.gz",
    ].map(async (dds, i) => {
        let {size, voxels} = await ddsVolume((await import(dds)).default, true);
        var T = tex("projector", size);
        if (voxels) buffers.set(T, voxels);
        voxT.map((texture, kind) => { if (kind == i+3) voxT[kind] = T; });
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

    let MAP = (flags, fn) => {
        for (let z = reg_vec[6][2]; z <= reg_vec[7][2]; z++) {
            for (let y = reg_vec[6][1]; y <= reg_vec[7][1]; y++) {
                for (let x = reg_vec[6][0]; x <= reg_vec[7][0]; x++) {
                    let index = ((z * size[1] + y) * size[0] + x) * 4;
                    buffer[index] = fn(vec3(x, y, z), buffer[index]);
                }
            }
        }
    }

    while (pc < bytecode.length) {
        let cmd = bytecode[pc++];
        switch (cmd >> 3) {
            case OP_STROKE:
                MAP(0, (pos, value) => {
                        return [
                            () => vec3_dist(pos, reg_vec[0]) - reg_float[2],
                            () => point_in_aabb(pos, reg_vec[0], reg_vec[1]) ? -1 : 1,
                            () => dist_point_to_line_segment(pos, reg_vec[0], reg_vec[1]) - reg_float[2] 
                        ][reg_float[1]]() <= 0 ? reg_float[0] : value
                });
                break;
            case OP_PUSHI:
            {
                GenArray(cmd & 7, () => stack.push(bytecode[pc++]));
                break;
            }
            case OP_VEC:
            {
                let z = stack.pop(), y = stack.pop(), x = stack.pop();
                stack.push(vec3(x, y, z));
                break;
            }
            case OP_VLOAD:
            {
                let val = reg_vec[pc & 7];
                stack.push(val);
                break;
            }
            case OP_VSTORE:
            { 
                let val = stack.pop();
                reg_vec[cmd & 7] = val;
                break;
            }
            case OP_FLOAD:
            {
                let val = reg_float[cmd & 7];
                stack.push(val);
                break;
            }
            case OP_FSTORE:
            {
                let val = stack.pop();
                reg_float[cmd & 7] = val;
                break;
            }
            case OP_MIRROR:
            {
                let source = buffer.slice(), axis = cmd & 7;
                MAP(0, (pos) => {
                    let read = vec3(...pos);
                    read[axis] = Math.min(read[axis], size[axis] - 1 - read[axis]);
                    return source[((read[2] * size[1] + read[1]) * size[0] + read[0]) * 4];
                });
                break;
            }
        }

    }


    let result = tex(label`Worked`);
    buffers.set(result, buffer);
    flush(result);
    voxT[slot] = result;
}

buffers.forEach((_, texture) => flush(texture));


import program from "../vox/first.vp";

setTimeout(() => { runByteCode(1, Uint8Array.fromBase64(program)); }, 10);


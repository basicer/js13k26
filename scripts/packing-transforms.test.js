import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { compactTrack } from "./compact-track.mjs";
import { compactShaderLocals } from "./compact-shader-locals.mjs";
import { compactShaderEntity } from "./compact-shader-entity.mjs";
import { minifyWgsl } from "../tools/wgsl-minify/src/minify.js";
import { checkShader } from "../tools/wgsl-minify/src/compiler-check.js";

// Includes sparse array keys and lengths; JSON alone would hide holes vs null.
const shape = value => value && typeof value === "object"
    ? [Array.isArray(value) ? value.length : null, Object.keys(value).map(key => [key, shape(value[key])])]
    : value;

test("release song pruning preserves the sequence and every played pattern and instrument", () => {
    for (const name of fs.readdirSync(new URL("../music/", import.meta.url)).filter(name => name.endsWith(".zzfxm"))) {
        const source = fs.readFileSync(new URL(`../music/${name}`, import.meta.url), "utf8").replace(/[{][^}]*[}]/gm, "{}");
        const original = vm.runInNewContext(source), context = vm.createContext({});
        vm.runInContext(compactTrack(source, true).replace("export default ", "globalThis.result = "), context);
        const packed = context.result;
        assert.deepEqual(shape(packed.slice(3)), shape(original.slice(3)), name);
        assert.equal(packed[2].length, original[2].length);
        for (let step = 0; step < original[2].length; step++) {
            const before = original[1][original[2][step]], after = packed[1][packed[2][step]];
            assert.equal(after.length, before.length);
            for (let channel = 0; channel < before.length; channel++) {
                assert.deepEqual(shape(after[channel].slice(1)), shape(before[channel].slice(1)), name);
                assert.deepEqual(shape(packed[0][after[channel][0] || 0]), shape(original[0][before[channel][0] || 0]), name);
            }
        }
    }
});

test("legacy tracker mode is carried in the loaded track instead of a runtime slice", () => {
    const source = fs.readFileSync(new URL("../music/Main Title.zzfxm", import.meta.url), "utf8");
    const context = vm.createContext({});
    vm.runInContext(compactTrack(source, true, true).replace("export default ", "globalThis.result = "), context);
    assert.equal(context.result[4], true);
    assert.equal(context.result.length, 5);
});

test("track factoring preserves every note, instrument, sparse hole and array length", () => {
    for (const name of fs.readdirSync(new URL("../music/", import.meta.url))) {
        if (!name.endsWith(".zzfxm")) continue;
        const source = fs.readFileSync(new URL(`../music/${name}`, import.meta.url), "utf8")
            .replace(/[{][^}]*[}]/gm, "{}");
        const packed = compactTrack(source).replace("export default ", "globalThis.result = ");
        const context = vm.createContext({});
        vm.runInContext(packed, context);
        assert.deepEqual(shape(context.result), shape(vm.runInNewContext(source)), name);
    }
});

test("track factoring shares repeated channels without turning trailing holes into notes", () => {
    const source = "[[1,2,3,4,5,6,7,8,,],[1,2,3,4,5,6,7,8,,]]";
    const context = vm.createContext({});
    vm.runInContext(compactTrack(source).replace("export default ", "globalThis.result = "), context);
    assert.equal(context.result[0], context.result[1]);
    assert.equal(context.result[0].length, 9);
    assert.equal(8 in context.result[0], false);
});

test("scoped shader names preserve globals, fields, builtins and nested local scopes", () => {
    const source = `
        struct Data { position: vec4f, value: f32, }
        var<private> value: f32;
        fn shadow() -> f32 { let old = value; let value = 2f; return old + value; }
        fn one(data: Data) -> f32 { let value = data.value; return value; }
        fn nested(input: f32) -> f32 {
            var result = input;
            { let input = 2f; result += input; }
            return result;
        }
        @vertex fn main(@builtin(vertex_index) position: u32) -> @builtin(position) vec4f {
            return vec4f(one(Data(vec4f(), f32(position))) + shadow() + nested(1f));
        }`;
    checkShader(source, minifyWgsl(compactShaderLocals(source)));
});

test("scoped release shader has identical normalized compiler output", () => {
    const source = fs.readFileSync(new URL("../shaders/shader.wgsl", import.meta.url), "utf8")
        .replace(/^#import "([^"]*)".*$/gm, (_, name) => fs.readFileSync(new URL(`../shaders/${name}`, import.meta.url), "utf8"));
    const compact = compactShaderEntity(source);
    checkShader(compact, minifyWgsl(compactShaderLocals(compact)));
});

test("incomplete shader functions and attributes fail without hanging", () => {
    for (const source of ["fn missing", "fn missing()", "fn missing() {", "fn f(@location(0 value: f32 {}"])
        assert.throws(() => compactShaderLocals(source), /shader/);
});

test("packed voxel shader compiles with one uint binding and preserves the pose threshold", () => {
	const original = fs.readFileSync(new URL("../shaders/shader.wgsl", import.meta.url), "utf8")
		.replace(/^#import "([^"]*)".*$/gm, (_, name) => fs.readFileSync(new URL(`../shaders/${name}`, import.meta.url), "utf8"));
	const source = compactShaderEntity(original);
	assert.match(source, /var vox: texture_3d<u32>/);
	assert.doesNotMatch(source, /\bvox1\b/);
	assert.match(source, /\[u32\(e\.modelVariant >= 0\.5f\)\]/);
	checkShader(source, minifyWgsl(compactShaderLocals(source)));
});

test("shader-generated cube preserves all original triangle corners and inward winding", () => {
    const source = fs.readFileSync(new URL("../shaders/scene.wgsl", import.meta.url), "utf8");
    const words = source.match(/array<u32, 4>\(([^)]*)\)/)[1].split(",").map(n => Number(n.trim().replace(/u$/, "")));
    const indices = Array.from({ length: 36 }, (_, i) => words[i / 10 | 0] >>> (i % 10 * 3) & 7);
    assert.equal(indices.join(""), "013032467475051045237276026064157173");
    const points = indices.map(i => [0, 1, 2].map(axis => (i >> axis & 1) * 2 - 1));
    for (let i = 0; i < 36; i += 3) {
        const [a, b, c] = points.slice(i, i + 3);
        const u = b.map((v, j) => v - a[j]), v = c.map((v, j) => v - a[j]);
        const normal = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
        assert.ok(normal.reduce((sum, n, j) => sum + n * a[j], 0) < 0);
    }
});

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { compactShaderEntity } from "./compact-shader-entity.mjs";
import { generateEntityConstants } from "./generate-entity-constants.mjs";

const source = fs.readFileSync(new URL("../shaders/shader.wgsl", import.meta.url), "utf8")
    .replace(/^#import "([^"]*)".*$/gm, (_, name) => fs.readFileSync(new URL(`../shaders/${name}`, import.meta.url), "utf8"));

function layout(compact) {
    const body = /struct Entity\s*\{([^}]+)\}/.exec(compact)[1];
    let offset = 0;
    const fields = {};
    for (const [, size, name, type] of body.matchAll(/(?:@size\((\d+)\)\s*)?(\w+):\s*(f32|vec3<f32>),/g)) {
        const alignment = type === "f32" ? 4 : 16;
        offset = Math.ceil(offset / alignment) * alignment;
        fields[name] = offset;
        offset += size ? Number(size) : type === "f32" ? 4 : 12;
    }
    return { fields, stride: Math.ceil(offset / 16) * 16 };
}

function verifyOffsets(input) {
    const constants = Object.fromEntries([...generateEntityConstants(input).matchAll(/export const (\w+) = (\d+);/g)]
        .map(([, name, value]) => [name, Number(value) * 4]));
    const packed = layout(compactShaderEntity(input));
    for (const [name, offset] of Object.entries(packed.fields))
        assert.equal(offset, constants[name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()], name);
    assert.equal(packed.stride, constants.STRIDE);
    return packed;
}

test("release entity padding preserves all GPU offsets and the host stride", () => {
    const packed = verifyOffsets(source);
    assert.equal(packed.stride, 176);
    assert.equal(packed.fields.matOverride, 76);
    assert.equal(packed.fields.light_angle, 96);
    assert.equal(packed.fields.health, undefined);
    assert.equal(packed.fields.velocity, undefined);
});

test("new shader reads automatically retain previously CPU-only members", () => {
    const packed = verifyOffsets(source + "\nfn health_probe(e: Entity) -> f32 { return e.health + e.maxHealth + e.velocity.x; }");
    assert.equal(packed.fields.health, 100);
    assert.equal(packed.fields.maxHealth, 140);
    assert.equal(packed.fields.velocity, 80);
});

test("compaction rejects positional constructors and unsupported field types", () => {
    assert.throws(() => compactShaderEntity(source + "\nfn probe() { let e = Entity(); }"), /constructors/);
    assert.throws(() => compactShaderEntity(source.replace("health: f32", "health: u32")), /Unsupported/);
});

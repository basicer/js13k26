import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { generateEntityConstants } from "./generate-entity-constants.mjs";
import * as E from "../src/entities-const.js";

test("generated entity constants match the shader and committed output", () => {
	const source = readFileSync(new URL("../shaders/common.wgsl", import.meta.url), "utf8");
	const output = readFileSync(new URL("../src/entities-const.js", import.meta.url), "utf8");
	assert.equal(generateEntityConstants(source), output.replaceAll("\r\n", "\n"));
	assert.deepEqual([E.TARGET_POSITION, E.LERP_SPEED, E.CONTROLLER], [36, 39, 40]);
	assert.deepEqual(
		[E.KIND, E.POS, E.ROT, E.SCALE, E.TILE, E.VELOCITY, E.TTL, E.LIGHT_ANGLE, E.SOLID, E.HIT_RADIUS, E.HIT_CENTER_Y, E.DISSOLVE_RATE, E.WALK_STRIDE, E.DISSOLVE_TARGET, E.GRAVITY, E.MAX_HEALTH, E.STRIDE],
		[0, 4, 8, 12, 16, 20, 23, 24, 28, 29, 30, 31, 32, 33, 34, 35, 44],
	);
});

test("WGSL vec3 alignment, adjacent scalars, array stride and struct tail padding", () => {
	const generated = generateEntityConstants(`
		// An unrelated struct must not affect Entity offsets.
		struct Other { a: f32, };
		struct Entity {
			a: f32,
			position: vec3<f32>, /* align 16, size 12 */
			scalarAfterVector: u32,
			items: array<vec3<f32>, 2>,
			last: i32,
		};
	`);
	const values = vm.runInNewContext(generated.replaceAll("export ", "") +
		"[A, POSITION, POSITION_X, POSITION_Y, POSITION_Z, SCALAR_AFTER_VECTOR, ITEMS, LAST, STRIDE]");
	assert.deepEqual(Array.from(values), [0, 4, 4, 5, 6, 7, 8, 16, 20]);
});

test("unsupported layouts fail instead of silently emitting incorrect offsets", () => {
	for (const source of [
		"struct Other { a: f32, };",
		"struct Entity { a: mat4x4<f32>, };",
		"struct Entity { @align(32) a: f32, };",
		"struct Entity { a: array<f32>, };",
		"struct Entity { a: array<f32, 2, 3>, };",
		"struct Entity { a: f32, a: f32, };",
	]) assert.throws(() => generateEntityConstants(source));
});


test("render uniforms retain their eight-float layout independently of entity properties", () => {
	const source = readFileSync(new URL("../shaders/common.wgsl", import.meta.url), "utf8");
	const body = /struct RenderState\s*\{([^}]+)\}/.exec(source)[1];
	const generated = generateEntityConstants(`struct Entity { ${body} }`);
	assert.match(generated, /export const MOUSE = 4;/);
	assert.match(generated, /export const STRIDE = 8;/);
});

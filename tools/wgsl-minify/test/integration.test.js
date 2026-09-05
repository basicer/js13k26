import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import { minifyWgsl } from "../src/minify.js";
import { fixtures } from "./fixtures.js";

import { checkShader as check } from "../src/compiler-check.js";

for (const name of ["shader"]) {
	test(`${name}: unchanged compiler output`, () => {
		const source = fs
			.readFileSync(
				new URL(`../../../shaders/${name}.wgsl`, import.meta.url),
				"utf8",
			)
			.replace(/^#import "([^"]*)".*$/gm, (_, file) =>
				fs.readFileSync(
					new URL(`../../../shaders/${file}`, import.meta.url),
					"utf8",
				),
			);
		check(source);
	});
}

test("Preserve entrypoints, builtin names, swizzles, shadowing and operators", () => {
	check(`
    struct Output { @builtin(position) position: vec4<f32>, };
    @vertex fn vertex_main(@builtin(vertex_index) index: u32) -> Output {
      var position = vec4<f32>(0.0f, 0.0f, 0.0f, 1.0f);
      var counter = index;
      for (var iteration = 0u; iteration < 4u; iteration++) {
        counter += iteration;
        if (counter >= 8u && iteration != 0u) { break; }
      }
      { let counter = f32(counter); position.x = counter; }
      position.y = f32(counter >> 1u);
      return Output(position);
    }
  `);
});

test("Incomplete declarations fail instead of hanging", () => {
	assert.throws(() => minifyWgsl("var<storage,"), /Incomplete/);
	assert.throws(() => minifyWgsl("@compute"), /Incomplete/);
});

for (const [name, source] of Object.entries(fixtures)) {
	// wgsl-minifier 0.7 cannot serialize overrides. Resolve this fixture's
	// default for the oracle; preservation of the override name has a unit test.
	test(`${name}: unchanged compiler output`, () =>
		check(source.replace("override sample_count", "const sample_count")));
}

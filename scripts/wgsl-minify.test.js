import assert from "node:assert/strict";
import { test } from "node:test";
import { minifyWgsl, tokenizeWgsl } from "./wgsl-minify.js";

test("empty and comment-only modules", () => {
	for (const source of ["", " \n\t", "// comment", "/* a /* b */ c */"])
		assert.equal(minifyWgsl(source), "");
});

test("comments separate tokens, including nested and Unicode line endings", () => {
	assert.deepEqual(
		tokenizeWgsl("word/* outer /* inner */ outer */other// x\u2028last"),
		["word", "other", "last"],
	);
	assert.equal(minifyWgsl("1/*comment*/f"), "1 f");
});

test("literal spelling and compound operators survive tokenization", () => {
	const literals = [
		"0xffu",
		"0X10i",
		"0x1.8p+1f",
		"0X2p-1h",
		"0x.8",
		"0x1.",
		".5e+1f",
		"1e-2f",
		"1.f",
		"0u",
	];
	assert.deepEqual(tokenizeWgsl(literals.join(" ")), literals);
	const operators = [">>=", "<<=", ">>", "<<", "->", "--", "++", "&&", "||"];
	assert.deepEqual(tokenizeWgsl(operators.join(" ")), operators);
});

test("whitespace removal never fuses operators or exponent fragments", () => {
	for (const source of [
		"- -",
		"+ +",
		"/ *",
		"/ /",
		"< < =",
		"> >=",
		"1 .5",
		"1e2 f",
		"a b",
		"a & & b",
		"朝 焼",
	]) {
		assert.deepEqual(
			tokenizeWgsl(minifyWgsl(source)),
			tokenizeWgsl(source),
			source,
		);
	}
});

test("entrypoints, overrides, explicit names and attributes remain accessible", () => {
	const source = `override setting: u32=1u; const count=2u; @compute @workgroup_size(count) fn main(){let local=setting;}`;
	const output = minifyWgsl(source, { preserveNames: ["count"] });
	assert.match(output, /override setting:/);
	assert.match(output, /const count=/);
	assert.match(output, /@workgroup_size\(count\)fn main\(/);
	assert.doesNotMatch(output, /\blocal\b/);
});

test("contextual names are preserved in interpolation and diagnostics", () => {
	const source = `diagnostic(off, derivative_uniformity); struct Output{@location(0) @interpolate(flat) value:f32,} fn helper(){let flat=1;let off=2;}`;
	const output = minifyWgsl(source);
	assert.match(output, /diagnostic\(off,derivative_uniformity\)/);
	assert.match(output, /@interpolate\(flat\)/);
	assert.match(output, /let flat=/);
	assert.match(output, /let off=/);
});

test("type aliases cannot capture shorthand substitutions", () => {
	const output = minifyWgsl(
		"alias vec3f=vec4<f32>;fn helper(input:vec3<f32>)->vec3<f32>{return input;}",
	);
	assert.match(output, /alias vec3f=vec4f/);
	assert.match(output, /:vec3<f32>/);
	assert.match(
		minifyWgsl("alias f32=i32;var<private> value:vec3<f32>;"),
		/:vec3<f32>/,
	);
});

test("literal shortening retains type and does not change leading-zero literals", () => {
	assert.equal(
		minifyWgsl("1.0f 0.00f 01.0f 1.0 1.0h"),
		"1f 0f 01.0f 1.0 1.0h",
	);
});

test("bad input produces useful errors rather than hanging or dropping characters", () => {
	assert.throws(() => minifyWgsl(null), TypeError);
	assert.throws(
		() => minifyWgsl("\n/* open"),
		/Unterminated block comment at 2:1/,
	);
	assert.throws(() => minifyWgsl("\n$"), /Unexpected character.*2:1/);
	for (const source of [
		"var<storage,",
		"@compute",
		"let",
		"fn",
		"override",
		"alias",
	])
		assert.throws(() => minifyWgsl(source), /Incomplete/);
});

test("name generation is deterministic, collision-free and has no small fixed limit", () => {
	const source = Array.from(
		{ length: 1500 },
		(_, i) => `const value_${i}=${i};`,
	).join("");
	const compact = minifyWgsl(source);
	assert.equal(compact, minifyWgsl(source));
	const names = [...compact.matchAll(/const (\w+)=/g)].map(
		(match) => match[1],
	);
	assert.equal(names.length, 1500);
	assert.equal(new Set(names).size, names.length);
});

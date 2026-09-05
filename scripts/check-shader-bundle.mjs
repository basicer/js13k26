// Explicit, optional compiler validation of what will actually ship.
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseAst } from "rolldown/parseAst";
import { checkShader } from "./wgsl-compiler-check.js";

const html = fs.readFileSync(
	new URL("../dist/index.html", import.meta.url),
	"utf8",
);
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
assert.ok(match, "Run npm run build before checking bundled shaders");
const strings = [];
function walk(node) {
	if (!node || typeof node !== "object") return;
	if (node.type === "Literal" && typeof node.value === "string")
		strings.push(node.value);
	if (node.type === "TemplateLiteral" && !node.expressions.length)
		strings.push(node.quasis[0].value.cooked);
	for (const value of Object.values(node)) {
		if (Array.isArray(value)) value.forEach(walk);
		else if (value && typeof value === "object") walk(value);
	}
}
walk(parseAst(match[1]));
for (const [file, entrypoint] of [
	["shader", "vs_main"],
	["post", "vs_post"],
	["compute", "build_point_lights"],
]) {
	const found = strings.filter((text) => text.includes(`fn ${entrypoint}(`));
	assert.equal(found.length, 1, `Expected one bundled ${file} shader`);
	const source = fs
		.readFileSync(
			new URL(`../shaders/${file}.wgsl`, import.meta.url),
			"utf8",
		)
		.replace(/^#import "([^"]*)".*$/gm, (_, name) =>
			fs.readFileSync(
				new URL(`../shaders/${name}`, import.meta.url),
				"utf8",
			),
		);
	checkShader(source, found[0]);
	console.log(`${file}: bundled shader matches original compiler output`);
}

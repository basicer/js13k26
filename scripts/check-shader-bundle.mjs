// Explicit, optional compiler validation of what will actually ship.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { parseAst } from "rolldown/parseAst";
import { checkShader } from "../tools/wgsl-minify/src/compiler-check.js";

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
if (!strings.some(text => text.includes("fn vs_main("))) {
	// Roadroller's eval is intercepted: inspect the game without executing it.
	let decoded;
	const decoder = `(function(){var ${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").join(",")};${match[1]}})()`;
	vm.runInNewContext(decoder, { eval: value => { decoded = value; } }, { timeout: 10000 });
	assert.equal(typeof decoded, "string", "Packed game must decode to JavaScript");
	strings.length = 0;
	walk(parseAst(decoded));
}
const found = strings.filter(text => text.includes('fn vs_main('));
assert.equal(found.length, 1, 'Expected one bundled unified shader');
for (const entry of ['vs_main', 'fs_main', 'vs_post', 'fs_post', 'update_entities'])
  assert.ok(found[0].includes('fn ' + entry + '('), 'Missing entry point: ' + entry);
const source = fs.readFileSync(new URL('../shaders/shader.wgsl', import.meta.url), 'utf8')
  .replace(/^#import "([^"]*)".*$/gm, (_, name) =>
    fs.readFileSync(new URL(`../shaders/${name}`, import.meta.url), 'utf8'));
checkShader(source, found[0]);
console.log('Unified shader: all five entry points match original compiler output');

// Compression probes for the production WGSL string.  These excisions are
// deliberately not runnable shaders: use them to prioritize real experiments.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";
import { parseAst } from "rolldown/parseAst";
import { Packer } from "roadroller";
import ect from "ect-bin";
import advzip from "advzip-bin";
import { compactShaderEntity } from "./compact-shader-entity.mjs";
import { minifyWgsl } from "../tools/wgsl-minify/src/minify.js";

const root = path.resolve(import.meta.dirname, "..");
const output = path.resolve(process.argv[2] || path.join(root, "reports/shader-size-audit.md"));
const html = fs.readFileSync(path.join(root, "dist/index.html"), "utf8");
const packed = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
if (!packed) throw Error("Run npm run build first");
let code;
vm.runInNewContext(`(function(){var ${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").join(",")};${packed}})()`, { eval: value => { code = value; } }, { timeout: 10000 });
if (typeof code !== "string") throw Error("Could not decode the release JavaScript");

const expand = file => fs.readFileSync(path.join(root, "shaders", file), "utf8")
    .replace(/^#import "([^"]*)".*$/gm, (_, dependency) => expand(dependency));
const compact = compactShaderEntity(expand("shader.wgsl"));
const shader = minifyWgsl(compact);
if (!code.includes(shader)) throw Error("Bundled shader does not match current minifier output");

function astNodes(source) {
    const nodes = [];
    const visit = node => {
        if (!node || typeof node !== "object") return;
        if (node.type) nodes.push(node);
        Object.values(node).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value));
    };
    visit(parseAst(source));
    return nodes;
}
const config = fs.readFileSync(path.join(root, "vite.config.js"), "utf8");
const packer = astNodes(config).find(node => node.type === "NewExpression" && node.callee.name === "Packer");
const settings = vm.runInNewContext(`(${config.slice(packer.arguments[1].start, packer.arguments[1].end)})`);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "js13k-shader-audit-"));
function pack(source) {
    const { firstLine, secondLine } = new Packer([{ data: source, type: "js", action: "eval" }], settings).makeDecoder();
    return html.replace(/<script>[\s\S]*?<\/script>/, `<script>${firstLine}\n${secondLine}</script>`);
}
function zipSize(contents) {
    const input = path.join(scratch, "index.html"), zip = path.join(scratch, "index.zip");
    if (fs.existsSync(zip)) fs.unlinkSync(zip);
    fs.writeFileSync(input, contents);
    execFileSync(ect, ["-strip", "-zip", "-10009", input], { stdio: "pipe" });
    execFileSync(advzip, ["-4", "-z", zip], { stdio: "pipe" });
    return fs.statSync(zip).size;
}
const baseline = zipSize(pack(code));
const shipped = fs.statSync(path.join(root, "dist/index.zip")).size;
if (baseline !== shipped) throw Error(`Repack mismatch: ${baseline} vs ${shipped}`);

function functionRanges(source) {
    const ranges = [];
    for (let at = source.indexOf("fn "); at >= 0; at = source.indexOf("fn ", at + 3)) {
        const name = /^fn (\w+)/.exec(source.slice(at))?.[1];
        const start = source.lastIndexOf("}", at) + 1;
        const open = source.indexOf("{", at);
        let depth = 0, end = open;
        for (; end < source.length; end++) {
            if (source[end] === "{") depth++;
            if (source[end] === "}" && --depth === 0) { end++; break; }
        }
        if (!name || open < 0 || depth) throw Error(`Could not find function body near ${at}`);
        ranges.push({ name, start, end });
    }
    return ranges;
}
const sourceNames = [...compact.matchAll(/\bfn\s+(\w+)/g)].map(match => match[1]);
const outputFunctions = functionRanges(shader);
if (sourceNames.length !== outputFunctions.length) throw Error("Function order changed during minification");
const byName = Object.fromEntries(sourceNames.map((name, i) => [name, outputFunctions[i]]));
const globals = [];
let cursor = 0;
for (const range of outputFunctions) {
    if (cursor < range.start) globals.push({ start: cursor, end: range.start });
    cursor = range.end;
}
if (cursor < shader.length) globals.push({ start: cursor, end: shader.length });
const names = (...items) => items.map(name => byName[name]);
const features = [
    ["Interface, entity layout & bindings", globals],
    ["Entity transforms & projection", names("rotation_matrix", "local_transform", "clip_depth", "world_transform")],
    ["Direct and spotlight lighting", names("direct_lighting", "shade_surface")],
    ["Voxel draw vertex stage", names("vs_main")],
    ["Voxel fetch & cell conversion", names("voxel_at", "voxel_cell")],
    ["Voxel DDA ray traversal", names("voxel_search")],
    ["Dissolve mask hash", names("dissolve_noise")],
    ["Voxel fragment stage (material, AO, rainbow, output)", names("fs_main")],
    ["Post vertex, tone map & composite", names("vs_post", "tone_map", "fs_post")],
    ["Post AA and bloom", names("aa")],
];
function removeRanges(ranges) {
    const ordered = [...ranges].sort((a, b) => a.start - b.start);
    let result = "", cursor = 0;
    for (const range of ordered) { result += shader.slice(cursor, range.start); cursor = range.end; }
    return result + shader.slice(cursor);
}
const rows = features.map(([name, ranges]) => {
    const removed = ranges.reduce((sum, range) => sum + range.end - range.start, 0);
    const variant = removeRanges(ranges);
    const variantCode = code.replace(shader, variant);
    if (variantCode === code) throw Error(`Could not replace shader for ${name}`);
    return { name, rawBytes: removed, marginalZipBytes: baseline - zipSize(pack(variantCode)) };
});
const allShaderZipBytes = baseline - zipSize(pack(code.replace(shader, "")));

const rustInput = path.join(scratch, "compact.wgsl"), rustOutput = path.join(scratch, "rust.wgsl");
fs.writeFileSync(rustInput, compact);
execFileSync(process.env.WGSL_MINIFIER || "wgsl-minifier", ["-f", rustInput, rustOutput], { stdio: "pipe" });
const rustBytes = fs.statSync(rustOutput).size;
const markdown = `# Shader compression audit\n\nProduction ZIP: **${baseline} bytes**.  The compacted expanded WGSL is ${Buffer.byteLength(compact)} bytes; the in-tree minifier emits ${Buffer.byteLength(shader)} bytes.\n\n## Estimated marginal ZIP cost by feature\n\n| Feature | Raw WGSL bytes | ZIP bytes when excised |\n|---|---:|---:|\n${rows.map(row => `| ${row.name} | ${row.rawBytes} | ${row.marginalZipBytes} |`).join("\n")}\n\nThese are non-additive compression probes: each row deletes one WGSL region from the actual minified string, then re-runs the production Roadroller, ECT and advzip configuration. The resulting shaders are intentionally invalid, so this measures compressed representation weight, not a working feature-removal patch.\n\n## wgsl-minifier comparison\n\n| Minifier | Output bytes | Difference from in-tree |\n|---|---:|---:|\n| In-tree lexical minifier | ${Buffer.byteLength(shader)} | 0 |\n| wgsl-minifier 0.7.0 | ${rustBytes} | +${rustBytes - Buffer.byteLength(shader)} |\n\nThe Rust tool expanded this shader by ${rustBytes - Buffer.byteLength(shader)} bytes before JavaScript/Roadroller compression, chiefly because it emits a more explicit normalized form. It is a compiler/normalizer oracle here, not a size win.\n`;
fs.writeFileSync(output, markdown);
console.log(markdown);
console.log(`All WGSL excision: ${allShaderZipBytes} ZIP bytes`);
console.log(`Report: ${output}`);

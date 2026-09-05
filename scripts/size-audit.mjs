// Run after npm run build. Byte-excision experiments, not runnable feature removals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseAst } from 'rolldown/parseAst';
import ect from 'ect-bin';
import advzip from 'advzip-bin';
import { assemble } from '../src/vvm-tools.js';

const html = fs.readFileSync('dist/index.html', 'utf8');
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!match) throw Error('Expected the production inline script');
const code = match[1], offset = match.index + '<script>'.length;
const ast = parseAst(code);
const nodes = [];
function walk(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type) nodes.push(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') walk(value);
  }
}
walk(ast);
const text = node => code.slice(node.start, node.end);
const labels = Array(html.length).fill('HTML wrapper');
function tag(start, end, label) { labels.fill(label, offset + start, offset + end); }
tag(0, code.length, 'Rendering, input and shared JS');
const declarations = nodes.filter(n => n.type === 'VariableDeclarator');
const find = predicate => {
  const n = declarations.find(n => predicate(text(n)));
  if (!n) throw Error('Production structure changed; update audit classification');
  return n;
};
const palette = find(s => /new Uint8Array\(2048\)/.test(s));
const entities = find(s => /new Float32Array\(38e3\)/.test(s));
const textures = find(s => s.includes('dimension:`3d`'));
const renderStart = find(s => s.includes('performance.now()'));
tag(palette.start, entities.start, 'Palette generation');
tag(entities.start, textures.start, 'Entities and scene setup');
tag(textures.start, renderStart.start, 'Voxel textures and startup');
const vm = nodes.find(n => n.type === 'FunctionDeclaration' && text(n).includes('switch(') && text(n).includes('>>3'));
if (!vm) throw Error('VM function not found');
tag(vm.start, vm.end, 'Voxel interpreter');
const audio = find(s => s.includes('AudioContext'));
const audioEnd = code.indexOf('Object.assign(', audio.end);
if (audioEnd < 0) throw Error('Audio boundary not found');
tag(audio.start, audioEnd, 'Audio engine, SFX and wiring');
// Music arrays survive as numeric data, even after variable renaming.
const music = declarations.filter(n => n.init?.type === 'ArrayExpression' && text(n.init).length > 2000);
if (music.length !== 2) throw Error('Expected two music tracks');
function numericData(n) {
  if (n === null) return null;
  if (n.type === 'ArrayExpression') return n.elements.map(numericData);
  if (n.type === 'Literal') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-') return -numericData(n.argument);
  if (n.type === 'ObjectExpression' && !n.properties.length) return {};
  throw Error(`Unexpected music data: ${n.type}`);
}
for (const title of ['Main Title', 'Ambient1']) {
  const source = fs.readFileSync(`src/music/${title}.zzfxm`, 'utf8').replace(/[{][^}]*[}]/gm, '{}');
  const expected = JSON.stringify(numericData(parseAst(`(${source})`).body[0].expression));
  const n = music.find(n => JSON.stringify(numericData(n.init)) === expected);
  if (!n) throw Error(`Music data did not match ${title}`);
  tag(n.init.start, n.init.end, `Music: ${title}`);
}
for (const n of nodes.filter(n => n.type === 'TemplateLiteral' || n.type === 'Literal')) {
  const s = text(n);
  if (s.includes('@vertex') || s.includes('@compute')) {
    const name = s.includes('vs_main') ? 'Shaders: voxel renderer' : s.includes('vs_post') ? 'Shaders: postprocess' : 'Shaders: light compute';
    tag(n.start, n.end, name);
  }
}
for (const name of ['marine', 'unicorn', 'floortile']) {
  const encoded = Buffer.from(assemble(fs.readFileSync(`vox/${name}.vp`, 'utf8'))).toString('base64');
  let count = 0;
  for (let i = code.indexOf(encoded); i !== -1; i = code.indexOf(encoded, i + encoded.length)) {
    tag(i, i + encoded.length, `Model: ${name}`); count++;
  }
  if (!count) throw Error(`Compiled ${name} does not match build; rebuild first`);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'js13k-size-'));
function zipSize(contents) {
  const input = path.join(scratch, 'index.html'), zip = path.join(scratch, 'index.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  fs.writeFileSync(input, contents);
  execFileSync(ect, ['-strip', '-zip', '-10009', input], { stdio: 'pipe' });
  execFileSync(advzip, ['-4', '-z', zip], { stdio: 'pipe' });
  return fs.statSync(zip).size;
}
const baseline = zipSize(html);
const actual = fs.statSync('dist/index.zip').size;
if (baseline !== actual) throw Error(`Repacked ZIP ${baseline} differs from dist ZIP ${actual}`);
console.log(`Baseline: ${baseline} ZIP bytes; ${Buffer.byteLength(html)} uncompressed bytes`);
const rows = [];
function measure(name, matches) {
  const removed = [], kept = [];
  for (let i = 0; i < html.length; i++) (matches(labels[i]) ? removed : kept).push(html[i]);
  const row = { name, rawBytes: Buffer.byteLength(removed.join('')), marginalZipBytes: baseline - zipSize(kept.join('')) };
  console.log(JSON.stringify(row)); return row;
}
for (const name of new Set(labels)) rows.push(measure(name, label => label === name));
if (rows.reduce((sum, row) => sum + row.rawBytes, 0) !== Buffer.byteLength(html)) throw Error('Incomplete partition');
const groups = [
  measure('All shaders', name => name.startsWith('Shaders:')),
  measure('All audio including music', name => name.startsWith('Music:') || name.startsWith('Audio engine')),
  measure('All model data', name => name.startsWith('Model:')),
  measure('All voxel code and model data', name => name.startsWith('Voxel') || name.startsWith('Model:')),
];
rows.sort((a,b) => b.marginalZipBytes - a.marginalZipBytes);
const zip = fs.readFileSync('dist/index.zip');
const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const compressedPayload = zip.readUInt32LE(central + 20);
const report = { baselineZipBytes: baseline, compressedPayloadBytes: compressedPayload, archiveOverheadBytes: baseline - compressedPayload, rawBytes: Buffer.byteLength(html), remainingBytes: 13312 - baseline, groups, rows };
const output = path.resolve(process.argv[2] || path.join(scratch, 'report.json'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const table = list => '| Section | Raw bytes | ZIP reduction when excised |\n|---|---:|---:|\n' + list.map(r => `| ${r.name} | ${r.rawBytes} | ${r.marginalZipBytes} |`).join('\n');
fs.writeFileSync(output.replace(/\.json$/, '') + '.md', `# Production ZIP size audit\n\nZIP: **${baseline} bytes**, ${13312 - baseline} bytes remaining. HTML: ${Buffer.byteLength(html)} bytes before compression. Compressed HTML: ${compressedPayload} bytes; archive overhead: ${baseline - compressedPayload} bytes.\n\n${table(groups)}\n\n${table(rows)}\n\n## Method\n\nBuilt with npm run build, then classified the final minified inline JavaScript using its AST and matched compiled model payloads and music data against source. Recompressed each experiment using the production ECT and advzip settings. Repacking the unmodified HTML exactly reproduced the shipped ZIP size. Raw rows partition the HTML completely.\n\nZIP reductions are **non-additive marginal measurements**: each section is removed independently from the final text, without recompiling. The resulting experimental files are not runnable builds. Shared compression means these measurements are neither an exact allocation nor guaranteed feature-removal savings. Aggregate rows are measured together, not summed.\n\nModel raw sizes include duplicated base64 payloads in startup logging and loading. Renderer/shared JS includes WebGPU setup, render loop, camera/input and common helpers. Audio engine includes synthesizer, tracker playback, sound presets and export wiring; the final demo timer remains in shared JS. Debug tooling is excluded by the production build.\n\nReproduce: npm run build, then node scripts/size-audit.mjs <output.json>. Classifiers intentionally fail if expected production structures or asset data change.\n`);
console.log(`Report: ${output}`);
console.log('Marginal ZIP bytes are non-additive: each section is excised independently without recompilation. Experiments are not runnable builds.');

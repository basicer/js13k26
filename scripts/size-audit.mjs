// Run after npm run build. Excision probes measure compression, not runnable feature removals.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { parseAst } from 'rolldown/parseAst';
import { Packer } from 'roadroller';
import ect from 'ect-bin';
import advzip from 'advzip-bin';
import { assemble } from '../src/vvm-tools.js';

function nodesOf(source) {
  const nodes = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type) nodes.push(node);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object') walk(value);
    }
  }
  walk(parseAst(source));
  return nodes;
}
const html = fs.readFileSync('dist/index.html', 'utf8');
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!match) throw Error('Expected a production inline script');
let code;
vm.runInNewContext(`(function(){var ${'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').join(',')};${match[1]}})()`,
  { eval: value => { code = value; } }, { timeout: 10000 });
if (typeof code !== 'string') throw Error('Expected Roadroller-packed JavaScript');
const config = fs.readFileSync('vite.config.js', 'utf8');
const packerNode = nodesOf(config).find(n => n.type === 'NewExpression' && n.callee.name === 'Packer');
if (!packerNode) throw Error('Production Packer settings not found');
const settingsNode = packerNode.arguments[1];
const settings = vm.runInNewContext(`(${config.slice(settingsNode.start, settingsNode.end)})`);
const nodes = nodesOf(code), text = n => code.slice(n.start, n.end);
const declarations = nodes.filter(n => n.type === 'VariableDeclarator');
const functions = nodes.filter(n => n.type === 'FunctionDeclaration');
const labels = Array(code.length).fill('Shared runtime and uncategorized');
function tag(start, end, label) {
  if (!(start >= 0 && end >= start && end <= code.length)) throw Error(`Invalid range: ${label}`);
  labels.fill(label, start, end);
}
function find(predicate) {
  const node = declarations.find(n => predicate(text(n), n));
  if (!node) throw Error('Production structure changed; update audit classifiers');
  return node;
}
const palette = find(s => /new Uint8Array\(2048\)/.test(s));
const entities = find(s => /new Float32Array\(68400\)/.test(s));
const textures = find(s => /dimension:[`"]3d/.test(s));
const audio = find(s => s.includes('AudioContext'));
const bootstrap = find(s => s.includes('=document'));
const inputState = find(s => s.includes('k.has(`shift`)'));
const gpuBuffers = find(s => s.includes('new Float32Array(A(24'));
const shaderModule = find(s => s.includes('createShaderModule'));
const pipeline = find(s => s.includes('createRenderPipeline'));
const animation = find(s => s.includes('requestAnimationFrame'));
tag(bootstrap.start, palette.start, 'Browser and WebGPU bootstrap');
tag(inputState.start, gpuBuffers.start, 'Input, camera and interaction state');
tag(gpuBuffers.start, shaderModule.start, 'GPU buffers, textures and geometry');
tag(pipeline.start, animation.start, 'Render pipelines and bind groups');
for (const n of nodes.filter(n => n.type === 'ExpressionStatement' && n.start > 0 && text(n).includes('addEventListener')))
  tag(n.start, n.end, 'Input, camera and interaction state');
tag(palette.start, entities.start, 'Palette generation');
tag(entities.start, textures.start, 'Entity storage and initialization');
tag(textures.start, audio.start, 'Voxel textures and startup');
// Closure rearranges declarations, so tag individual audio declarations rather
// than assuming they form one contiguous region.
for (const n of declarations.filter(n => /AudioContext|createBufferSource|44100/.test(text(n))))
  tag(n.start, n.end, 'Audio synthesis and cues');
function tagFunction(label, predicate) {
  const node = functions.find(n => predicate(text(n)));
  if (!node) throw Error(`Function classifier did not match: ${label}`);
  tag(node.start, node.end, label);
}
tagFunction('Voxel interpreter and variants', s => s.includes('switch(') && s.includes('>>3'));
tagFunction('Level layout and collision', s => s.includes('15.5') && s.includes('2.8'));
tagFunction('Level layout and collision', s => s.includes('.some(') && s.includes('Math.abs'));
tagFunction('Level layout and collision', s => s.includes('Math.cos(e[c])') && s.includes('t.map('));
tagFunction('Level layout and collision', s => s.includes('L.reduce(') && s.includes('Math.min('));
tagFunction('Gameplay', s => s.includes('Math.hypot(') && s.includes('/.2'));
tagFunction('Gameplay', s => s.includes('[11]=249') && s.includes('Se()'));
tagFunction('Render frame', s => s.includes('performance.now()'));
tagFunction('Gameplay', s => s.includes('Z&&n[25]') && s.includes('Math.max(0'));
tagFunction('Gameplay', s => s.includes('e(),o(),k.clear()'));
tagFunction('Gameplay', s => s.includes('s>0?134:6'));
tagFunction('Gameplay', s => s.includes('K!==1&&Oe'));
tagFunction('Gameplay', s => s.includes('r*18') && s.includes('for(var d of L)'));
tagFunction('Entity storage and initialization', s => s.includes('N.fill(0)') && s.includes('te.clear()'));
tagFunction('Entity storage and initialization', s => s.includes('z.fill(-1)') && s.includes('r[27]'));
tagFunction('Render-target resizing', s => s.includes('getBoundingClientRect'));
tagFunction('Render frame', s => s.includes('createRenderPass') || s.includes('beginRenderPass'));
tagFunction('GPU picking', s => s.includes('copyTextureToBuffer') && s.includes('mapAsync'));
for (const n of nodes.filter(n => n.type === 'TemplateLiteral' || n.type === 'Literal')) {
  const s = text(n);
  if (s.includes('@vertex') || s.includes('@compute')) {
    tag(n.start, n.end, s.includes('vs_main') && s.includes('vs_post') ? 'Shader: unified' : s.includes('vs_main') ? 'Shader: voxel renderer' : s.includes('vs_post') ? 'Shader: postprocess' : 'Shader: entity/light compute');
  }
}
const voxelFiles = [...fs.readFileSync('src/vvm.js', 'utf8').matchAll(/\.\.\/vox\/([^"']+\.vp)/g)].map(match => match[1]);
for (const file of voxelFiles) {
  const name = file.slice(0, -3);
  const encoded = Buffer.from(assemble(fs.readFileSync(`vox/${name}.vp`, 'utf8'))).toString('base64');
  let count = 0;
  for (let i = code.indexOf(encoded); i !== -1; i = code.indexOf(encoded, i + encoded.length)) {
    tag(i, i + encoded.length, `Model: ${name}`); count++;
  }
  if (!count) throw Error(`Compiled ${name} did not match; rebuild first`);
}
function numericData(n) {
  if (n === null) return null;
  if (n.type === 'ArrayExpression') return n.elements.map(numericData);
  if (n.type === 'Literal') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '-') return -numericData(n.argument);
  if (n.type === 'ObjectExpression' && !n.properties.length) return {};
  throw Error(`Unexpected track data: ${n.type}`);
}
for (const name of ['reload', 'hurt']) {
  const source = fs.readFileSync(`music/${name}.zzfxm`, 'utf8').replace(/[{][^}]*[}]/gm, '{}');
  const expected = JSON.stringify(numericData(parseAst(`(${source})`).body[0].expression));
  const track = declarations.find(n => {
    if (n.init?.type !== 'ArrayExpression') return false;
    try { return JSON.stringify(numericData(n.init)) === expected; } catch { return false; }
  });
  if (!track) throw Error(`Track ${name} did not match`);
  tag(track.init.start, track.init.end, `Track: ${name}`);
}
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'js13k-audit-'));
function pack(source) {
  const { firstLine, secondLine } = new Packer([{ data: source, type: 'js', action: 'eval' }], settings).makeDecoder();
  return html.replace(match[0], () => `<script>${firstLine}\n${secondLine}</script>`);
}
function zipSize(contents) {
  const input = path.join(scratch, 'index.html'), zip = path.join(scratch, 'index.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  fs.writeFileSync(input, contents);
  execFileSync(ect, ['-strip', '-zip', '-10009', input], { stdio: 'pipe' });
  execFileSync(advzip, ['-4', '-z', zip], { stdio: 'pipe' });
  return fs.statSync(zip).size;
}
const baseline = zipSize(pack(code)), actual = fs.statSync('dist/index.zip').size;
if (baseline !== actual) throw Error(`Repacked ZIP ${baseline} differs from release ${actual}`);
console.log(`Baseline: ${baseline} ZIP bytes; ${13312 - baseline} remaining`);
function measure(name, matches) {
  const kept = [], removed = [];
  for (let i = 0; i < code.length; i++) (matches(labels[i]) ? removed : kept).push(code[i]);
  const row = { name, rawBytes: Buffer.byteLength(removed.join('')), marginalZipBytes: baseline - zipSize(pack(kept.join(''))) };
  console.log(JSON.stringify(row));
  return row;
}
const rows = [...new Set(labels)].map(name => measure(name, label => label === name));
if (rows.reduce((s, r) => s + r.rawBytes, 0) !== Buffer.byteLength(code)) throw Error('Incomplete partition');
const groups = [
  measure('All shaders', n => n.startsWith('Shader:')),
  measure('All audio and tracks', n => n.startsWith('Audio') || n.startsWith('Track:')),
  measure('All model data', n => n.startsWith('Model:')),
  measure('Voxel system and models', n => n.startsWith('Voxel') || n.startsWith('Model:')),
];
rows.sort((a, b) => b.marginalZipBytes - a.marginalZipBytes);
const zip = fs.readFileSync('dist/index.zip');
const central = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const payload = zip.readUInt32LE(central + 20);
const report = { baselineZipBytes: baseline, remainingBytes: 13312 - baseline,
  packedHtmlBytes: Buffer.byteLength(html), decodedJsBytes: Buffer.byteLength(code),
  compressedPayloadBytes: payload, archiveOverheadBytes: baseline - payload, packingSettings: settings, groups, rows };
const output = path.resolve(process.argv[2] || path.join(scratch, 'report.json'));
fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
const table = list => '| Section | Decoded bytes | ZIP reduction when excised |\n|---|---:|---:|\n' + list.map(r => `| ${r.name} | ${r.rawBytes} | ${r.marginalZipBytes} |`).join('\n');
fs.writeFileSync(output.replace(/\.json$/, '') + '.md', `# Production size audit\n\nZIP: **${baseline} / 13,312 bytes**, **${13312 - baseline} bytes spare**. Packed HTML: ${report.packedHtmlBytes} bytes; decoded JavaScript: ${report.decodedJsBytes} bytes. ZIP payload: ${payload} bytes; archive overhead: ${baseline - payload} bytes.\n\n${table(groups)}\n\n${table(rows)}\n\n## Method and limits\n\nThe current release is decoded without executing the game. AST ranges classify code, and model bytecode plus reload/hurt tracks are matched against current source. Every experiment runs through the same fixed Roadroller settings, ECT and advzip as production. An unchanged repack must exactly match the shipped ZIP. Raw rows partition decoded JavaScript, excluding the generated unpacker and HTML wrapper.\n\nExcision results are **non-additive compression probes**, not working feature-removal patches or guaranteed savings. Other sections retain references to removed code. Aggregate rows are independently measured, not summed. Shared compression and the unpacker change with each probe. Renderer/shared JS includes browser startup, GPU setup, input, and functions not classified elsewhere. No gameplay changes are made.\n\nReproduce: npm run build, then node scripts/size-audit.mjs <output.json>. The script fails if expected structures or assets change.\n`);
console.log(`Report: ${output}`);

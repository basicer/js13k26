// Compare production packaging without modifying the game or dist output.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { Packer } from 'roadroller';
import { parseAst } from 'rolldown/parseAst';
import ect from 'ect-bin';
import advzip from 'advzip-bin';

const html = fs.readFileSync('dist/index.html', 'utf8');
const match = /<script>([\s\S]*?)<\/script>/.exec(html);
if (!match) throw Error('Build production first');
const code = match[1];
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'js13k-packing-'));
function zipSize(contents) {
  const input = path.join(scratch, 'index.html');
  const zip = path.join(scratch, 'index.zip');
  if (fs.existsSync(zip)) fs.unlinkSync(zip);
  fs.writeFileSync(input, contents);
  execFileSync(ect, ['-strip', '-zip', '-10009', input], { stdio: 'pipe' });
  execFileSync(advzip, ['-4', '-z', zip], { stdio: 'pipe' });
  return fs.statSync(zip).size;
}
function canonical(source) {
  return JSON.stringify(parseAst(source), (key, value) =>
    ['start', 'end', 'raw', 'loc', 'range'].includes(key) ? undefined : value);
}
const expected = canonical(code);
const baseline = zipSize(html);
console.log(JSON.stringify({ baseline, scratch }));
for (const maxMemoryMB of [32, 150]) {
  const start = performance.now();
  const packer = new Packer([{ data: code, type: 'js', action: 'eval' }], { maxMemoryMB });
  await packer.optimize(1);
  const { firstLine, secondLine } = packer.makeDecoder();
  const packed = firstLine + '\n' + secondLine;
  if (/<\/script/i.test(packed)) throw Error('Unsafe inline script terminator');
  let decoded;
  const decodeStart = performance.now();
  vm.runInNewContext(packed, { eval: value => { decoded = value; } }, { timeout: 10000 });
  const decodeMs = Math.round(performance.now() - decodeStart);
  if (typeof decoded !== 'string' || canonical(decoded) !== expected) throw Error('Decoded AST differs');
  const packedHtml = html.slice(0, match.index) + `<script>${packed}</script>` + html.slice(match.index + match[0].length);
  const size = zipSize(packedHtml);
  fs.writeFileSync(path.join(scratch, `roadroller-${maxMemoryMB}.html`), packedHtml);
  console.log(JSON.stringify({ maxMemoryMB, zipBytes: size, savedBytes: baseline - size, decodeMs, elapsedSeconds: Math.round((performance.now() - start) / 1000), verified: 'decoded AST equals original' }));
}

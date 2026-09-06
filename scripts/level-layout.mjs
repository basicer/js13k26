import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync("src/level.js", "utf8");
const plan = /const plan = "([^"]+)"/.exec(source)?.[1];
if (!plan) throw Error("Could not find the typed level plan in src/level.js");

const styles = [
	["bulkhead", "#263344"], ["window", "#75cedb"], ["crate", "#9b633d"],
	["pylon", "#754b90"], ["reactor", "#c34b64"], ["console", "#3bc9e8"],
	["rail", "#d6bb3b"], ["light", "#f7f0a3"], ["floor", "#142330"],
];
const size = (type, width, depth) => type ? [
	[6, .2], [.75, .75], [1.5, 1.5], [2.5, 3.6], [1, 1], [.2, 6], [.1, .1],
][type - 1] : [width, depth];
const things = [], actors = [];
let section = -1;
for (let i = 0; i < plan.length;) {
	const type = plan.charCodeAt(i++) - 48;
	if (type === 9) { section++; continue; }
	let x = plan.charCodeAt(i++) - 64, z = plan.charCodeAt(i++) - 64, width, depth;
	if (type > 9) { actors.push({type,x,z,section}); continue; }
	if (type > 1 && type !== 8) [width, depth] = size(type);
	else [width, depth] = [plan.charCodeAt(i++) - 48, plan.charCodeAt(i++) - 48];
	if (type === 5) { x += .25; z -= .4; }
	things.push({ section, type, x, z, width, depth });
}

const scale = 26, edge = 18, point = (x, z) => [edge + (x + 16) * scale, edge + (16 - z) * scale];
const rect = ({ section, type, x, z, width, depth }) => {
	const [left, top] = point(x - width / 2, z + depth / 2);
	const [name, baseColor] = styles[type];
	const color = type === 8 ? ["#20312c", "#25303c", "#302b21", "#183a40", "#30233c"][section] : baseColor;
	if (type === 7) { const [cx, cy] = point(x, z); return `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}"/><title>light at ${x}, ${z}</title>`; }
	return `<rect class="${name}" x="${left}" y="${top}" width="${width * scale}" height="${depth * scale}" fill="${color}"/><title>${name} at ${x}, ${z}</title>`;
};
const grid = Array.from({ length: 33 }, (_, i) => {
	const p = edge + i * scale;
	return `<path d="M${p} ${edge}V${edge + 32 * scale}M${edge} ${p}H${edge + 32 * scale}"/>`;
}).join("");
const route = [[-11, -11], [-3, -11], [-3, -4], [-1, -3], [0, 1], [8, 1], [9, 3], [9, 7], [9, 10]]
	.map(p => point(...p).join(",")).join(" ");
const labels = [[-11, -12, "01 START"], [-3, -8, "02 HALLWAY"], [0, 4, "03 CARGO"], [8, 0, "04 ELEVATOR"], [9, 11, "05 BOSS ROOM"]]
	.map(([x, z, label]) => { const [px, py] = point(x, z); return `<text x="${px}" y="${py}">${label}</text>`; }).join("");
// Actor markers come from the same ordered plan as scenery.
const portals = actors.filter(e => e.type === 10).map(({x,z}) => {
	const yaw = Math.PI / 2;
	const [px,py] = point(x,z);
	return `<g transform="translate(${px} ${py}) rotate(${-yaw*180/Math.PI})"><title>Portal at ${x}, ${z}; arrow points into room</title><path d="M-42 0H42" stroke="#ff647e" stroke-width="9"/><path d="M0 -8V-27m-7 7 7-7 7 7" fill="none" stroke="#ffb2bf" stroke-width="3"/></g>`;
}).join("");
const unicorns = actors.filter(e => e.type === 11).map(({x,z},i) => {
	const [px,py] = point(x,z);
	return `<g><title>Unicorn ${i+1} at ${x}, ${z}</title><circle cx="${px}" cy="${py}" r="11" fill="#e2a1ff" stroke="#fff0ff" stroke-width="2"/><text x="${px}" y="${py+4}" style="fill:#281135;letter-spacing:0">U</text></g>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${edge * 2 + 32 * scale} ${edge * 2 + 32 * scale}" role="img" aria-label="Typed level layout preview">
<style>.window{stroke:#d5faff;stroke-width:2;stroke-dasharray:5 3}svg{background:#0b1118}.grid{stroke:#18232f;stroke-width:1}.bulkhead{stroke:#5c7792;stroke-width:2}.rail{stroke:#f2d45b;stroke-width:2}.crate{stroke:#e4a16c;stroke-width:2}.pylon{stroke:#c894e9;stroke-width:2}.reactor{stroke:#ff8294;stroke-width:2}.console{stroke:#b4f7ff;stroke-width:2}polyline{fill:none;stroke:#65e7ff;stroke-width:3;stroke-dasharray:8 6}text{fill:#d7e4ef;font:12px system-ui,sans-serif;text-anchor:middle;letter-spacing:1px}</style>
<rect width="100%" height="100%" fill="#0b1118"/>${things.filter(t => t.type === 8).map(rect).join("")}<g class="grid">${grid}</g><polyline points="${route}"/>${things.filter(t => t.type !== 8).map(rect).join("")}${portals}${unicorns}${labels}<text x="230" y="65">PINK BAR + ARROW: PORTAL / FACING</text><text x="230" y="86">PURPLE U: INITIAL UNICORN</text><text x="230" y="107">CYAN DASHES: PLAYER ROUTE</text></svg>`;
writeFileSync("reports/level-layout.svg", svg);
console.log(`Decoded ${things.length} records into reports/level-layout.svg`);


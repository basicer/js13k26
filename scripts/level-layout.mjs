import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync("src/level.js", "utf8");
const encoded = /const plan = (\[[^;]+\]);/.exec(source)?.[1];
const plan = encoded && JSON.parse(encoded);
if (!plan) throw Error("Could not find the typed level plan in src/level.js");

const styles = [
	["bulkhead", "#263344"], ["window", "#75cedb"], ["crate", "#9b633d"],
	["pylon", "#754b90"], ["reactor", "#c34b64"], ["console", "#3bc9e8"],
	["rail", "#d6bb3b"], ["light", "#f7f0a3"], ["floor", "#142330"],
];
styles[12] = ["door", "#d69b52"];
styles[13] = ["shaft", "#556174"];
styles[14] = ["rail", "#d6bb3b"];
styles[15] = ["track", "#b4bcc5"];
const size = (type, width, depth) => type ? [
	[6, .2], [.75, .75], [1.5, 1.5], [2.5, 3.6], [1, 1], [.2, 6], [.1, .1],
][type - 1] : [width, depth];
const things = [], actors = [];
let section = -1;
for (let i = 0; i < plan.length;) {
	const type = plan[i++];
	if (type === 9) { section++; continue; }
	let x = plan[i++] - 16, z = plan[i++] - 16, width, depth;
	if (type === 10 || type === 11 || type === 16) { actors.push({type,x,z,section}); continue; }
	if (type > 1 && type !== 8 && type < 12) [width, depth] = size(type);
	else [width, depth] = [plan[i++], plan[i++]];
	if (type === 13 || type === 15) i += 2; // Height and bottom.
	if (type === 2) i++; // Crate contents.
	if (type === 5) z -= .4;
	things.push({ section, type, x, z, width, depth });
}

const scale = 14, edge = 24, header = 80;
const minX = Math.floor(Math.min(...things.map(t => t.x-t.width/2)))-2;
const maxX = Math.ceil(Math.max(...things.map(t => t.x+t.width/2)))+2;
const minZ = Math.floor(Math.min(...things.map(t => t.z-t.depth/2)))-2;
const maxZ = Math.ceil(Math.max(...things.map(t => t.z+t.depth/2)))+2;
const width = edge*2+(maxX-minX)*scale, height = header+edge*2+(maxZ-minZ)*scale;
const point = (x,z) => [edge+(x-minX)*scale,header+edge+(maxZ-z)*scale];
const rect = ({ section, type, x, z, width, depth }) => {
	const [left, top] = point(x - width / 2, z + depth / 2);
	const [name, baseColor] = styles[type];
	const color = type === 8 ? ["#20312c", "#25303c", "#302b21", "#183a40", "#30233c"][section] : baseColor;
	if (type === 7) { const [cx, cy] = point(x, z); return `<circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/><title>light at ${x}, ${z}</title>`; }
	return `<rect class="${name}" x="${left}" y="${top}" width="${width * scale}" height="${depth * scale}" fill="${color}"/><title>${name} at ${x}, ${z}</title>`;
};
const grid = [];
for (let x=minX; x<=maxX; x+=2) { const [px,py]=point(x,maxZ); grid.push(`<path d="M${px} ${py}V${point(x,minZ)[1]}"/>`); }
for (let z=minZ; z<=maxZ; z+=2) { const [px,py]=point(minX,z); grid.push(`<path d="M${px} ${py}H${point(maxX,z)[0]}"/>`); }
const route = [[-11,-11],[-10,-12],[2,-12],[2,8],[-6,8],[-6,14],[-12.5,14],[-13,20],[-17.5,20],[-37.5,20],[-37.5,14],[-37.5,9],[-45.5,9],[-45.5,3]]
	.map(p => point(...p).join(",")).join(" ");
const labels = [[-12,-9,"01 START"],[2,-2,"02 HALLWAY"],[-6,22,"03 CARGO"],[-17.5,22,"04 ELEVATOR"],[-45.5,10,"05 BOSS ROOM"]]
	.map(([x, z, label]) => { const [px, py] = point(x, z); return `<text x="${px}" y="${py}">${label}</text>`; }).join("");
// Actor markers come from the same ordered plan as scenery.
const portals = actors.filter(e => e.type === 10 || e.type === 16).map(({type,x,z}) => {
	const yaw = (type === 16 ? -1 : 1) * Math.PI / 2;
	const [px,py] = point(x,z);
	return `<g transform="translate(${px} ${py}) rotate(${-yaw*180/Math.PI})"><title>Portal at ${x}, ${z}; arrow points into room</title><path d="M-23 0H23" stroke="#ff647e" stroke-width="6"/><path d="M0 -8V-27m-7 7 7-7 7 7" fill="none" stroke="#ffb2bf" stroke-width="3"/></g>`;
}).join("");
const unicorns = actors.filter(e => e.type === 11).map(({x,z},i) => {
	const [px,py] = point(x,z);
	return `<g><title>Unicorn ${i+1} at ${x}, ${z}</title><circle cx="${px}" cy="${py}" r="8" fill="#e2a1ff" stroke="#fff0ff" stroke-width="2"/><text x="${px}" y="${py+4}" style="fill:#281135;letter-spacing:0">U</text></g>`;
}).join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Typed level layout preview">
<style>.window{stroke:#d5faff;stroke-width:2;stroke-dasharray:5 3}svg{background:#0b1118}.grid{stroke:#18232f;stroke-width:1}.bulkhead{stroke:#5c7792;stroke-width:2}.rail{stroke:#f2d45b;stroke-width:2}.crate{stroke:#e4a16c;stroke-width:2}.pylon{stroke:#c894e9;stroke-width:2}.reactor{stroke:#ff8294;stroke-width:2}.console{stroke:#b4f7ff;stroke-width:2}polyline{fill:none;stroke:#65e7ff;stroke-width:3;stroke-dasharray:8 6}text{fill:#d7e4ef;font:12px system-ui,sans-serif;text-anchor:middle;letter-spacing:1px}</style>
<rect width="100%" height="100%" fill="#0b1118"/>${things.filter(t => t.type === 8).map(rect).join("")}<g class="grid">${grid.join("")}</g><polyline points="${route}"/>${things.filter(t => t.type !== 8).map(rect).join("")}${portals}${unicorns}${labels}<text x="${width/2}" y="28" style="font-size:20px;fill:#f0f7ff">G&amp;G · REACTOR APPROACH</text><text x="${width/2}" y="53">START → HALLWAY → CARGO → ELEVATOR → BOSS</text><text x="${width/2}" y="76">PINK: PORTALS · PURPLE: UNICORNS · CYAN DASHES: ROUTE · GRID: 2 UNITS</text></svg>`;
writeFileSync("reports/level-layout.svg", svg);
console.log(`Decoded ${things.length} records into reports/level-layout.svg`);


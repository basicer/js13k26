import { COMMAND_NAMES, OP_PUSHI, OP_VSTOREI, OP_STROKEI } from "./vvm-const.js";
import { resolveVoxelConstants } from "./vvm-symbols.js";

// Explicit immediate syntax is opcode-first; normal source is fused automatically.
export function expandVoxelImmediates(code) {
	code = resolveVoxelConstants(code);
	return code.replace(
		/(?<!\S)(vstorei|strokei)(?::([0-7]))?\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)(?=\s|$)/gi,
		(match, op, arg, x, y, z, offset) => {
			if (/\b(?:jumpif|loop|forjump)\s*$/i.test(code.slice(0, offset))) return match;
			if (op.toLowerCase() === "strokei" && arg !== undefined && arg !== "2")
				throw Error("STROKEI always swaps endpoints; use STROKEI or STROKEI:SWAP.");
			const expanded =
				x +
				" " +
				y +
				" " +
				z +
				" VEC " +
				(op.toLowerCase() === "vstorei" ? "VSTORE:" + (arg || 0) : "VSTORE:1 STROKE:2");
			return expanded + "\n".repeat((match.match(/\n/g) || []).length);
		},
	);
}

export function assemble(code) {
	code = expandVoxelImmediates(code);
	let cmds = code.trim().split(/\s+/);
	let bytecode = [];
	const labels = new Map();
	const jumps = [];
	for (let i = 0; i < cmds.length; i++) {
		let cmd = cmds[i];
		if (cmd == "") continue;
		if (cmd.endsWith(":")) {
			const name = cmd.slice(0, -1);
			if (labels.has(name)) throw Error(`Duplicate label: ${name}`);
			labels.set(name, bytecode.length);
			continue;
		}
		if (/^(jumpif|loop|forjump)$/i.test(cmd)) {
			jumps.push({ at: bytecode.length, label: cmds[++i] });
			bytecode.push(COMMAND_NAMES[cmd.toLowerCase()] << 3, 0);
			continue;
		}
		let parts = cmd.split(":");

		if (/^-?\d+$/.test(cmd)) {
			let values = [];
			while (i < cmds.length && /^-?\d+$/.test(cmds[i])) {
				const value = Number(cmds[i++]);
				if (value < -128 || value > 127) throw Error(`Signed byte out of range: ${value}`);
				values.push(value);
			}
			// Only consume consecutive literal tokens; labels remain fusion barriers.
			const store = /^vstore(?::([0-7]))?$/i.exec(cmds[i + 1] || "");
			const fused = values.length >= 3 && /^vec(?::0)?$/i.test(cmds[i] || "") && store;
			const vector = fused ? values.splice(-3) : null;
			while (values.length) {
				const batch = values.splice(0, 7);
				bytecode.push((OP_PUSHI << 3) | batch.length, ...batch);
			}
			if (fused) {
				const stroke = /^stroke(?::([0-3]))?$/i.exec(cmds[i + 2] || "");
				// Swap paths win after ZIP compression; fusing plain/paint strokes currently grows it.
				const draw = Number(store[1] || 0) === 1 && stroke && Number(stroke[1]) === 2;
				bytecode.push(
					((draw ? OP_STROKEI : OP_VSTOREI) << 3) | Number(draw ? stroke[1] || 0 : store[1] || 0),
					...vector,
				);
				i += draw ? 3 : 2;
			}
			i--;
			continue;
		} else {
			let op = COMMAND_NAMES[parts[0].toLowerCase()],
				arg = Number(parts[1] || 0);
			if (op === undefined || op === OP_VSTOREI || op === OP_STROKEI)
				throw Error("Unknown instruction or missing immediate vector: " + cmd);
			bytecode.push((op << 3) | arg);
		}
	}
	for (const { at, label } of jumps) {
		if (!labels.has(label)) throw Error(`Undefined label: ${label}`);
		const offset = labels.get(label) - (at + 2);
		if (offset < -1024 || offset > 1023)
			throw Error(`Jump to ${label} out of range: ${offset} bytes (expected -1024 to 1023).`);
		const encoded = offset & 2047;
		bytecode[at] |= encoded >> 8;
		bytecode[at + 1] = encoded & 255;
	}
	let result = Uint8Array.from(bytecode);
	return result;
}

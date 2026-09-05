import {
	COMMAND_NAMES,
	OP_PUSHI,
	OP_VEC,
	OP_VSTORE,
	OP_VSTORE3,
	OP_JUMPIF,
} from "./vvm-const.js";
import { resolveVoxelConstants } from "./vvm-symbols.js";

export function assemble(code) {
	code = resolveVoxelConstants(code);
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
		if (cmd.toLowerCase() === "jumpif") {
			jumps.push({ at: bytecode.length, label: cmds[++i] });
			bytecode.push(OP_JUMPIF << 3, 0);
			continue;
		}
		let parts = cmd.split(":");

		if (parseInt(cmd) == cmd) {
			let values = [];
			while (
				i < cmds.length &&
				parseInt(cmds[i]) == cmds[i] &&
				values.length < 7
			) {
				values.push(parseInt(cmds[i++]));
			}
			bytecode.push((OP_PUSHI << 3) | values.length, ...values);
			i--;
			continue;
		} else {
			let op = COMMAND_NAMES[parts[0].toLowerCase()],
				arg = Number(parts[1] || 0);
			// Fuse at the token level so literal payload bytes can never match opcodes.
			const next = cmds[i + 1]?.split(":");
			if (
				op === OP_VEC &&
				arg === 0 &&
				next &&
				!cmds[i + 1].endsWith(":") &&
				COMMAND_NAMES[next[0].toLowerCase()] === OP_VSTORE
			) {
				op = OP_VSTORE3;
				arg = Number(next[1] || 0);
				i++;
			}
			bytecode.push((op << 3) | arg);
		}
	}
	for (const { at, label } of jumps) {
		if (!labels.has(label)) throw Error(`Undefined label: ${label}`);
		const offset = labels.get(label) - (at + 2);
		if (offset < -1024 || offset > 1023)
			throw Error(
				`Jump to ${label} out of range: ${offset} bytes (expected -1024 to 1023).`,
			);
		const encoded = offset & 2047;
		bytecode[at] |= encoded >> 8;
		bytecode[at + 1] = encoded & 255;
	}
	let result = Uint8Array.from(bytecode);
	return result;
}

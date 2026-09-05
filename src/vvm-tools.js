import {
	COMMAND_NAMES,
	OP_PUSHI,
	OP_VEC,
	OP_VSTORE,
	OP_VSTORE3,
} from "./vvm-const.js";
import { resolveVoxelConstants } from "./vvm-symbols.js";

export function assemble(code) {
	code = resolveVoxelConstants(code);
	let cmds = code.trim().split(/\s+/);
	let bytecode = [];
	for (let i = 0; i < cmds.length; i++) {
		let cmd = cmds[i];
		if (cmd == "") continue;
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
				COMMAND_NAMES[next[0].toLowerCase()] === OP_VSTORE
			) {
				op = OP_VSTORE3;
				arg = Number(next[1] || 0);
				i++;
			}
			bytecode.push((op << 3) | arg);
		}
	}
	let result = Uint8Array.from(bytecode);
	return result;
}

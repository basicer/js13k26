import { COMMAND_NAMES, OP_PUSHI } from "./vvm-const.js";

export function assemble(code) {
	code = code.replace(/\/\/.*$/gim, "");
	console.log("assembling", code);
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
			bytecode.push(
				(COMMAND_NAMES[parts[0].toLowerCase()] << 3) | parts[1],
			);
		}
	}
	let result = Uint8Array.from(bytecode);
	return result;
}

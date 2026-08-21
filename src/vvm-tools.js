import { COMMAND_NAMES, OP_PUSHI } from "./vvm-const.js";

export function assemble(code){
    code = code.replace(/\/\/.*$/img, "");
    console.log("assembling", code);
    let cmds = code.trim().split(/\s+/);
    let bytecode = [];
    for (let i = 0; i < cmds.length; i++) {
        let cmd = cmds[i];
        if (cmd == "") continue;
        let parts = cmd.split(":");

        // TODO Multiple numbers in a row can use one PUSHI opcode
        if (parseInt(cmd) == cmd) {
            bytecode.push(OP_PUSHI << 3 | 1);
            bytecode.push(parseInt(cmd));
            continue;
        } else {
            bytecode.push(COMMAND_NAMES[parts[0].toLowerCase()] << 3 | parts[1]);
        }
    };
    let result = Uint8Array.from(bytecode);
    return result;
}
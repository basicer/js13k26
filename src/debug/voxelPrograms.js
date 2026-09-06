import { compileVoxelSource } from "./voxelValidation.js";
import { OP_PUSHI, OP_JUMPIF, OP_FORJUMP, OP_LOOP, OP_VSTOREI, OP_STROKEI } from "../vvm-const.js";
import { resolveVoxelConstants } from "../vvm-symbols.js";

export const voxelPrograms = new Map();

// Parameter declarations are implicit: every LOADP subopcode used by a program
// becomes an editable preview value.
export function voxelParameterIndices(source) {
	try {
		const indices = new Set();
		let jumpTarget = false;
		for (const token of resolveVoxelConstants(source).match(/\S+/g) || []) {
			if (jumpTarget) {
				jumpTarget = false;
				continue;
			}
			if (/^(jumpif|loop|forjump)$/i.test(token)) {
				jumpTarget = true;
				continue;
			}
			const match = /^loadp(?::([0-7]))?$/i.exec(token);
			if (match) indices.add(Number(match[1] || 0));
		}
		return [...indices].sort((a, b) => a - b);
	} catch {
		return [];
	}
}

// Each boundary ends a complete VM instruction, including its literal payload.
export function voxelInstructionEnds(bytecode) {
	const ends = [0];
	for (let pc = 0; pc < bytecode.length;) {
		const cmd = bytecode[pc++];
		if (cmd >> 3 === OP_PUSHI) pc += cmd & 7;
		if (cmd >> 3 === OP_JUMPIF || cmd >> 3 === OP_LOOP || cmd >> 3 === OP_FORJUMP) pc++;
		if (cmd >> 3 === OP_VSTOREI || cmd >> 3 === OP_STROKEI) pc += 3;
		if (pc > bytecode.length) throw Error("Incomplete instruction payload.");
		ends.push(pc);
	}
	return ends;
}

export function registerVoxelProgram(slot, { file, source }, run) {
	const bytecode = compileVoxelSource(source);
	const instructionEnds = voxelInstructionEnds(bytecode);
	const program = {
		slot,
		file,
		original: source,
		text: [source],
		applied: source,
		run,
		key: `js13k26:voxel:${file}`,
		bytes: bytecode.length,
		bytecode,
		instructionEnds,
		instructionLimit: [instructionEnds.length - 1],
		parameters: Array.from({ length: 8 }, () => [0]),
		message: "Ready",
		error: false,
		storageError: "",
		timer: null,
	};
	try {
		program.text[0] = localStorage.getItem(program.key) ?? source;
	} catch (error) {
		program.storageError = `Local storage unavailable: ${error.message}`;
	}
	voxelPrograms.set(slot, program);
	// Registration happens after the bundled models have finished loading.
	if (program.text[0] !== source) queueVoxelPreview(program);
}

export function storeVoxelDraft(program) {
	try {
		localStorage.setItem(program.key, program.text[0]);
		program.storageError = "";
	} catch (error) {
		program.storageError = `Draft could not be stored: ${error.message}`;
	}
}

export function previewVoxelProgram(program) {
	clearTimeout(program.timer);
	try {
		const source = program.text[0];
		const parameters = program.parameters.map(([value]) => value);
		const bytecode = compileVoxelSource(source, [0, ...parameters.slice(1)]);
		// Both variants must be safe before replacing either preview texture.
		compileVoxelSource(source, [1, ...parameters.slice(1)]);
		const ends = source === program.applied ? program.instructionEnds : voxelInstructionEnds(bytecode);
		const count = ends.length - 1;
		const limit =
			program.instructionLimit[0] === program.instructionEnds.length - 1
				? count
				: Math.max(0, Math.min(count, Math.trunc(program.instructionLimit[0])));
		const start = performance.now();
		program.run(bytecode.subarray(0, ends[limit]), parameters);
		program.applied = source;
		program.bytes = bytecode.length;
		program.bytecode = bytecode;
		program.instructionEnds = ends;
		program.instructionLimit[0] = limit;
		program.message = `Preview updated in ${(performance.now() - start).toFixed(1)} ms`;
		program.error = false;
		return true;
	} catch (error) {
		program.message = error.message;
		program.error = true;
		return false;
	}
}

export function queueVoxelPreview(program, delay = 0) {
	clearTimeout(program.timer);
	program.timer = setTimeout(() => previewVoxelProgram(program), delay);
}

export function resetVoxelProgram(program) {
	clearTimeout(program.timer);
	try {
		localStorage.removeItem(program.key);
		program.storageError = "";
	} catch (error) {
		program.storageError = `Stored draft could not be cleared: ${error.message}`;
	}
	program.text[0] = program.original;
	program.instructionLimit[0] = program.instructionEnds.length - 1;
	queueVoxelPreview(program);
}

export function saveVoxelProgram(program) {
	storeVoxelDraft(program);
	let url, link;
	try {
		url = URL.createObjectURL(new Blob([program.text[0]], { type: "text/plain;charset=utf-8" }));
		link = document.createElement("a");
		link.href = url;
		link.download = program.file.split("/").pop();
		document.body.appendChild(link);
		link.click();
		program.message = `Downloaded ${link.download}`;
		program.error = false;
	} catch (error) {
		program.message = error.message;
		program.error = true;
	} finally {
		link?.remove();
		if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
}

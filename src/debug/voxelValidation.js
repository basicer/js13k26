import { assemble, expandVoxelImmediates } from "../vvm-tools.js";

// Editor-only validation: reject malformed programs before they reach the VM.
export function compileVoxelSource(source, parameters = []) {
	if (typeof source !== "string" || source.length > 65535) throw Error("Source must fit in 65,535 characters.");
	source = expandVoxelImmediates(source);
	const stack = [],
		vectors = Array.from({ length: 8 }, () => [0, 0, 0]);
	vectors[7] = [63, 63, 63];
	let dimensions = [64, 64, 64];
	const floats = [1, 2, 5, 0, 0, 0, 0, 0];
	const bytecode = assemble(source);
	const tokens = source
		.split(/\r?\n/)
		.flatMap((text, line) => (text.match(/\S+/g) || []).map((token) => ({ token, line })));
	const labels = new Map();
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i].token.endsWith(":")) labels.set(tokens[i].token.slice(0, -1), i);
	}
	let work = 0,
		steps = 0;
	for (let pc = 0; pc < tokens.length; pc++) {
		const { token, line } = tokens[pc];
		const fail = (message) => {
			throw Error(`Line ${line + 1}: ${message}`);
		};
		const pop = (vector) => {
			const value = stack.pop();
			if (value === undefined || Array.isArray(value) !== vector)
				fail(vector ? "Expected a vector on the stack." : "Expected a number on the stack.");
			return value;
		};
		if (++steps > 100000) fail("Program exceeds the editor's instruction limit (possible infinite loop).");
		if (token.endsWith(":")) continue;
		if (/^(jumpif|forjump)$/i.test(token)) {
			const target = tokens[++pc].token;
			if (token.toLowerCase() === "forjump") {
				if (stack.length) pc = labels.get(target);
			} else if (pop(false) !== 0) pc = labels.get(target);
			continue;
		}
		if (/^-?\d+$/.test(token)) {
			const n = Number(token);
			if (n < -128 || n > 127) fail("Literals must be signed 8-bit integers.");
			stack.push(n);
			continue;
		}
		const match = /^(vec|vload|vstore|fload|fstore|loadp|stroke|mirror|flip|size)(?::([0-7]))?$/i.exec(token);
		if (!match) fail(`Unknown instruction: ${token}`);
		const op = match[1].toLowerCase(),
			arg = Number(match[2] || 0);
		if (
			(op === "vec" && arg !== 0) ||
			(op === "size" && arg !== 0) ||
			(op === "stroke" && arg > 3) ||
			((op === "mirror" || op === "flip") && arg > 2)
		)
			fail(`Invalid subopcode: ${token}`);
		if (op === "vec") {
			const z = pop(false),
				y = pop(false),
				x = pop(false);
			const sizeVector = op === "vec" && tokens[pc + 1]?.token.toLowerCase() === "size";
			if ([x, y, z].some((n, axis) => n > (sizeVector ? 127 : dimensions[axis] - 1)))
				fail("Voxel coordinates must fit the declared model size.");
			stack.push([x, y, z]);
		} else if (op === "size") {
			const size = pop(true).map((n) => (n === -128 ? 128 : n));
			if (size.some((n) => n < 1 || n > 128)) fail("Model size must be between 1 and 128 voxels on each axis.");
			dimensions = size;
			vectors[7] = size.map((n) => n - 1);
		} else if (op === "vload") stack.push(vectors[arg]);
		else if (op === "vstore") vectors[arg] = pop(true);
		else if (op === "fload") stack.push(floats[arg]);
		else if (op === "fstore") floats[arg] = pop(false);
		else if (op === "loadp") {
			const value = parameters[arg] ?? 0;
			if (!Number.isFinite(value)) fail("Parameters must be finite numbers.");
			stack.push(value);
		} else if (op === "mirror" || op === "flip") work += dimensions.reduce((a, b) => a * b, 1);
		else if (op === "stroke") {
			const [, brush, radius] = floats;
			if (brush > 2 || radius > 64) fail("Brush must be 0–2 and radius must be 0–64.");
			const a = vectors[0],
				b = vectors[1];
			work += a.reduce((volume, n, axis) => {
				const pad = brush === 1 ? 0 : radius;
				const lo = Math.max(vectors[6][axis], (brush ? Math.min(n, b[axis]) : n) - pad);
				const hi = Math.min(vectors[7][axis], (brush ? Math.max(n, b[axis]) : n) + pad);
				return volume * Math.max(0, hi - lo + 1);
			}, 1);
			if (arg & 2) [vectors[0], vectors[1]] = [b, a];
		}
		if (work > 8000000) fail("Program exceeds the editor's voxel work limit.");
	}
	return bytecode;
}

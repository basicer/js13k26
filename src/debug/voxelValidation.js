import { assemble } from "../vvm-tools.js";
import { resolveVoxelConstants } from "../vvm-symbols.js";

// Editor-only validation: reject malformed programs before they reach the VM.
export function compileVoxelSource(source) {
	if (typeof source !== "string" || source.length > 65535)
		throw Error("Source must fit in 65,535 characters.");
	source = resolveVoxelConstants(source);
	const stack = [],
		vectors = Array.from({ length: 8 }, () => [0, 0, 0]);
	vectors[7] = [63, 63, 63];
	const floats = [1, 2, 5, 0, 0, 0, 0, 0];
	let work = 0;
	for (const [line, text] of source.split(/\r?\n/).entries()) {
		const fail = (message) => {
			throw Error(`Line ${line + 1}: ${message}`);
		};
		const pop = (vector) => {
			const value = stack.pop();
			if (value === undefined || Array.isArray(value) !== vector)
				fail(
					vector
						? "Expected a vector on the stack."
						: "Expected a number on the stack.",
				);
			return value;
		};
		for (const token of text.replace(/\/\/.*$/, "").match(/\S+/g) || []) {
			if (/^-?\d+$/.test(token)) {
				const n = Number(token);
				if (n < 0 || n > 255)
					fail("Literals must be integers from 0 to 255.");
				stack.push(n);
				continue;
			}
			const match =
				/^(vec|vload|vstore|vstore3|fload|fstore|stroke|mirror)(?::([0-7]))?$/i.exec(
					token,
				);
			if (!match) fail(`Unknown instruction: ${token}`);
			const op = match[1].toLowerCase(),
				arg = Number(match[2] || 0);
			if (
				(op === "vec" && arg !== 0) ||
				(op === "stroke" && arg > 3) ||
				(op === "mirror" && arg > 2)
			)
				fail(`Invalid subopcode: ${token}`);
			if (op === "vec" || op === "vstore3") {
				const z = pop(false),
					y = pop(false),
					x = pop(false);
				if (Math.max(x, y, z) > 63)
					fail("Voxel coordinates must be between 0 and 63.");
				if (op === "vec") stack.push([x, y, z]);
				else vectors[arg] = [x, y, z];
			} else if (op === "vload") stack.push(vectors[arg]);
			else if (op === "vstore") vectors[arg] = pop(true);
			else if (op === "fload") stack.push(floats[arg]);
			else if (op === "fstore") floats[arg] = pop(false);
			else if (op === "mirror") work += 64 ** 3;
			else if (op === "stroke") {
				const [, brush, radius] = floats;
				if (brush > 2 || radius > 64)
					fail("Brush must be 0–2 and radius must be 0–64.");
				const a = vectors[0],
					b = vectors[1];
				work += a.reduce((volume, n, axis) => {
					const pad = brush === 1 ? 0 : radius;
					const lo = Math.max(
						vectors[6][axis],
						(brush ? Math.min(n, b[axis]) : n) - pad,
					);
					const hi = Math.min(
						vectors[7][axis],
						(brush ? Math.max(n, b[axis]) : n) + pad,
					);
					return volume * Math.max(0, hi - lo + 1);
				}, 1);
				if (arg & 2) [vectors[0], vectors[1]] = [b, a];
			}
			if (work > 8000000)
				fail("Program exceeds the editor's voxel work limit.");
		}
	}
	return assemble(source);
}

import { COMMAND_NAMES } from "./vvm-const.js";

// Assembler/editor only: no names or lookup tables are shipped with the VM.
const constants = {
	MATERIAL: 0,
	BRUSH: 1,
	RADIUS: 2,
	START: 0,
	END: 1,
	CLIP_MIN: 6,
	CLIP_MAX: 7,
	SPHERE: 0,
	BOX: 1,
	CAPSULE: 2,
	X: 0,
	Y: 1,
	Z: 2,
	PAINT: 1,
	SWAP: 2,
	VOXEL_MIN: 0,
	VOXEL_MAX: 63,
	CENTER_LO: 31,
	CENTER_HI: 32,
	MAT_EMPTY: 0,
	MAT_WHITE: 1,
	MAT_COOL_WHITE: 2,
	MAT_BLUE_WHITE: 3,
	MAT_SHADOW_WHITE: 4,
	MAT_INK: 5,
	MAT_CHARCOAL: 7,
	MAT_TURQUOISE: 14,
	MAT_GOLD: 19,
	MAT_CORAL: 27,
	MAT_LAVENDER: 28,
	MAT_PINK: 31,
	MAT_PERIWINKLE: 43,
	MAT_PALE_GOLD: 41,
	MAT_PEACH: 45,
};

// Palette ramps from palette.js. Suffixes are zero-based shade indices.
for (const [name, start, count] of [
	["WHITE", 1, 4],
	["BLACK", 5, 4],
	["PASTEL", 9, 40],
	["OLIVE", 49, 24],
	["SKIN", 73, 16],
	["LEATHER", 89, 12],
	["GUNMETAL", 101, 4],
	["RED_GLASS", 105, 20],
	["BLUE_GLASS", 125, 20],
	["CLEAR_GLASS", 145, 12],
	["CONCRETE", 157, 20],
	["STEEL", 177, 12],
	["CYAN_EMISSIVE", 189, 12],
	["GRAY", 201, 16],
	["NEON", 217, 24],
]) {
	for (let i = 0; i < count; i++) constants[`MAT_${name}_${i}`] = start + i;
}

[
	"GLASS_CYAN",
	"YELLOW",
	"RED",
	"GREEN",
	"BLUE",
	"ORANGE",
	"MINT",
	"AMBER",
	"CRIMSON",
	"MAGENTA",
	"CYAN",
	"LIME",
	"BLACK",
	"WHITE",
	"PURE_RED",
].forEach((name, i) => {
	constants[`MAT_DEBUG_${name}`] = 241 + i;
});

export const VOXEL_CONSTANTS = Object.freeze(constants);

// Resolve both literal operands and instruction suffixes, preserving line numbers.
// Flags can be combined without spaces: STROKE:PAINT|SWAP.
export function resolveVoxelConstants(source) {
	return source
		.split(/\r?\n/)
		.map((line, index) => {
			const fail = (message) => {
				throw Error(`Line ${index + 1}: ${message}`);
			};
			const literal = (expression) =>
				expression.split("|").reduce((value, part) => {
					const name = part.toUpperCase();
					const n = /^\d+$/.test(part)
						? Number(part)
						: VOXEL_CONSTANTS[name];
					if (
						!Object.hasOwn(VOXEL_CONSTANTS, name) &&
						!/^\d+$/.test(part)
					)
						fail(`Unknown constant: ${part}`);
					if (!Number.isInteger(n) || n < 0 || n > 255)
						fail(`Literal out of range: ${part}`);
					return value | n;
				}, 0);
			return line.replace(/\/\/.*$/, "").replace(/\S+/g, (token) => {
				const [name, arg, extra] = token.split(":");
				if (
					arg !== undefined ||
					Object.hasOwn(COMMAND_NAMES, name.toLowerCase())
				) {
					if (
						!Object.hasOwn(COMMAND_NAMES, name.toLowerCase()) ||
						extra !== undefined
					)
						fail(`Unknown instruction: ${token}`);
					if (arg === undefined) return name;
					const value = literal(arg);
					if (value > 7) fail(`Subopcode out of range: ${token}`);
					return `${name}:${value}`;
				}
				return String(literal(token));
			});
		})
		.join("\n");
}

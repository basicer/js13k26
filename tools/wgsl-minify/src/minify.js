// Build-time lexical minification, not a WGSL optimizer or type checker.
// Grammar: https://www.w3.org/TR/WGSL/#textual-structure
const IDENTIFIER = /^[_\p{XID_Start}][_\p{XID_Continue}]*$/u;
const NUMBER =
	/^(?:0[xX](?:[\da-fA-F]*\.[\da-fA-F]+|[\da-fA-F]+\.[\da-fA-F]*)(?:[pP][+-]?\d+[fh]?)?|0[xX][\da-fA-F]+[pP][+-]?\d+[fh]?|0[xX][\da-fA-F]+[iu]?|(?:\d*\.\d+|\d+\.\d*)(?:[eE][+-]?\d+)?[fh]?|\d+[eE][+-]?\d+[fh]?|(?:0|[1-9]\d*)[fhiu]?)/;
const WORD = /^[_\p{XID_Start}][_\p{XID_Continue}]*/u;
const SYMBOL =
	/^(?:>>=|<<=|->|\+\+|--|&&|\|\||==|!=|>=|<=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<|>>|[{}()[\].,;:@+\-*/%&|^!~<>=])/;
const BLANK = /^[\s\u0085\u200e\u200f\u2028\u2029]+/u;
const LINE_END = /[\r\n\v\f\u0085\u2028\u2029]/u;
const DECLARATIONS = new Set([
	"struct",
	"fn",
	"let",
	"const",
	"override",
	"alias",
]);
const KEYWORDS = new Set(
	`alias break case const const_assert continue continuing default diagnostic discard else enable false fn for if let loop override requires return struct switch true var while`.split(
		" ",
	),
);
const FIXED_NAMES = new Set(
	`function private workgroup uniform storage handle read write read_write bool f16 f32 i32 u32 array atomic ptr sampler sampler_comparison binding_array exp fract whole old_value exchanged NULL`.split(
		" ",
	),
);
const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function tokenAt(source) {
	return (
		NUMBER.exec(source)?.[0] ||
		WORD.exec(source)?.[0] ||
		SYMBOL.exec(source)?.[0]
	);
}

function syntaxError(source, offset, message) {
	const lines = source.slice(0, offset).split(/\r\n|[\r\n]/);
	return new SyntaxError(
		`${message} at ${lines.length}:${lines.at(-1).length + 1}`,
	);
}

/** Tokenize without losing literal spelling or joining tokens across comments. */
export function tokenizeWgsl(source) {
	if (typeof source !== "string")
		throw new TypeError("WGSL source must be a string");
	const tokens = [];
	for (let offset = 0; offset < source.length;) {
		const rest = source.slice(offset);
		const blank = BLANK.exec(rest);
		if (blank) {
			offset += blank[0].length;
			continue;
		}
		if (rest.startsWith("//")) {
			const end = rest.search(LINE_END);
			offset += end < 0 ? rest.length : end;
			continue;
		}
		if (rest.startsWith("/*")) {
			const start = offset;
			let depth = 1;
			offset += 2;
			while (offset < source.length && depth) {
				if (source.startsWith("/*", offset)) {
					depth++;
					offset += 2;
				} else if (source.startsWith("*/", offset)) {
					depth--;
					offset += 2;
				} else offset++;
			}
			if (depth)
				throw syntaxError(source, start, "Unterminated block comment");
			continue;
		}
		const token = tokenAt(rest);
		if (!token)
			throw syntaxError(
				source,
				offset,
				`Unexpected character ${JSON.stringify(rest[0])}`,
			);
		tokens.push(token);
		offset += token.length;
	}
	return tokens;
}

function declarationNames(tokens, preserveNames) {
	const declared = new Set();
	const protectedNames = new Set([...FIXED_NAMES, ...preserveNames]);
	const callable = new Set();
	const requireName = (index) => {
		const name = tokens[index];
		if (
			!name ||
			!IDENTIFIER.test(name) ||
			KEYWORDS.has(name) ||
			name === "_"
		) {
			throw new SyntaxError(
				`Incomplete WGSL declaration near token ${index}`,
			);
		}
		declared.add(name);
		return name;
	};
	const protectThrough = (start, terminator) => {
		let index = start;
		for (; index < tokens.length && tokens[index] !== terminator; index++) {
			if (IDENTIFIER.test(tokens[index]))
				protectedNames.add(tokens[index]);
		}
		if (index === tokens.length)
			throw new SyntaxError(
				`Incomplete WGSL context; expected ${terminator}`,
			);
		return index;
	};
	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (DECLARATIONS.has(token)) {
			const name = requireName(i + 1);
			if (["fn", "struct", "alias"].includes(token)) callable.add(name);
			// Pipeline constants are addressed by their original names from JS.
			if (token === "override") protectedNames.add(name);
		}
		if (token === "var") {
			let index = i + 1;
			if (tokens[index] === "<")
				index = protectThrough(index + 1, ">") + 1;
			requireName(index);
		}
		if (
			tokens[i + 1] === ":" &&
			IDENTIFIER.test(token) &&
			!KEYWORDS.has(token)
		)
			declared.add(token);
		if (token === "enable" || token === "requires")
			protectThrough(i + 1, ";");
		if (tokens[i - 1] === "@") {
			protectedNames.add(token);
			if (["vertex", "fragment", "compute"].includes(token)) {
				const fn = tokens.indexOf("fn", i + 1);
				if (fn < 0) throw new SyntaxError("Incomplete WGSL entrypoint");
				protectedNames.add(requireName(fn + 1));
			}
		}
		if (
			["builtin", "interpolate", "diagnostic"].includes(token) &&
			tokens[i + 1] === "("
		)
			protectThrough(i + 2, ")");
	}
	// A field/local named "max" must not rename the builtin max() elsewhere.
	for (let i = 0; i < tokens.length; i++) {
		const name = tokens[i];
		if (tokens[i + 1] === "(" && !callable.has(name))
			protectedNames.add(name);
		if (
			/^(?:[xyzwrgba]{1,4}|(?:vec[234]|mat[234]x[234])[fhiu]?|texture_\w+|[rgba]+\d+\w*)$/.test(
				name,
			)
		)
			protectedNames.add(name);
	}
	return { declared, protectedNames };
}

function shortName(serial) {
	if (serial < 52) return ALPHABET[serial];
	// Match the existing short-name order, then extend without a fixed limit.
	let value = Math.floor((serial - 52) / 52),
		prefix = "";
	do {
		prefix = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"[value % 26] + prefix;
		value = Math.floor(value / 26) - 1;
	} while (value >= 0);
	return prefix + ALPHABET[(serial - 52) % 52];
}

function rename(tokens, declared, protectedNames) {
	const counts = new Map();
	for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
	const candidates = [...declared].filter(
		(name) => !protectedNames.has(name),
	);
	candidates.sort((a, b) => counts.get(b) - counts.get(a));
	const occupied = new Set([...tokens, ...protectedNames]);
	const names = new Map();
	let serial = 0;
	for (const name of candidates) {
		let short;
		do {
			short = shortName(serial++);
		} while (occupied.has(short));
		names.set(name, short);
	}
	return tokens.map((token) => names.get(token) || token);
}

function compactTypes(tokens, declared) {
	const occupied = new Set(tokens);
	const result = [];
	for (let i = 0; i < tokens.length; i++) {
		const [type, open, scalar, close] = tokens.slice(i, i + 4);
		const short = type + scalar?.[0];
		// Do not turn a builtin type into a user-declared alias with that name.
		if (
			open === "<" &&
			close === ">" &&
			!occupied.has(short) &&
			!declared.has(type) &&
			!declared.has(scalar) &&
			((/^(vec[234]|mat[234]x[234])$/.test(type) && scalar === "f32") ||
				(/^vec[234]$/.test(type) && /^(i32|u32)$/.test(scalar)))
		) {
			result.push(short);
			i += 3;
		} else result.push(type);
	}
	return result;
}

function joinTokens(tokens) {
	let result = "",
		previous = "";
	for (const token of tokens) {
		const joined = previous + token;
		// Re-lex the boundary: covers exponents, compound operators and comments.
		if (
			previous &&
			((/[\p{XID_Continue}]$/u.test(previous) &&
				/^[\p{XID_Continue}]/u.test(token)) ||
				(NUMBER.test(previous) && token.startsWith(".")) ||
				joined.startsWith("//") ||
				joined.startsWith("/*") ||
				tokenAt(joined) !== previous)
		)
			result += " ";
		result += token;
		previous = token;
	}
	return result;
}

/** Minify a valid WGSL module. Entry points and overrides retain their names.
 * Additional host-visible names can be supplied in preserveNames.
 * This intentionally keeps expressions, scopes and evaluation order intact.
 */
export function minifyWgsl(source, { preserveNames = [] } = {}) {
	const original = tokenizeWgsl(source);
	const { declared, protectedNames } = declarationNames(
		original,
		preserveNames,
	);
	const tokens = rename(original, declared, protectedNames);
	return joinTokens(
		compactTypes(tokens, declared).map((token) => {
			if (/^(0|[1-9]\d*)\.0+f$/.test(token))
				return token.replace(/\.0+f$/, "f");
			// WGSL accepts a fractional literal without its otherwise redundant 0.
			return token.replace(/^0\.(?=\d)/, ".");
		}),
	);
}

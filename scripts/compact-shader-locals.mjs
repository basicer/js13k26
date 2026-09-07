import { tokenizeWgsl } from "../tools/wgsl-minify/src/minify.js";

// Reuse a small vocabulary across functions before the lexical minifier assigns
// short names. Keep member accesses and attributes separate from local bindings.
export function compactShaderLocals(source) {
    const tokens = tokenizeWgsl(source), occupied = new Set(tokens), slots = [];
    const functions = [], globals = new Set();
    const binding = index => {
        if (tokens[index] === "<") {
            while (tokens[index] !== ">" && index < tokens.length) index++;
            if (index === tokens.length) throw Error("Unclosed shader binding");
            index++;
        }
        return tokens[index];
    };
    for (let i = 0, depth = 0; i < tokens.length; i++) {
        if (!depth && ["fn", "struct", "alias", "const", "override", "var"].includes(tokens[i]))
            globals.add(binding(i + 1));
        if (tokens[i] === "fn") {
            let open = i, body = i;
            while (tokens[open] !== "(" && open < tokens.length) open++;
            while (tokens[body] !== "{" && body < tokens.length) body++;
            if (open === tokens.length || body === tokens.length) throw Error("Incomplete shader function");
            let end = body, braces = 1;
            while (braces && ++end < tokens.length) {
                if (tokens[end] === "{") braces++;
                if (tokens[end] === "}") braces--;
            }
            if (braces) throw Error("Unclosed shader function");
            functions.push({ open, body, end });
            i = end;
        } else {
            if (tokens[i] === "{") depth++;
            if (tokens[i] === "}") depth--;
        }
    }
    const slot = index => {
        while (slots.length <= index) {
            let number = slots.length, name;
            do name = `local${number++}`; while (occupied.has(name));
            occupied.add(name);
            slots.push(name);
        }
        return slots[index];
    };
    for (const { open, body, end } of functions) {
        const names = new Set();
        for (let i = open; i < body; i++) if (tokens[i + 1] === ":") names.add(tokens[i]);
        for (let i = body; i < end; i++)
            if (["let", "var", "const"].includes(tokens[i])) names.add(binding(i + 1));
        // A later declaration can shadow a module name that was read earlier.
        // Leave such functions alone rather than guessing at lexical resolution.
        if ([...names].some(name => globals.has(name))) continue;
        const replacements = new Map([...names].map((name, i) => [name, slot(i)]));
        for (let i = open; i <= end; i++) {
            if (tokens[i] === "@") {
                i++;
                if (tokens[i + 1] === "(") {
                    i += 2;
                    let depth = 1;
                    while (depth && i <= end) {
                        if (tokens[i] === "(") depth++;
                        if (tokens[i] === ")") depth--;
                        i++;
                    }
                    if (depth) throw Error("Unclosed shader attribute");
                    i--;
                }
            } else if (tokens[i - 1] !== "." && replacements.has(tokens[i])) {
                tokens[i] = replacements.get(tokens[i]);
            }
        }
    }
    return tokens.join(" ");
}

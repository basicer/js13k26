// Collapse CPU-only Entity members into WGSL padding without changing host offsets.
import { generateEntityConstants } from "./generate-entity-constants.mjs";

export function compactShaderEntity(source) {
    const clean = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g, "");
    const match = /\bstruct\s+Entity\s*\{([^}]+)\}/.exec(clean);
    if (!match) throw Error("Entity struct not found");
    const outside = clean.slice(0, match.index) + clean.slice(match.index + match[0].length);
    if (/\bEntity\s*\(/.test(outside)) throw Error("Cannot compact positional Entity constructors");
    const constants = Object.fromEntries([...generateEntityConstants(clean).matchAll(/export const (\w+) = (\d+);/g)]
        .map(([, name, value]) => [name, Number(value) * 4]));
    const fields = [...match[1].matchAll(/(\w+)\s*:\s*(f32|vec3<f32>)\s*,/g)].map(([, name, type]) => ({
        name, type, size: type === "f32" ? 4 : 12,
        offset: constants[name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase()],
    }));
    if (match[1].replace(/\w+\s*:\s*(f32|vec3<f32>)\s*,/g, "").trim()) throw Error("Unsupported Entity layout");
    // Other structs may use the same field name: retaining too much is safe.
    const used = fields.filter(field => new RegExp("\\.\\s*" + field.name + "\\b").test(outside));
    if (!used.length || used[0].offset !== 0) throw Error("Entity must retain its first field");
    const body = used.map((field, index) => {
        const size = (used[index + 1]?.offset ?? constants.STRIDE) - field.offset;
        return `${size > field.size ? `@size(${size}) ` : ""}${field.name}: ${field.type},`;
    }).join("\n");
    return clean.replace(match[0], () => `struct Entity {\n${body}\n}`);
}

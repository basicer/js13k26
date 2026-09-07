import vm from "node:vm";

export function compactTrack(code, prune = false) {
    // Tracker channels repeat verbatim. Share their immutable arrays before
    // Closure/Roadroller; preserve sparse holes (JSON would turn them into null).
    const track = vm.runInNewContext(code);
    if (prune) {
        const usedPatterns = new Set(track[2]), usedInstruments = new Set();
        for (const index of usedPatterns) for (const channel of track[1][index]) usedInstruments.add(channel[0] || 0);
        track[0] = track[0].map((instrument, index) => usedInstruments.has(index) ? instrument : 0);
        track[1] = track[1].map((pattern, index) => usedPatterns.has(index) ? pattern : 0);
    }
    const counts = new Map(), names = new Map(), declarations = [];
    const literal = value => Array.isArray(value) ? `[${value.map(literal).join(",")}${value.length && !(value.length - 1 in value) ? "," : ""}]` : JSON.stringify(value);
    const count = value => {
    	if (!Array.isArray(value)) return;
    	const key = literal(value);
    	counts.set(key, (counts.get(key) || 0) + 1);
    	value.forEach(count);
    };
    count(track);
    const emit = value => {
    	if (!Array.isArray(value)) return JSON.stringify(value);
    	const key = literal(value);
    	if (names.has(key)) return names.get(key);
    	const text = `[${value.map(emit).join(",")}${value.length && !(value.length - 1 in value) ? "," : ""}]`;
    	if (counts.get(key) < 2 || key.length < 16) return text;
    	const name = `track${names.size}`;
    	names.set(key, name);
    	declarations.push(`const ${name}=${text};`);
    	return name;
    };
    const output = emit(track);
    return `${declarations.join("")}export default ${output};`;
}

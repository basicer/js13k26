const prefix = "js13k26:debug:";

function read(key) {
	try {
		return localStorage.getItem(prefix + key) || "";
	} catch {
		return "";
	}
}

function write(key, value) {
	try {
		localStorage.setItem(prefix + key, value);
	} catch {
		/* Debugger remains usable when browser storage is unavailable. */
	}
}

let restored = {};
try {
	const value = JSON.parse(read("panels"));
	if (value && typeof value === "object" && !Array.isArray(value))
		restored = value;
} catch {
	/* Missing or invalid preferences use defaults. */
}

const panels = new Map();
let lastPanels = "";

// Shared mutable booleans work with both menu items and ImGui window close buttons.
export function debugPanel(name, initiallyOpen = false) {
	if (!panels.has(name))
		panels.set(name, [
			typeof restored[name] === "boolean"
				? restored[name]
				: initiallyOpen,
		]);
	return panels.get(name);
}

export function saveDebugPanels() {
	const value = JSON.stringify(
		Object.fromEntries([...panels].map(([name, open]) => [name, open[0]])),
	);
	if (value !== lastPanels) {
		lastPanels = value;
		write("panels", value);
	}
}

export const loadDebugLayout = () => read("layout");
export const saveDebugLayout = (ini) => write("layout", ini);

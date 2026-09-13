import { defineConfig } from "vite";
import path from "node:path";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { readFileSync, write } from "node:fs";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { parseAst } from "rolldown/parseAst";
import { Packer } from "roadroller";
import ClosureCompiler from "google-closure-compiler";
import { assemble } from "./src/vvm-tools.js";
import { minifyWgsl } from "./tools/wgsl-minify/src/minify.js";
import { compactTrack } from "./scripts/compact-track.mjs";
import { compactShaderLocals } from "./scripts/compact-shader-locals.mjs";
import { compactShaderEntity } from "./scripts/compact-shader-entity.mjs";
import { writeEntityConstants } from "./scripts/generate-entity-constants.mjs";

import ect from "ect-bin";
import advzip from "advzip-bin";

export default defineConfig(({ command, mode }) => {
	writeEntityConstants();
	let pack = command == "build" && mode != "development";
	const useRoadroller = mode !== "unpacked" && process.env.ROADROLLER !== "0";

	return {
		base: "./",
		plugins: [
			dds(),
			zzfxm(pack),
			voxprog(mode === "development"),
			shader(pack),
			...(pack ? [closure(), roadroller(useRoadroller), zip(useRoadroller)] : []),
		],
		define: {
			"import.meta.env.DEBUG": JSON.stringify(mode === "development"),
		},
		build: {
			outDir: pack && !useRoadroller ? "dist-unpacked" : "dist",
			assetsDir: "",
			modulePreload: { polyfill: false },
			rolldownOptions: {
				output: {
					comments: true, // So closure can see them
					minify: mode == "development" ? "dce-only" : true,
				},
			},
		},
		resolve: {},
		// Load the patched IMGUI backend directly so dependency caching cannot
		// keep serving old keyboard handling after a patch-package update.
		optimizeDeps: { exclude: ["@mori2003/jsimgui"] },
		server: {
			proxy: {},
		},
	};
});

var dds = () => ({
	name: "vite:dds",
	load: (id) => (/\.dds(?:\.gz)?$/.test(id) ? `export default "${readFileSync(id).toString("base64")}";` : undefined),
});

var zzfxm = (pack) => ({
	name: "vite:zzfxm",
	load: (id) => {
		if (!/\.zzfxm$/.test(id)) return undefined;
		let code = readFileSync(id).toString("utf-8");
		code = code.replace(/[{][^}]*[}]/gm, "{}");
		const legacy = id.endsWith("Main Title.zzfxm");
		return compactTrack(code, pack && legacy, legacy);
	},
});

var voxprog = (development) => {
	let root;
	return {
		name: "vite:voxprog",
		configResolved(config) {
			root = config.root;
		},
		load(id) {
			if (!/\.(vp|vox)$/.test(id)) return;
			const source = readFileSync(id, "utf8");
			const file = path.relative(root, id).replaceAll("\\", "/");
			const metadata = development ? JSON.stringify({ file, source }) : "undefined";
			// Numeric bytes compress better than base64 through Closure + Roadroller + ZIP.
			return `export default ${JSON.stringify([...assemble(source)])}; export const debugSource = ${metadata};`;
		},
	};
};

var shader = (isBuild) => ({
	name: "vite:shader",
	transform(code, id) {
		if (!id.endsWith(".wgsl")) return;

		code = code.replace(/^#import "([^"]*)".*$/gm, (_, str) => {
			const dependency = path.resolve(path.dirname(id), str);
			this.addWatchFile(dependency);
			return readFileSync(dependency, "utf-8");
		});

		try {
			if (isBuild) code = minifyWgsl(compactShaderLocals(compactShaderEntity(code)));
		} catch (cause) {
			throw new Error(`Unable to minify shader ${id}: ${cause.message}`, {
				cause,
			});
		}
		return { code: `export default ${JSON.stringify(code)};`, map: null };
	},
});

var roadroller = (enabled) => ({
	name: "vite:roadroller",
	transformIndexHtml: async (html, ctx) => {
		if (!ctx || !ctx.bundle) {
			return html;
		}

		const bundleOutputs = Object.values(ctx.bundle);
		const javascript = bundleOutputs.find((output) => output.fileName.endsWith(".js"));
		const otherBundleOutputs = bundleOutputs.filter((output) => output !== javascript);
		if (otherBundleOutputs.length > 0) {
			otherBundleOutputs.forEach((output) => console.warn(`WARN Asset not inlined: ${output.fileName}`));
		}

		// Closure already wraps the game in an async function.
		const data = javascript.code;
		if (!enabled) {
			if (/<\/script/i.test(data)) throw Error("Unsafe inline script terminator");
			return html.replace(/<script.*?<\/script>/, () => `<script>${data}</script>`).trim();
		}
		const packer = new Packer([{ data, type: "text", action: "eval" }], {
			maxMemoryMB: 1536,
			modelRecipBaseCount: 62,
			dynamicModels: 0,
			modelMaxCount: 3,
			numAbbreviations: 0,
			sparseSelectors: [0, 1, 2, 3, 5, 6, 7, 10, 11, 13, 22, 25, 45, 51, 81, 230, 249, 345, 396, 417, 423],
			precision: 16,
			recipLearningRate: 3100,
			// The packed release owns its single page; game code has its own wrapper.
			allowFreeVars: true,
		});
		// Reuse the tuned model for deterministic, fast builds; opt in to retuning.
		if (process.env.REPACK) console.log("Roadroller parameters", JSON.stringify((await packer.optimize(2)).best));
		const { firstLine, secondLine } = packer.makeDecoder();
		const code = firstLine + secondLine;
		if (/<\/script/i.test(code)) throw Error("Unsafe packed script terminator");
		// Decode without running the game and verify the executable syntax tree.
		let decoded;
		// Local bindings avoid Node VM's slow global proxy during validation.
		const validationCode = `(function(){var ${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").join(",")};${code}})()`;
		vm.runInNewContext(
			validationCode,
			{
				eval: (value) => {
					decoded = value;
				},
			},
			{ timeout: 10000 },
		);
		const canonical = (source) =>
			JSON.stringify(parseAst(source), (key, value) =>
				["start", "end", "raw", "loc", "range"].includes(key) ? undefined : value,
			);
		if (typeof decoded !== "string" || canonical(decoded) !== canonical(data)) {
			throw Error("Packed game failed its code round-trip check");
		}

		return html.replace(/<script.*?<\/script>/, `<script>${code}</script>`).trim();
	},
});

var closure = () => ({
	name: "vite:closure",
	renderChunk: async (code, chunk, options) => {
		const tmpobj = { name: "tmp.js" };

		let WEBGPU_CONSTANTS = {
			"GPUBufferUsage.MAP_READ": 1,
			"GPUBufferUsage.MAP_WRITE": 2,
			"GPUBufferUsage.COPY_SRC": 4,
			"GPUBufferUsage.COPY_DST": 8,
			"GPUBufferUsage.INDEX": 16,
			"GPUBufferUsage.VERTEX": 32,
			"GPUBufferUsage.UNIFORM": 64,
			"GPUBufferUsage.STORAGE": 128,
			"GPUBufferUsage.INDIRECT": 256,
			"GPUBufferUsage.QUERY_RESOLVE": 512,

			"GPUTextureUsage.COPY_SRC": 1,
			"GPUTextureUsage.COPY_DST": 2,
			"GPUTextureUsage.TEXTURE_BINDING": 4,
			"GPUTextureUsage.STORAGE_BINDING": 8,
			"GPUTextureUsage.RENDER_ATTACHMENT": 16,

			"GPUShaderStage.VERTEX": 1,
			"GPUShaderStage.FRAGMENT": 2,
			"GPUShaderStage.COMPUTE": 4,

			"GPUMapMode.READ": 1,
			"GPUMapMode.WRITE": 2,
		};

		for (const [key, value] of Object.entries(WEBGPU_CONSTANTS)) {
			code = code.replace(new RegExp(`\\b${key}\\b`, "g"), value);
		}

		code = code.replace(/label`[^`]*`/g, "''");
		code = code.replace(/"label": '',/g, "");
		code = code.replace(/if \(DEBUG[^;\n]*\);/g, "");

		await writeFile(
			tmpobj.name,
			`
			
/** 
 * @define {boolean} 
 */
var DEBUG = true;
(async () => {\n${code}\n})();

		`,
		);

		const compiler = new ClosureCompiler({
			js: tmpobj.name,
			compilation_level: "ADVANCED",
			language_in: "ECMASCRIPT_2020",
			language_out: "ECMASCRIPT_2020",
			chunk_output_type: "ES_MODULES",
			define: "'DEBUG=false'",
			warningLevel: "VERBOSE",
			assume_function_wrapper: true,
			rewrite_polyfills: false,
		});

		return new Promise((resolve, reject) => {
			compiler.run((exitCode, stdOut, stdErr) => {
				console.warn(stdErr);
				if (exitCode === 0) {
					stdOut = stdOut.replace(/export{};\s*$/g, "");
					writeFile(tmpobj.name + ".out.js", stdOut, "utf-8").then(() => {
						resolve({ code: stdOut, map: null });
					});
				} else {
					reject(new Error(stdErr));
				}
			});
		});
	},
});

var zip = (enforceLimit) => {
	let outDir;
	return {
		name: "vite:ect",
		configResolved(config) { outDir = config.build.outDir; },
		writeBundle: async () => {
			try {
				const files = await readdir(outDir);
				const assetFiles = files
					.filter((file) => {
						return file != "index.html" && file != "index.zip" && !file.endsWith(".js");
					})
					.map((file) => path.join(outDir, file));

				const args = ["-strip", "-zip", "-10009", path.join(outDir, "index.html"), ...assetFiles];
				const result = execFileSync(ect, args);
				console.log("ECT result", result.toString());
				const advzipResult = execFileSync(advzip, ["-4", "-z", path.join(outDir, "index.zip")]);
				console.log("advzip result", advzipResult.toString());
				const stats = await stat(path.join(outDir, "index.zip"));
				console.log("ZIP size", Math.round((stats.size / 1024) * 100) / 100, "KB");
				console.log(13312 - stats.size, "bytes left");
				if (enforceLimit && stats.size > 13312) throw new Error(`Release exceeds 13 KiB by ${stats.size - 13312} bytes`);
			} catch (err) {
				throw err;
			}
		},
	};
};

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { minifyWgsl } from "./wgsl-minify.js";

export function checkShader(source, compact = minifyWgsl(source)) {
	const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wgsl-test-"));
	try {
		const compile = (text, name) => {
			const input = path.join(scratch, `${name}.wgsl`);
			const output = path.join(scratch, `${name}.out`);
			fs.writeFileSync(input, text);
			const result = spawnSync(
				process.env.WGSL_MINIFIER || "wgsl-minifier",
				["--force", input, output],
				{ encoding: "utf8", timeout: 10000 },
			);
			if (result.error)
				throw new Error(
					"Shader integration tests require wgsl-minifier on PATH (or WGSL_MINIFIER).",
					{ cause: result.error },
				);
			// Some releases print a parse error but exit with status zero.
			assert.ok(
				result.status === 0 && fs.existsSync(output),
				`WGSL compilation failed:\n${result.stdout}\n${result.stderr}`,
			);
			return fs.readFileSync(output, "utf8");
		};
		assert.equal(compile(compact, "compact"), compile(source, "original"));
	} finally {
		fs.rmSync(scratch, { recursive: true, force: true });
	}
}

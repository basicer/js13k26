import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

for (const DEBUG of [false, true]) test(`startup waits for input and preserves debug pause (DEBUG=${DEBUG})`, () => {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const input = readFileSync(new URL("../src/index.js", import.meta.url), "utf8");
	let now = 0, resumed = 0;
	const steps = [], simulations = [], listeners = {};
	const context = vm.createContext({
		DEBUG, performance: { now: () => now }, updateGame: dt => steps.push(dt), updateEntities: dt => simulations.push(dt),
		zzfxX: { resume: () => resumed++ }, startStory() {},
		$: { addEventListener: (name, callback, options) => { listeners[name] = { callback, options }; } },
	});
	const run = code => vm.runInContext(code, context);
	run(source.slice(source.indexOf("let lastFrameTime"), source.indexOf("if (DEBUG && import.meta.env.DEBUG)"))
		.replaceAll("export ", ""));
	run(input.slice(input.indexOf('for (const event of ["pointerdown", "keydown"])')));
	const frame = source.slice(source.indexOf("\tconst now = performance.now()"), source.indexOf("\n\trenderState.set([simulationTime"));
	now = 30000;
	run(`{${frame}}`);
	assert.equal(run("isPaused()"), true);
	assert.equal(run("simulationTime"), 0);
	assert.deepEqual(simulations, [0]);
	assert.equal(steps.length, 0);
	// Capture runs before the key/click's normal gameplay action.
	assert.equal(listeners.pointerdown.options.capture, true);
	assert.equal(listeners.keydown.options.capture, true);
	now = 60000;
	listeners.pointerdown.callback();
	assert.equal(run("isPaused()"), false);
	assert.equal(resumed, 1);
	now += 16;
	run(`{${frame}}`);
	assert.deepEqual(steps, [0.016], "waiting time is not applied to gameplay");
	assert.deepEqual(simulations, [0, .016], "CPU simulation starts with the same fresh timestep");
	now += 8;
	listeners.keydown.callback();
	assert.equal(run("lastFrameTime"), 60016, "later input does not reset frame timing");
	run("debugModule = { isPaused: () => true, updateCamera() {} }; startGame();");
	assert.equal(run("isPaused()"), true, "input cannot dismiss a manual debug pause");
});

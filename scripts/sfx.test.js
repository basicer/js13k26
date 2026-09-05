import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("hurt renders a short audible stereo cue and reuses its samples", () => {
	const source = readFileSync(new URL("../src/sfx.js", import.meta.url), "utf8");
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const hurtTrack = vm.runInNewContext(`(${readFileSync(new URL("../music/hurt.zzfxm", import.meta.url), "utf8")})`);
	const context = vm.createContext({ hurtTrack, window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	vm.runInContext("zzfxP = (...channels) => channels", context);
	vm.runInContext(source.slice(source.indexOf("let hurtSamples"), source.indexOf("const reloadSamples")).replace("export ", ""), context);
	const channels = vm.runInContext("hurt()", context);
	assert.equal(channels.length, 2);
	for (const samples of channels) {
		assert.ok(Math.abs(samples.length - .28 * 44100) < 32);
		assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) < 1));
		assert.ok(samples.slice(0, 4410).some(value => Math.abs(value) > .02), "Voiced attack is audible");
		assert.ok(samples.slice(8820, 11025).some(value => Math.abs(value) > .001), "Breathy release is audible");
	}
	assert.equal(vm.runInContext("hurt()", context)[0], channels[0]);
});

test("reload audio spans each weapon duration and caches the generated samples", () => {
	const source = readFileSync(new URL("../src/sfx.js", import.meta.url), "utf8");
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const reloadTrack = vm.runInNewContext(`(${readFileSync(new URL("../music/reload.zzfxm", import.meta.url), "utf8")})`);
	const context = vm.createContext({ reloadTrack, window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	vm.runInContext("zzfxP = (...channels) => channels", context);
	vm.runInContext(source.slice(source.indexOf("const reloadSamples"), source.indexOf("let shotgunPumpSamples")).replace("export ", ""), context);
	for (const seconds of [1.15, 2.3, 2.5875]) {
		const channels = vm.runInContext(`reload(${seconds})`, context);
		assert.equal(channels.length, 2);
		for (const samples of channels) {
			assert.ok(Math.abs(samples.length - seconds * 44100) < 80);
			assert.ok(samples.every(Number.isFinite));
			assert.ok(samples.slice(-4410).some(value => Math.abs(value) > 0.001), "Bolt closes near the end of the reload");
		}
		assert.equal(vm.runInContext(`reload(${seconds})`, context)[0], channels[0]);
	}
});

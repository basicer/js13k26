import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

test("music transposes omitted frequencies as 220 Hz and preserves explicit zero", () => {
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const context = vm.createContext({ window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	for (const note of [12, 24]) {
		const render = (frequency) => vm.runInContext(`zzfxM([[1, 0, ${frequency}]], [[[0, 0, ${note}, 0]]], [0])`, context);
		const expected = render("220");
		assert.ok(expected[0].some(value => Math.abs(value) > .01));
		assert.deepEqual(render(""), expected, "Omitted frequency matches explicit default at each pitch");
		assert.ok(render("0")[0].every(value => value === 0), "Explicit zero must not become 220 Hz");
	}
});

test("every instrument used by the main title produces audible finite samples", () => {
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const track = vm.runInNewContext(`(${readFileSync(new URL("../music/Main Title.zzfxm", import.meta.url), "utf8")})`);
	const context = vm.createContext({ track, window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	const used = new Set(track[2].flatMap(index => track[1][index].map(channel => channel[0] || 0)));
	for (const index of used) {
		const channels = vm.runInContext(`zzfxM(track[0], [[[${index}, 0, 12, 0]]], [0])`, context);
		assert.ok(channels.every(channel => channel.every(Number.isFinite)), track[4].instruments[index]);
		assert.ok(channels[0].some(value => Math.abs(value) > .001), `${track[4].instruments[index]} is audible`);
	}
});

test("main title pads retain the tracker pitch through their sustain", () => {
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const source = readFileSync(new URL("../src/sfx.js", import.meta.url), "utf8");
	const track = vm.runInNewContext(`(${readFileSync(new URL("../music/Main Title.zzfxm", import.meta.url), "utf8")})`);
	const context = vm.createContext({ window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	vm.runInContext("zzfxP = (...channels) => channels", context);
	vm.runInContext(source.slice(source.indexOf("export let music1"), source.indexOf("/*", source.indexOf("export let music1"))).replace("export ", ""), context);
	for (const note of [18, 25]) {
		context.music1_js = [track[0], [[[8, 0, note, 0, 0, 0, 0, 0, 0, 0]]], [0], 125, {}];
		const samples = vm.runInContext("music1()[0]", context);
		const expectedHz = 220 * 2 ** ((note - 12) / 12);
		for (const start of [.1, .5]) {
			let cycles = 0;
			for (let i = Math.round(start * 44100); i < Math.round((start + .1) * 44100); i++) {
				if (samples[i - 1] <= 0 && samples[i] > 0) cycles++;
			}
			assert.ok(Math.abs(cycles * 10 - expectedHz) < 20, `Note ${note} at ${start}s: ${cycles * 10} Hz should remain near ${expectedHz} Hz`);
		}
	}
});

test("shotgun pump keeps two separated strokes in 0.22 seconds and caches its samples", () => {
	const source = readFileSync(new URL("../src/sfx.js", import.meta.url), "utf8");
	const synth = readFileSync(new URL("../vendor/zzfx.js", import.meta.url), "utf8");
	const shotgunPumpTrack = vm.runInNewContext(`(${readFileSync(new URL("../music/shotgun-pump.zzfxm", import.meta.url), "utf8")})`);
	const context = vm.createContext({ shotgunPumpTrack, window: { AudioContext: class {} } });
	vm.runInContext(synth.replaceAll("export ", ""), context);
	vm.runInContext("zzfxP = (...channels) => channels", context);
	vm.runInContext(source.slice(source.indexOf("let shotgunPumpSamples"), source.indexOf("export let magic")).replace("export ", ""), context);
	const channels = vm.runInContext("shotgunPump()", context);
	assert.equal(channels.length, 2);
	for (const samples of channels) {
		assert.ok(Math.abs(samples.length - .22 * 44100) < 8);
		assert.ok(samples.every(value => Number.isFinite(value) && Math.abs(value) < 1));
		assert.ok(samples.slice(0, 2800).some(value => Math.abs(value) > .01));
		assert.ok(samples.slice(3600, 4600).every(value => value === 0));
		assert.ok(samples.slice(4900, 9000).some(value => Math.abs(value) > .01));
	}
	assert.equal(vm.runInContext("shotgunPump()", context)[0], channels[0]);
});

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

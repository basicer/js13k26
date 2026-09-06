import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as E from "../src/entities-const.js";

function input() {
	const source = readFileSync(new URL("../src/render.js", import.meta.url), "utf8");
	const listeners = {}, picks = [], shots = [], triggers = [], selections = [];
	const console = new Float32Array(E.STRIDE);
	console[E.KIND] = 15;
	let captured = false;
	const context = vm.createContext({
		E, DEBUG: true, entityVersion: 0, EArray: [null, console],
		isPaused: () => false,
		debugModule: { wantsMouse: () => false, selectEntity: id => selections.push(id) },
		setMarineTrigger: held => triggers.push(held), fireMarineGun: () => shots.push(1),
		pickEntity: (...point) => new Promise((resolve, reject) => picks.push({ point, resolve, reject })),
		console: { error() {} },
		c: {
			width: 1600, height: 1200,
			getBoundingClientRect: () => ({ left: 20, top: 30, width: 800, height: 600 }),
			addEventListener: (name, callback) => { listeners[name] = callback; },
			setPointerCapture: () => { captured = true; }, hasPointerCapture: () => captured,
		},
	});
	vm.runInContext(source.slice(source.indexOf("let click ="), source.indexOf('c.addEventListener("pointermove"')), context);
	const down = () => listeners.pointerdown({ button: 0, pointerId: 1, clientX: 140, clientY: 110 });
	const up = (type = "pointerup") => { captured = false; listeners[type]({ type }); };
	return { context, console, picks, shots, triggers, selections, down, up };
}

test("picking the console toggles red/green once per click without firing or holding the trigger", async () => {
	const h = input();
	for (const variant of [1, 0]) {
		const pending = h.down();
		assert.equal(h.shots.length, 0, "no shot before the GPU pick resolves");
		const pick = h.picks.at(-1);
		assert.deepEqual(pick.point, [240, 160], "CSS clicks scale to picking texture pixels");
		pick.resolve([1, 243]);
		await pending;
		assert.equal(h.console[E.MODEL_VARIANT], variant);
		assert.equal(h.triggers.at(-1), false);
		h.up();
	}
	assert.equal(h.shots.length, 0);
});

test("ordinary held clicks fire; quick released clicks fire once without leaving autofire on", async () => {
	for (const releaseEarly of [false, true]) {
		const h = input(), pending = h.down();
		if (releaseEarly) h.up();
		h.picks[0].resolve([-1, -1]);
		await pending;
		assert.equal(h.shots.length, 1);
		assert.equal(h.triggers.at(-1), !releaseEarly);
		h.up();
		assert.equal(h.triggers.at(-1), false);
	}
});

test("cancel, restart, a newer click, and failed picking cannot fire stale shots", async () => {
	for (const reason of ["cancel", "restart", "newer", "failure"]) {
		const h = input(), pending = h.down();
		if (reason === "cancel") h.up("pointercancel");
		if (reason === "restart") h.context.entityVersion++;
		let newer;
		if (reason === "newer") newer = h.down();
		if (reason === "failure") h.picks[0].reject(Error("device lost"));
		else h.picks[0].resolve([-1, -1]);
		await pending;
		assert.equal(h.shots.length, 0);
		assert.equal(h.triggers.at(-1), false);
		if (newer) { h.picks[1].resolve([1, 243]); await newer; }
	}
});

test("paused editor clicks select the console without toggling or firing", async () => {
	const h = input();
	h.context.isPaused = () => true;
	const pending = h.down();
	h.picks[0].resolve([1, 243]);
	await pending;
	assert.deepEqual(h.selections, [1]);
	assert.equal(h.console[E.MODEL_VARIANT], 0);
	assert.equal(h.shots.length, 0);
});

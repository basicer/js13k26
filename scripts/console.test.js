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
		E, DEBUG: true, entityVersion: 0, EArray: [null, console], cursorHit: [-1, -1],
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
	vm.runInContext(source.slice(source.indexOf('c.addEventListener("pointerdown"'), source.indexOf('c.addEventListener("pointermove"')), context);
	const down = () => listeners.pointerdown({ button: 0, pointerId: 1, clientX: 140, clientY: 110 });
	const up = (type = "pointerup") => { captured = false; listeners[type]({ type }); };
	return { context, console, picks, shots, triggers, selections, down, up };
}

test("the cached gameplay pick toggles a console without firing or holding the trigger", () => {
	const h = input();
	for (const variant of [1, 0]) {
		h.context.cursorHit[0] = 1;
		h.down();
		assert.equal(h.console[E.MODEL_VARIANT], variant);
		assert.equal(h.triggers.at(-1), false);
		h.up();
	}
	assert.equal(h.shots.length, 0);
});

test("ordinary held clicks fire; quick released clicks fire once without leaving autofire on", () => {
	for (const releaseEarly of [false, true]) {
		const h = input(); h.down();
		if (releaseEarly) h.up();
		assert.equal(h.shots.length, 1);
		assert.equal(h.triggers.at(-1), !releaseEarly);
		h.up();
		assert.equal(h.triggers.at(-1), false);
	}
});

test("paused editor clicks select the console without toggling or firing", async () => {
	const h = input();
	h.context.isPaused = () => true;
	h.down();
	const pick = h.picks[0];
	assert.deepEqual(pick.point, [240, 160], "CSS clicks scale to picking texture pixels");
	pick.resolve([1, 243]);
	await Promise.resolve();
	assert.deepEqual(h.selections, [1]);
	assert.equal(h.console[E.MODEL_VARIANT], 0);
	assert.equal(h.shots.length, 0);
});

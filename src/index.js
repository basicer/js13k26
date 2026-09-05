import {
	G,
	Q,
	d,
	c,
	$,
	heldKeys,
	canvasFormat,
	canvasSrgbFormat,
} from "./globals.js";
import { render, wantsKeyboard, isFlying, isPaused } from "./render.js";
import {
	reloadMarineGun,
	selectMarineWeapon,
	toggleMarineFlashlight,
} from "./game.js";

import * as sound from "./sfx.js";
import { zzfxX } from "../vendor/zzfx.js";

Object.assign(c.style, {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
});

G.configure({
	"device": d,
	"format": canvasFormat,
	"viewFormats": [canvasSrgbFormat],
});

if (DEBUG) console.log("HI");

const gameKey = (key) =>
	key.startsWith("arrow") || "wasdqerfgh".includes(key) || key === "shift";

$.addEventListener("keydown", (event) => {
	const key = event.key.toLowerCase();
	if (DEBUG && import.meta.env.DEBUG && wantsKeyboard()) {
		heldKeys.clear();
		return;
	}
	if (/^[123]$/.test(key)) {
		if (!event.repeat && !isPaused() && !isFlying())
			selectMarineWeapon(Number(key));
		event.preventDefault();
		return;
	}
	if (event.repeat || !gameKey(key)) return;

	if (!isPaused() && !isFlying()) {
		if (key === "r") reloadMarineGun();
		if (key === "f") toggleMarineFlashlight();
	}

	event.preventDefault();
	heldKeys.add(key);
});

$.addEventListener("keyup", (event) => {
	const key = event.key.toLowerCase();
	if (DEBUG && import.meta.env.DEBUG && wantsKeyboard()) {
		heldKeys.delete(key);
		return;
	}
	if (!gameKey(key)) return;
	event.preventDefault();
	heldKeys.delete(key);
});

let step = async (dt) => {
	await render(dt);
	requestAnimationFrame(step);
};
if (DEBUG) console.log("Starting render loop");
step(performance.now());

// Queue the track once; browsers that block autoplay resume on first input.
if (!DEBUG) sound.music1()["loop"] = true;
for (const event of ["pointerdown", "keydown"]) {
	$.addEventListener(event, () => zzfxX.resume(), { once: true });
}

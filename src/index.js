import { G, Q, d, c, $, heldKeys, canvasFormat, canvasSrgbFormat } from "./globals.js";
import { render, wantsKeyboard, isFlying, isPaused, startGame } from "./render.js";
import { reloadMarineGun, selectMarineWeapon, toggleMarineFlashlight } from "./game.js";

import { music1 } from "./sfx.js";
import { zzfxX } from "../vendor/zzfx.js";

c.style.cssText = "position:absolute;inset:0;width:100%;height:100%";

G.configure({
	"device": d,
	"format": canvasFormat,
	"viewFormats": [canvasSrgbFormat],
});

if (DEBUG) console.log("HI");

$.addEventListener("keydown", (event) => {
	const key = event.key.toLowerCase();
	if (DEBUG && import.meta.env.DEBUG && wantsKeyboard()) {
		heldKeys.clear();
		return;
	}
	if (event.repeat) return;

	if (!isPaused() && !isFlying()) {
		if (key === "q") selectMarineWeapon();
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
	event.preventDefault();
	heldKeys.delete(key);
});

let step = () => {
	render();
	requestAnimationFrame(step);
};
if (DEBUG) console.log("Starting render loop");
step();

// Queue the track once; browsers that block autoplay resume on first input.
if (!DEBUG) music1()["loop"] = true;
for (const event of ["pointerdown", "keydown"]) {
	$.addEventListener(event, () => {
		startGame();
		zzfxX.resume();
	}, { once: true, capture: true });
}

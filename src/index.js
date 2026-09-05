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
import { render, wantsKeyboard } from "./render.js";

import * as sound from "./sfx.js";

Object.assign(c.style, {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
	imageRendering: "pixelated",
});

G.configure({
	"device": d,
	"format": canvasFormat,
	"viewFormats": [canvasSrgbFormat],
});

if (DEBUG) console.log("HI");

$.addEventListener("keydown", (event) => {
	if (DEBUG && import.meta.env.DEBUG && wantsKeyboard()) {
		heldKeys.clear();
		return;
	}
	if (
		event.repeat ||
		(!event.key.startsWith("Arrow") &&
			!"wasdqerfgh".includes(event.key.toLowerCase()) &&
			event.key !== "Shift")
	)
		return;

	if (event.key === "g") {
		sound.magic();
	}
	if (event.key === "h") {
		sound.gunshot();
	}
	// window.x = magic();

	event.preventDefault();
	heldKeys.add(event.key.toLowerCase());
});

$.addEventListener("keyup", (event) => {
	if (DEBUG && import.meta.env.DEBUG && wantsKeyboard()) {
		heldKeys.delete(event.key.toLowerCase());
		return;
	}
	if (
		!event.key.startsWith("Arrow") &&
		!"wasdqerf".includes(event.key.toLowerCase()) &&
		event.key !== "Shift"
	)
		return;
	event.preventDefault();
	heldKeys.delete(event.key.toLowerCase());
});

let step = async (dt) => {
	render(dt);
	requestAnimationFrame(step);
};
if (DEBUG) console.log("Starting render loop");
step(performance.now());


setTimeout(() => {
	for (let [name, s] of Object.entries(sound)) { s(); }
}, 6e5);

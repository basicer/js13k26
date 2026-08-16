import { G, Q, d, c, $, heldKeys, canvasFormat, canvasSrgbFormat } from "./globals.js";
import { render } from "./render.js";

import { magic } from "./sfx.js";

Object.assign(c.style, {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
	imageRendering: 'pixelated'
});

G.configure({
	device: d,
	format: canvasFormat,
	viewFormats: [canvasSrgbFormat],
});

if (DEBUG) console.log("HI");

$.addEventListener("keydown", (event) => {
	if (
		event.repeat ||
		!event.key.startsWith("Arrow") &&
		!"wasdqerf".includes(event.key.toLowerCase()) &&
		event.key !== "Shift"
	)
		return;

	// window.x = magic();

	event.preventDefault();
	heldKeys.add(event.key.toLowerCase());
});

$.addEventListener("keyup", (event) => {
	if (
		!event.key.startsWith("Arrow") &&
		!"wasdqerf".includes(event.key.toLowerCase()) &&
		event.key !== "Shift"
	)
		return;
	event.preventDefault();
	heldKeys.delete(event.key.toLowerCase());
});

if (DEBUG) {
	let x = document.createElement("div");
	x.id = "fps";
	Object.assign(x.style, {
		position: "absolute",
		top: 0,
		right: 0,
		color: "white",
		backgroundColor: "black",
		fontFamily: "monospace",
		fontSize: "24px",
		padding: "2px",
	});
	document.body.appendChild(x);
}

let step = async (dt) => {
	await render(dt);
	requestAnimationFrame(step);
};
if (DEBUG) console.log("Starting render loop");
step(performance.now());

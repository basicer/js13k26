import { G, Q, d, c, $, heldKeys } from "./globals.js";
import { render } from "./render.js";

import { magic } from "./sfx.js";

globalThis["DEBUG"] =
	typeof globalThis["DEBUG"] !== "undefined" ? globalThis["DEBUG"] : true;

Object.assign(c.style, {
	position: "absolute",
	top: 0,
	left: 0,
	width: "100%",
	height: "100%",
});

G.configure({
	device: d,
	format: navigator.gpu.getPreferredCanvasFormat(),
});

$.body.appendChild(c);

if (DEBUG) console.log("HI");

addEventListener("keydown", (event) => {
	if (
		!event.key.startsWith("Arrow") &&
		!"wasdqerf".includes(event.key.toLowerCase())
	)
		return;

	window.x = magic();

	event.preventDefault();
	heldKeys.add(event.key.toLowerCase());
});

addEventListener("keyup", (event) => {
	if (
		!event.key.startsWith("Arrow") &&
		!"wasdqerf".includes(event.key.toLowerCase())
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

let step = (dt) => {
	render(dt);
	requestAnimationFrame(step);
};
step(document.timeline.currentTime);

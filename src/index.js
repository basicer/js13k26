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
import { render } from "./render.js";

import { magic, gunshot } from "./sfx.js";

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
	if (
		event.repeat ||
		(!event.key.startsWith("Arrow") &&
			!"wasdqerfgh".includes(event.key.toLowerCase()) &&
			event.key !== "Shift")
	)
		return;

	if (event.key === "g") {
		magic();
	}
	if (event.key === "h") {
		gunshot();
	}
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
		backgroundColor: "rgba(0, 0, 0, 0.5)",
		fontFamily: "monospace",
		fontSize: "24px",
		padding: "2px",
	});
	document.body.appendChild(x);
}

let step = async (dt) => {
	render(dt);
	requestAnimationFrame(step);
};
if (DEBUG) console.log("Starting render loop");
step(performance.now());

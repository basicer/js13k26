globalThis["DEBUG"] = !!globalThis["DEBUG"];

export let $ = document,
	c = DEBUG
		? $.getElementById("canvas") || $.createElement("canvas")
		: $.createElement("canvas"),
	/** @type {GPUAdapter} */
	a = await navigator.gpu.requestAdapter(),
	/** @type {GPUDevice} */
	d = await a.requestDevice(),
	Q = d.queue,
	/** @type {GPUCanvasContext} */
	G = c.getContext("webgpu", {
		antialias: true,
		depth: true,
	}),
	canvasFormat = navigator.gpu.getPreferredCanvasFormat(),
	canvasSrgbFormat = `${canvasFormat}-srgb`,
	heldKeys = new Set(),
	GenArray = (N, F) => new Array(N).fill(0).map((_, i) => F(i)),
	label = String.raw;
if (!c.parentElement || !DEBUG) $.body.appendChild(c);

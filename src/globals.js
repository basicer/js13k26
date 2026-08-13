export let $ = document,
	c = $.createElement("canvas"),
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
	heldKeys = new Set();

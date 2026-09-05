if (import.meta.env.DEBUG) {
	globalThis["DEBUG"] = /debug/i.test(window.location.search);
}

// 56% more magnification than the original 60-degree view (1.3 * 1.2).
export const cameraFov = Math.atan(Math.tan(Math.PI / 6) / 1.56) * 360 / Math.PI;

export let $ = document,
	c = DEBUG
		? $.getElementById("canvas") || $.createElement("canvas")
		: $.createElement("canvas"),
	/** @type {GPUAdapter} */
	a = await navigator.gpu.requestAdapter(),
	/** @type {GPUDevice} */
	d = await a.requestDevice( DEBUG ? {"requiredFeatures": ["timestamp-query"]} : {}),
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

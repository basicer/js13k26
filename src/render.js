import { $, d, c, Q, G, GenArray, canvasSrgbFormat, cameraFov, label } from "./globals.js";
import * as E from "./entities-const.js";
import shaderCode from "../shaders/shader.wgsl";
import { palette } from "./palette.js";
import {
	entities,
	updateEntities,
	lightEntities,
	entityOverrides,
	ENTITY_DATA_SIZE,
	ENTITY_COUNT,
	EArray,
} from "./entities.js";
import { voxT } from "./vvm.js";
import { aimMarineAtCursor, fireMarineGun, setMarineTrigger, updateGame } from "./game.js";

let lastFrameTime = performance.now();
let simulationTime = lastFrameTime / 1000;
let started = false;
let cursorReadback, cursorHit = [-1, -1];

export const startGame = () => {
	if (!started) lastFrameTime = performance.now();
	started = true;
};

let debugModule;
export const wantsKeyboard = () => debugModule?.wantsKeyboard();
export const isFlying = () => debugModule?.isFlying() ?? false;
export const isPaused = () => !started || (debugModule?.isPaused() ?? false);

if (DEBUG && import.meta.env.DEBUG) {
	import("./debug/debug.js").then((module) => { debugModule = module; });
}

// The cursor probe is intentionally allowed to be a frame or two old.
c.addEventListener("pointerdown", (event) => {
	if (event.button !== 0 || (DEBUG && debugModule?.wantsMouse())) return;
	setMarineTrigger(false);
	c.setPointerCapture(event.pointerId);
	const [index] = cursorHit;
	if (isPaused()) {
		if (DEBUG && index >= 0) debugModule?.selectEntity(index);
		return;
	}
	const entity = EArray[index];
	if (entity?.[E.KIND] === 15) entity[E.MODEL_VARIANT] ^= 1; // Console toggle
	else {
		setMarineTrigger(c.hasPointerCapture(event.pointerId));
		fireMarineGun();
	}
});

for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
	c.addEventListener(eventName, () => setMarineTrigger(false));
}

c.addEventListener("pointermove", (event) => {
	if (isPaused() || isFlying()) return;
	const bounds = c.getBoundingClientRect();
	renderState.set([event.clientX - bounds.left, event.clientY - bounds.top, bounds.width, bounds.height], 4);
});
c.addEventListener("pointerleave", () => (renderState[4] = -1000));

// Bit-packed -1/+1 cube vertices.
const vertices = new Float32Array(GenArray(24, (i) => (((i / 3) >> (i % 3)) & 1) * 2 - 1));

const entityBuffer = d.createBuffer({
	"size": entities.byteLength,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const renderState = new Float32Array(40);
const renderLights = new Uint32Array(renderState.buffer, 32);
renderState[4] = -1000;
const renderStateBuffer = d.createBuffer({
	"label": label`Render state`,
	"size": renderState.byteLength,
	"usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

var paletteTexture = d.createTexture({
	"label": label`Palette texture`,
	"size": [256, 2],
	"format": "rgba8unorm",
	"usage": GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
});

Q.writeTexture({ "texture": paletteTexture }, palette, { "bytesPerRow": 1024 }, [256, 2]);

let depthTexture;
let sceneTexture;
let sceneView;
let entityIndexTexture;
let entityIndexView;

const vertexBuffer = d.createBuffer({
	"label": label`Cell vertices`,
	"size": vertices.byteLength,
	"usage": GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
const indexBuffer = d.createBuffer({
	"label": label`Cell indices`,
	"size": 36 * 2,
	"usage": GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

// One digit per index; faces wind inward.
let idx = Uint16Array.from("013032467475051045237276026064157173", Number);
Q.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);
Q.writeBuffer(indexBuffer, /*bufferOffset=*/ 0, idx);

const shader = d.createShaderModule({ "code": shaderCode });

let scaleDown = 0;
function resizeCanvas() {
	const bounds = c.getBoundingClientRect();
	const pixelRatio = window.devicePixelRatio * 2 ** -scaleDown;
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	if (c.width === width && c.height === height && depthTexture && sceneTexture && entityIndexTexture) return;

	c.width = width;
	c.height = height;
	depthTexture?.destroy();
	depthTexture = d.createTexture({
		"size": [width, height],
		"format": "depth24plus",
		"usage": GPUTextureUsage.RENDER_ATTACHMENT,
	});
	sceneTexture?.destroy();
	sceneTexture = d.createTexture({
		"label": label`Bloom scene texture`,
		"size": [width, height],
		// Keep lighting values above 1.0 until the final tone-mapping pass.
		"format": "rgba16float",
		"usage": GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
	});
	sceneView = sceneTexture.createView();
	entityIndexTexture?.destroy();
	entityIndexTexture = d.createTexture({
		"label": label`Entity index texture`,
		"size": [width, height],
		"format": "rg32uint",
		"usage": GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	entityIndexView = entityIndexTexture.createView();
}

if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(c);

// $.addEventListener("resize", resizeCanvas);
resizeCanvas();

const pipeline = d.createRenderPipeline({
	"layout": "auto",
	"vertex": {
		"module": shader,
		"entryPoint": "vs_main",
		"buffers": [
			{
				"arrayStride": 12,
				"attributes": [
					{
						"shaderLocation": 0,
						"offset": 0,
						"format": "float32x3",
					},
				],
			},
		],
	},
	"fragment": {
		"module": shader,
		"entryPoint": "fs_main",
		"targets": [
			{
				"format": "rgba16float",
				"blend": {
					"color": {
						"srcFactor": "src-alpha",
						"dstFactor": "one-minus-src-alpha",
					},
					"alpha": { "dstFactor": "one-minus-src-alpha" },
				},
			},
			{
				"format": "rg32uint",
			},
		],
	},
	// The proxy is wound inward: from outside, keep only its back-facing shell.
	"primitive": { "cullMode": "back" },
	"depthStencil": {
		"format": "depth24plus",
		"depthWriteEnabled": true,
		"depthCompare": "less",
	},
});

const bloomPipeline = d.createRenderPipeline({
	"layout": "auto",
	"vertex": { "module": shader, "entryPoint": "vs_post" },
	"fragment": {
		"module": shader,
		"entryPoint": "fs_post",
		"targets": [{ "format": canvasSrgbFormat }],
	},
});
const bloomSampler = d.createSampler({
	"magFilter": "linear",
	"minFilter": "linear",
});

const BG = (pipeline, id, ...array) =>
	d.createBindGroup({
		"layout": pipeline.getBindGroupLayout(id),
		"entries": array.map((resource, binding) => ({
			"binding": binding,
			"resource": resource instanceof GPUBuffer ? { "buffer": resource } : resource,
		})),
	});

const renderBindGroup = BG(pipeline, 0, renderStateBuffer, entityBuffer, paletteTexture.createView());
export function render() {
	if (DEBUG && debugModule) debugModule.stats.begin();
	const now = performance.now();
	const deltaTime = (now - lastFrameTime) / 1000;
	lastFrameTime = now;

	if (DEBUG) debugModule?.updateCamera(deltaTime);
	if (!isPaused()) {
		updateGame(deltaTime, isFlying());
		simulationTime += deltaTime;
	}

	updateEntities(isPaused() ? 0 : deltaTime);
	renderState.set([simulationTime, c.width / c.height, cameraFov]);
	renderLights.set(lightEntities);
	Q.writeBuffer(renderStateBuffer, 0, renderState);
	Q.writeBuffer(entityBuffer, 0, entities);

	let canvasTexture = G.getCurrentTexture();
	let target = canvasTexture.createView({ format: canvasSrgbFormat });

	const e = d.createCommandEncoder();

	let passDescriptor = {
		"colorAttachments": [
			{
				"view": sceneView,
				"loadOp": "clear",
				"storeOp": "store",
			},
			{
				"view": entityIndexView,
				"clearValue": [0xffffffff, 0xffffffff, 0, 0],
				"loadOp": "clear",
				"storeOp": "store",
			},
		],
		"depthStencilAttachment": {
			"view": depthTexture.createView(),
			"depthClearValue": 1,
			"depthLoadOp": "clear",
			"depthStoreOp": "store",
		},
	};
	if (DEBUG && debugModule) passDescriptor.timestampWrites = debugModule.stats.getTimestampWrites("graphics");
	let pass = e.beginRenderPass(passDescriptor);
	pass.setBindGroup(0, renderBindGroup);
	pass.setPipeline(pipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setIndexBuffer(indexBuffer, "uint16");
	for (let i = 1; i < 128; i++) {
		pass.setBindGroup(1, BG(pipeline, 1, ...voxT[i].map((texture) => texture.createView())));
		//pass.draw(vertices.length / 2); // 6 vertices
		pass.drawIndexed(idx.length, ENTITY_COUNT, 0, 0, i << 16);
	}
	pass.end();

	let bloomPassDescriptor = {
		"colorAttachments": [
			{
				"view": target,
				"loadOp": "clear",
				"storeOp": "store",
			},
		],
	};
	if (DEBUG && debugModule) bloomPassDescriptor.timestampWrites = debugModule.stats.getTimestampWrites("bloom");
	const bloomPass = e.beginRenderPass(bloomPassDescriptor);
	bloomPass.setPipeline(bloomPipeline);
	bloomPass.setBindGroup(0, BG(bloomPipeline, 0, sceneView, bloomSampler));

	bloomPass.draw(3);
	bloomPass.end();

	// ImGui's WebGPU backend targets the canvas's base unorm format. Use its
	// compatible view in a separate pass after the linear scene was encoded by
	// the sRGB view above.
	if (DEBUG && debugModule) {
		let debugPass = e.beginRenderPass({
			colorAttachments: [
				{
					view: canvasTexture.createView(),
					loadOp: "load",
					storeOp: "store",
				},
			],
		});
		debugModule.debug(debugPass, entities, ENTITY_DATA_SIZE, entityOverrides);
		debugPass.end();
	}

	if (DEBUG && debugModule) debugModule.stats.end(e);
	Q.submit([e.finish()]);
	if (!cursorReadback && renderState[4] >= 0)
		cursorReadback = pickEntity(renderState[4] * c.width / renderState[6], renderState[5] * c.height / renderState[7]).then((hit) => {
			cursorReadback = 0;
			cursorHit = hit;
			aimMarineAtCursor(hit[0], hit[1], hit[2]);
		});

	if (DEBUG && debugModule) debugModule.stats.update();
}

export async function pickEntity(x, y) {
	if (!entityIndexTexture) return [-1, -1];
	const pixelX = Math.max(0, Math.min(c.width - 1, Math.floor(x)));
	const pixelY = Math.max(0, Math.min(c.height - 1, Math.floor(y)));
	const readback = d.createBuffer({
		"label": "Entity index readback",
		"size": 256,
		"usage": GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = d.createCommandEncoder();
	encoder.copyTextureToBuffer(
		{ "texture": entityIndexTexture, "origin": [pixelX, pixelY] },
		{ "buffer": readback },
		[1, 1],
	);
	Q.submit([encoder.finish()]);
	await readback.mapAsync(GPUMapMode.READ);
	const [packed, position] = new Uint32Array(readback.getMappedRange());
	readback.unmap();
	readback.destroy();
	return packed === 0xffffffff ? [-1, -1] : [packed, (position & 65535) / 1024 - 32, (position >>> 16) / 1024 - 32];
}

import {
	$,
	d,
	c,
	Q,
	G,
	GenArray,
	heldKeys,
	canvasSrgbFormat,
	label,
} from "./globals.js";
import { vec3 } from "./math.js";
import shaderCode from "../shaders/shader.wgsl";
import computeShaderCode from "../shaders/compute.wgsl";
import postShaderCode from "../shaders/post.wgsl";
import { palette } from "./palette.js";
import {
	entities,
	entityOverrides,
	ENTITY_DATA_SIZE,
	ENTITY_COUNT,
	cameraPosition,
	cameraRotation,
} from "./entities.js";
import { voxT } from "./vvm.js";

let lastFrameTime = performance.now();

const MAX_POINT_LIGHTS = 32;

let debugModule;
let cameraDragPointerId = null;

if (DEBUG && import.meta.env.DEBUG) {
	import("./debug/debug.js").then((module) => {
		debugModule = module;
		c.addEventListener("pointerdown", (event) => {
			if (event.button !== 2 || module.wantsMouse()) return;
			cameraDragPointerId = event.pointerId;
			c.setPointerCapture(event.pointerId);
			event.preventDefault();
		});
		c.addEventListener("pointermove", (event) => {
			if (event.pointerId !== cameraDragPointerId) return;
			if (!(event.buttons & 2)) {
				cameraDragPointerId = null;
				return;
			}
			cameraRotation[1] += event.movementX * 0.005;
			cameraRotation[0] -= event.movementY * 0.005;
			cameraRotation[0] = Math.max(
				-1.5,
				Math.min(1.5, cameraRotation[0]),
			);
		});
		c.addEventListener("pointerup", (event) => {
			if (event.pointerId === cameraDragPointerId)
				cameraDragPointerId = null;
		});
		c.addEventListener("lostpointercapture", () => {
			cameraDragPointerId = null;
		});
		c.addEventListener("pointerdown", async (event) => {
			if (event.button !== 0 || module.wantsMouse()) return;
			const bounds = c.getBoundingClientRect();
			const index = await pickEntity(
				((event.clientX - bounds.left) * c.width) / bounds.width,
				((event.clientY - bounds.top) * c.height) / bounds.height,
			);
			if (index >= 0) module.selectEntity(index);
		});
	});
}

// Bit-packed -1/+1 cube vertices.
const vertices = new Float32Array(
	GenArray(24, (i) => (((i / 3) >> (i % 3)) & 1) * 2 - 1),
);

var entityBuffer = d.createBuffer({
	"label": label`Entities`,
	"size": entities.byteLength,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

const pointLightCounterBuffer = d.createBuffer({
	"label": label`Point light counter`,
	"size": 4,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const pointLightBuffer = d.createBuffer({
	"label": label`Point lights`,
	"size": MAX_POINT_LIGHTS * 16,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});
const emptyPointLights = new Float32Array(MAX_POINT_LIGHTS * 4);

const renderState = new Float32Array(4);
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

Q.writeTexture(
	{ "texture": paletteTexture },
	palette,
	{ "bytesPerRow": 1024, "rowsPerImage": 2 },
	[256, 2],
);

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

const [shader, postShader, lightShader] = [
	shaderCode,
	postShaderCode,
	computeShaderCode,
].map((code) => d.createShaderModule({ "code": code }));

let scaleDown = 0;
function resizeCanvas() {
	const bounds = c.getBoundingClientRect();
	const pixelRatio = devicePixelRatio * 2 ** -scaleDown;
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	if (
		c.width === width &&
		c.height === height &&
		depthTexture &&
		sceneTexture &&
		entityIndexTexture
	)
		return;

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
		"usage":
			GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
	});
	sceneView = sceneTexture.createView();
	entityIndexTexture?.destroy();
	entityIndexTexture = d.createTexture({
		"label": label`Entity index texture`,
		"size": [width, height],
		"format": "r32uint",
		"usage": GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
	});
	entityIndexView = entityIndexTexture.createView();
}

if (window.ResizeObserver) new ResizeObserver(resizeCanvas).observe(c);

$.addEventListener("resize", resizeCanvas);
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
			},
			{
				"format": "r32uint",
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
	"vertex": { "module": postShader, "entryPoint": "vs_post" },
	"fragment": {
		"module": postShader,
		"entryPoint": "fs_post",
		"targets": [{ "format": canvasSrgbFormat }],
	},
});
const lightPipeline = d.createComputePipeline({
	"layout": "auto",
	"compute": { "module": lightShader, "entryPoint": "build_point_lights" },
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
			"resource": resource,
		})),
	});

const renderBindGroup = BG(
	pipeline,
	0,
	renderStateBuffer,
	entityBuffer,
	paletteTexture.createView(),
	pointLightBuffer,
);
const lightBindGroup = BG(
	lightPipeline,
	0,
	entityBuffer,
	pointLightCounterBuffer,
	pointLightBuffer,
);

export function render(t) {
	const now = performance.now();
	const deltaTime = (now - lastFrameTime) / 1000;
	lastFrameTime = now;

	const turnSpeed = 1.5;
	const moveSpeed = heldKeys.has("shift") ? 16 : 6;

	if (heldKeys.has("arrowleft")) cameraRotation[1] -= turnSpeed * deltaTime;
	if (heldKeys.has("arrowright")) cameraRotation[1] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowup")) cameraRotation[0] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowdown")) cameraRotation[0] -= turnSpeed * deltaTime;
	if (heldKeys.has("q")) cameraRotation[2] += turnSpeed * deltaTime;
	if (heldKeys.has("e")) cameraRotation[2] -= turnSpeed * deltaTime;
	cameraRotation[0] = Math.max(-1.5, Math.min(1.5, cameraRotation[0]));

	const cosPitch = Math.cos(cameraRotation[0]);
	const lookDirection = vec3(
		Math.sin(cameraRotation[1]) * cosPitch,
		Math.sin(cameraRotation[0]),
		-Math.cos(cameraRotation[1]) * cosPitch,
	);
	const right = vec3(
		Math.cos(cameraRotation[1]),
		0,
		Math.sin(cameraRotation[1]),
	);
	const forward_amount =
		Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	const strafe_amount = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const vertical_amount =
		Number(heldKeys.has("r")) - Number(heldKeys.has("f"));
	const movement = vec3(
		lookDirection[0] * forward_amount + right[0] * strafe_amount,
		lookDirection[1] * forward_amount + vertical_amount,
		lookDirection[2] * forward_amount + right[2] * strafe_amount,
	);
	const movement_length = Math.hypot(...movement);
	if (movement_length) {
		const movementScale = (moveSpeed * deltaTime) / movement_length;
		cameraPosition[0] += movement[0] * movementScale;
		cameraPosition[1] += movement[1] * movementScale;
		cameraPosition[2] += movement[2] * movementScale;
	}

	const time = now / 1000;
	const fov = 60;
	let canvasTexture = G.getCurrentTexture();
	let target = canvasTexture.createView({ format: canvasSrgbFormat });

	renderState.set([time, c.width / c.height, fov]);
	Q.writeBuffer(renderStateBuffer, 0, renderState);
	Q.writeBuffer(entityBuffer, 0, entities);
	Q.writeBuffer(pointLightCounterBuffer, 0, new Uint32Array(1));
	Q.writeBuffer(pointLightBuffer, 0, emptyPointLights);

	const e = d.createCommandEncoder();
	const lightPass = e.beginComputePass();
	lightPass.setPipeline(lightPipeline);
	lightPass.setBindGroup(0, lightBindGroup);
	lightPass.dispatchWorkgroups(Math.ceil(ENTITY_COUNT / 64));
	lightPass.end();

	const GRAPHICS_PASS_DESCRIPTOR = {
		"colorAttachments": [
			{
				"view": sceneView,
				"clearValue": [0, 0, 0, 1],
				"loadOp": "clear",
				"storeOp": "store",
			},
			{
				"view": entityIndexView,
				"clearValue": [0xffffffff, 0, 0, 0],
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

	let pass = e.beginRenderPass(GRAPHICS_PASS_DESCRIPTOR);
	pass.setBindGroup(0, renderBindGroup);
	pass.setPipeline(pipeline);
	pass.setVertexBuffer(0, vertexBuffer);
	pass.setIndexBuffer(indexBuffer, "uint16");
	for (let i = 1; i < voxT.length; i++) {
		pass.setBindGroup(1, BG(pipeline, 1, voxT[i].createView()));
		//pass.draw(vertices.length / 2); // 6 vertices
		pass.drawIndexed(idx.length, ENTITY_COUNT, 0, 0, i << 16);
	}
	pass.end();

	const bloomPass = e.beginRenderPass({
		"colorAttachments": [
			{
				"view": target,
				"clearValue": [0, 0, 0, 1],
				"loadOp": "clear",
				"storeOp": "store",
			},
		],
	});
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
		debugModule.debug(
			debugPass,
			entities,
			ENTITY_DATA_SIZE,
			entityOverrides,
		);
		debugPass.end();
	}

	Q.submit([e.finish()]);

	if (DEBUG) {
		let x = document.getElementById("fps");
		if (x)
			x.textContent = `FPS: ${Math.floor(1 / deltaTime)} | Time: ${Math.floor(performance.now() - now)}ms`;
	}
}

export async function pickEntity(x, y) {
	if (!entityIndexTexture) return -1;
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
		{ "buffer": readback, "bytesPerRow": 256 },
		[1, 1],
	);
	Q.submit([encoder.finish()]);
	await readback.mapAsync(GPUMapMode.READ);
	const index = new Uint32Array(readback.getMappedRange())[0];
	readback.unmap();
	readback.destroy();
	return index === 0xffffffff ? -1 : index;
}

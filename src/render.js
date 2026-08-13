import { d, c, Q, G, heldKeys } from "./globals.js";
import { vec3, vec3_add, vec3_muls } from "./math.js";
import shaderCode from "../shaders/shader.wgsl";

let cameraPosition = vec3(20, 8.5, 10);
let cameraYaw = -Math.PI / 2;
let cameraPitch = -Math.atan2(8.5, 20);
let cameraRoll = 0;
let lastFrameTime = performance.now();

let v = [];
for (let i = 24; i--;) v[i] = ((i / 3) >> (i % 3)) & 1;
console.log(v);
const vertices = new Float32Array(v);

// WGSL uniforms require vec3 values to begin at 16-byte boundaries.
const cameraUniform = new Float32Array(12);

var timeBuffer = d.createBuffer({
	"label": "Time buffer",
	"size": cameraUniform.byteLength,
	"usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

var voxT = new Array(64).fill(0).map((_, i) =>
	d.createTexture({
		"label": `Voxel texture ${i}`,
		"size": [64, 64, 64],
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	}),
);

let depthTexture;

const vertexBuffer = d.createBuffer({
	label: "Cell vertices",
	size: vertices.byteLength,
	usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
const indexBuffer = d.createBuffer({
	label: "Cell vertices",
	size: 36 * 2,
	usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
});

let idx = Uint16Array.from("046062137175015054267273023031457476");
Q.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);
Q.writeBuffer(indexBuffer, /*bufferOffset=*/ 0, idx);

const shader = d.createShaderModule({
	code: shaderCode,
});

function resizeCanvas() {
	const bounds = c.getBoundingClientRect();
	const pixelRatio = devicePixelRatio;
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	if (c.width === width && c.height === height && depthTexture) return;

	c.width = width;
	c.height = height;
	depthTexture?.destroy();
	depthTexture = d.createTexture({
		size: [width, height],
		format: "depth24plus",
		usage: GPUTextureUsage.RENDER_ATTACHMENT,
	});
}

new ResizeObserver(resizeCanvas).observe(c);

addEventListener("resize", resizeCanvas);
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
				"format": navigator.gpu.getPreferredCanvasFormat(),
			},
		],
	},
	"depthStencil": {
		"format": "depth24plus",
		"depthWriteEnabled": true,
		"depthCompare": "less",
	},
});

const bg = d.createBindGroup({
	"layout": pipeline.getBindGroupLayout(0),
	"entries": [
		{
			"binding": 0,
			"resource": {
				"buffer": timeBuffer,
			},
		},
	],
});

voxT.forEach((_, i) =>
	Q.writeTexture(
		{
			"texture": voxT[i],
		},
		new Float32Array(64 * 64 * 64 * 4),
		{
			"bytesPerRow": 64 * 4 * 4,
			"rowsPerImage": 64,
		},
		[64, 64, 64],
	),
);

export function render(dt) {
	const now = performance.now();
	const deltaTime = (now - dt) / 1000;

	if (DEBUG) {
		let x = document.getElementById("fps");
		if (x)
			x.textContent = `FPS: ${Math.floor(1 / deltaTime)} | Time: ${Math.floor(deltaTime * 1000)}ms`;
	}

	const turnSpeed = 1.5;
	const moveSpeed = 12;
	if (heldKeys.has("arrowleft")) cameraYaw += turnSpeed * deltaTime;
	if (heldKeys.has("arrowright")) cameraYaw -= turnSpeed * deltaTime;
	if (heldKeys.has("arrowup")) cameraPitch += turnSpeed * deltaTime;
	if (heldKeys.has("arrowdown")) cameraPitch -= turnSpeed * deltaTime;
	if (heldKeys.has("q")) cameraRoll += turnSpeed * deltaTime;
	if (heldKeys.has("e")) cameraRoll -= turnSpeed * deltaTime;
	cameraPitch = Math.max(-1.5, Math.min(1.5, cameraPitch));

	const cosPitch = Math.cos(cameraPitch);
	const lookDirection = vec3(
		Math.sin(cameraYaw) * cosPitch,
		Math.sin(cameraPitch),
		-Math.cos(cameraYaw) * cosPitch,
	);
	const right = [Math.cos(cameraYaw), 0, Math.sin(cameraYaw)];

	const dirs = {
		w: vec3(-1),
		s: vec3(1),
		a: vec3(0, 0, 1),
		d: vec3(0, 0, -1),
		r: vec3(0, 1),
		f: vec3(0, -1),
	};

	for (let d in dirs) {
		if (heldKeys.has(d)) {
			cameraPosition = vec3_add(
				cameraPosition,
				vec3_muls(dirs[d], moveSpeed * deltaTime),
			);
		}
	}

	const time = now / 1000;
	const fov = 60;

	cameraUniform[0] = time;
	cameraUniform[1] = c.width / c.height;
	// Camera position occupies the second vec4 in the WGSL uniform.
	cameraUniform.set([...cameraPosition, fov], 4);
	// Look direction and roll occupy the final vec4.
	cameraUniform.set([...lookDirection, cameraRoll], 8);

	const e = d.createCommandEncoder();

	const GRAPHICS_PASS_DESCRIPTOR = {
		"colorAttachments": [
			{
				"view": G.getCurrentTexture().createView(),
				"clearValue": [..."0001"],
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

	for (let i = 0; i < voxT.length; i++) {
		let pass = e.beginRenderPass(GRAPHICS_PASS_DESCRIPTOR);

		pass.setBindGroup(0, bg);
		pass.setPipeline(pipeline);
		pass.setVertexBuffer(0, vertexBuffer);
		pass.setIndexBuffer(indexBuffer, "uint16");
		pass.setBindGroup(
			1,
			d.createBindGroup({
				"layout": pipeline.getBindGroupLayout(1),
				"entries": [
					{
						"binding": 0,
						"resource": voxT[i % 16].createView(),
					},
				],
			}),
		);
		//pass.draw(vertices.length / 2); // 6 vertices
		pass.drawIndexed(idx.length, 1025, 0, 0);
		pass.end();
	}

	Q.writeBuffer(timeBuffer, 0, cameraUniform);

	Q.submit([e.finish()]);
}

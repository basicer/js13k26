import { $, d, c, Q, G, GenArray, heldKeys, canvasSrgbFormat } from "./globals.js";
import { vec3 } from "./math.js";
import shaderCode from "../shaders/shader.wgsl";
import postShaderCode from "../shaders/post.wgsl";
import { palette } from "./palette.js";

let lastFrameTime = performance.now();

const ENTITY_DATA_SIZE = 12;
const ENTITY_COUNT = 900;
const VOXEL_SIZE = 64;
let projectorSize, projectorVoxels;
let floorTileSize, floorTileVoxels;
let floorTileS04Size, floorTileS04Voxels;

let debugModule;

if (DEBUG && import.meta.env.DEV) {
	const [{ ddsVolume }, { default: projectorDds }, { default: floorTileLr01Dds }, { default: floorTileS04Dds }] = await Promise.all([
		import("./dds.js"),
		import("../dds/Projector.dds.gz"),
		import("../dds/FloorTile-LR01.dds"),
		import("../dds/FloorTile-S04.dds"),
	]);
	const [projector, floorTile, floorTileS04] = await Promise.all([
		ddsVolume(projectorDds, true),
		ddsVolume(floorTileLr01Dds),
		ddsVolume(floorTileS04Dds),
	]);
	({ size: projectorSize, voxels: projectorVoxels } = projector);
	({ size: floorTileSize, voxels: floorTileVoxels } = floorTile);
	({ size: floorTileS04Size, voxels: floorTileS04Voxels } = floorTileS04);

	import("./debug/debug.js").then((module) => {
		debugModule = module;
		c.addEventListener("pointerdown", async (event) => {
			if (event.button !== 0 || module.wantsMouse()) return;
			const bounds = c.getBoundingClientRect();
			const index = await pickEntity(
				(event.clientX - bounds.left) * c.width / bounds.width,
				(event.clientY - bounds.top) * c.height / bounds.height,
			);
			if (index >= 0) module.selectEntity(index);
		});
	});
}

// Bit-packed -1/+1 cube vertices.
const vertices = new Float32Array(GenArray(24, i=>(i / 3 >> i % 3 & 1) * 2 - 1));

const entitys = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE);
const cameraEntity = entitys.subarray(0, ENTITY_DATA_SIZE);
const cameraPosition = cameraEntity.subarray(4, 7);
const cameraRotation = cameraEntity.subarray(8, 11);
const entityOverrides = new Map();
cameraEntity[0] = 255;
cameraPosition.set([8, 8.5, 2]);
cameraRotation.set([-Math.atan2(8.5, 8), -Math.PI / 2, 0]);

for (let i = 1; i < ENTITY_COUNT; i++) {
	let e = entitys.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
	e[0] = i % 64;
	e[4] = Math.floor(i / 30);
	e[5] = i % 3 + Math.sin(performance.now() * 1e-3);
	e[6] = i % 30;
	if (entityOverrides.has(i)) e.set(entityOverrides.get(i));
}

var entityBuffer = d.createBuffer({
	"label": "Entities",
	"size": entitys.byteLength,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

var voxT = GenArray(64, i =>
	d.createTexture({
		"label": `Voxel texture ${i}`,
		"size": i == 2 && projectorSize ? projectorSize : i == 4 && floorTileSize ? floorTileSize : i == 5 && floorTileS04Size ? floorTileS04Size : [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE],
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	}),
);

const renderStates = voxT.map((_, kind) => {
	const data = new ArrayBuffer(16);
	new Uint32Array(data)[3] = kind;
	const buffer = d.createBuffer({
		label: `Render state ${kind}`,
		size: 16,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	return { data, values: new Float32Array(data), buffer };
});


var paletteTexture = d.createTexture({
    "label": "Palette texture",
    "size": [256, 2],
    "format": "rgba8unorm",
    "usage": GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
});

Q.writeTexture({ texture: paletteTexture }, palette, { bytesPerRow: 1024, rowsPerImage: 2 }, [256, 2]);

let depthTexture;
let sceneTexture;
let sceneView;
let entityIndexTexture;
let entityIndexView;

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

// One digit per index; faces wind inward.
let idx = Uint16Array.from("013032467475051045237276026064157173", Number);
Q.writeBuffer(vertexBuffer, /*bufferOffset=*/ 0, vertices);
Q.writeBuffer(indexBuffer, /*bufferOffset=*/ 0, idx);

const shader = d.createShaderModule({
	code: shaderCode,
});
const postShader = d.createShaderModule({ code: postShaderCode });

let scaleDown = 0;
function resizeCanvas() {
	const bounds = c.getBoundingClientRect();
	const pixelRatio = devicePixelRatio * (1/2**scaleDown);
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	if (c.width === width && c.height === height && depthTexture && sceneTexture && entityIndexTexture) return;

	c.width = width;
	c.height = height;
	depthTexture?.destroy();
	depthTexture = d.createTexture({
		size: [width, height],
		format: "depth24plus",
		usage: GPUTextureUsage.RENDER_ATTACHMENT,
	});
	sceneTexture?.destroy();
	sceneTexture = d.createTexture({
		label: "Bloom scene texture",
		size: [width, height],
		// Keep lighting values above 1.0 until the final tone-mapping pass.
		format: "rgba16float",
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
	});
	sceneView = sceneTexture.createView();
	entityIndexTexture?.destroy();
	entityIndexTexture = d.createTexture({
		label: "Entity index texture",
		size: [width, height],
		format: "r32uint",
		usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
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
	"primitive": { "cullMode": "front" },
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
const bloomSampler = d.createSampler({ magFilter: "linear", minFilter: "linear" });

console.log(pipeline.getBindGroupLayout(0));
const renderBindGroups = renderStates.map(({ buffer }) => d.createBindGroup({
	"layout": pipeline.getBindGroupLayout(0),
	"entries": [
		{ "binding": 0, "resource": { buffer } },
		{ "binding": 1, "resource": { "buffer": entityBuffer } },
		{ "binding": 2, "resource": paletteTexture.createView() },
	],
}));

const sphereCenter = (VOXEL_SIZE - 1) / 2;
const sphereRadius = VOXEL_SIZE * 0.38;

voxT.forEach((texture, kind) => {
	if (kind == 2 && projectorVoxels) {
		Q.writeTexture(
			{ texture },
			projectorVoxels,
			{ bytesPerRow: projectorSize[0] * 16, rowsPerImage: projectorSize[1] },
			projectorSize,
		);
		return;
	}
	if (kind == 4 && floorTileVoxels) {
		Q.writeTexture({ texture }, floorTileVoxels,
			{ bytesPerRow: floorTileSize[0] * 16, rowsPerImage: floorTileSize[1] }, floorTileSize);
		return;
	}
	if (kind == 5 && floorTileS04Voxels) {
		Q.writeTexture({ texture }, floorTileS04Voxels,
			{ bytesPerRow: 64 * 16, rowsPerImage: 4 }, floorTileS04Size);
		return;
	}
	const voxels = new Float32Array(VOXEL_SIZE ** 3 * 4);
	for (let z = 0; z < VOXEL_SIZE; z++) {
		for (let y = 0; y < VOXEL_SIZE; y++) {
			for (let x = 0; x < VOXEL_SIZE; x++) {
				const dx = x - sphereCenter;
				const dy = y - sphereCenter;
				const dz = z - sphereCenter;
				if (dx * dx + dy * dy + dz * dz > sphereRadius * sphereRadius) continue;
				voxels[((z * VOXEL_SIZE + y) * VOXEL_SIZE + x) * 4] = kind + 1;
			}
		}
	}
	// Every third kind is intentionally a solid cube; index 0 remains empty.
	if (kind % 3 == 0) voxels.fill(kind + 1);
	Q.writeTexture(
		{ texture },
		voxels,
		{ bytesPerRow: VOXEL_SIZE * 4 * 4, rowsPerImage: VOXEL_SIZE },
		[VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE],
	);
});

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
	const right = vec3(Math.cos(cameraRotation[1]), 0, Math.sin(cameraRotation[1]));
	const forward_amount = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	const strafe_amount = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const vertical_amount = Number(heldKeys.has("r")) - Number(heldKeys.has("f"));
	const movement = vec3(
		lookDirection[0] * forward_amount + right[0] * strafe_amount,
		lookDirection[1] * forward_amount + vertical_amount,
		lookDirection[2] * forward_amount + right[2] * strafe_amount,
	);
	const movement_length = Math.hypot(...movement);
	if (movement_length) {
		const movementScale = moveSpeed * deltaTime / movement_length;
		cameraPosition[0] += movement[0] * movementScale;
		cameraPosition[1] += movement[1] * movementScale;
		cameraPosition[2] += movement[2] * movementScale;
	}

	const time = now / 1000;
	const fov = 60;
	let canvasTexture = G.getCurrentTexture();
	let target = canvasTexture.createView({ format: canvasSrgbFormat });

	for (const state of renderStates) {
		state.values[0] = time;
		state.values[1] = c.width / c.height;
		state.values[2] = fov;
		Q.writeBuffer(state.buffer, 0, state.data);
	}


	const e = d.createCommandEncoder();

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
	for (let i = 0; i < voxT.length; i++) {

		pass.setBindGroup(0, renderBindGroups[i]);
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
						"resource": voxT[i].createView(),
					},
				],
			}),
		);
		//pass.draw(vertices.length / 2); // 6 vertices
		pass.drawIndexed(idx.length, entitys.length / ENTITY_DATA_SIZE, 0, 0);
	}
	pass.end();
    
    
	const bloomPass = e.beginRenderPass({
		"colorAttachments": [{
			"view": target,
			"clearValue": [0, 0, 0, 1],
			"loadOp": "clear",
			"storeOp": "store",
		}],
	});
	bloomPass.setPipeline(bloomPipeline);
	bloomPass.setBindGroup(0, d.createBindGroup({
		"layout": bloomPipeline.getBindGroupLayout(0),
		"entries": [
			{ "binding": 0, "resource": sceneView },
			{ "binding": 1, "resource": bloomSampler },
		],
	}));
	bloomPass.draw(3);
	bloomPass.end();

	// ImGui's WebGPU backend targets the canvas's base unorm format. Use its
	// compatible view in a separate pass after the linear scene was encoded by
	// the sRGB view above.
	if (DEBUG && debugModule) {
		let debugPass = e.beginRenderPass({
			colorAttachments: [{
				view: canvasTexture.createView(),
				loadOp: "load",
				storeOp: "store",
			}],
		});
		debugModule.debug(debugPass, entitys, ENTITY_DATA_SIZE, entityOverrides);
		debugPass.end();
	}


        
	Q.writeBuffer(entityBuffer, 0, entitys);

	
   
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
		label: "Entity index readback",
		size: 256,
		usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
	});
	const encoder = d.createCommandEncoder();
	encoder.copyTextureToBuffer(
		{ texture: entityIndexTexture, origin: [pixelX, pixelY] },
		{ buffer: readback, bytesPerRow: 256 },
		[1, 1],
	);
	Q.submit([encoder.finish()]);
	await readback.mapAsync(GPUMapMode.READ);
	const index = new Uint32Array(readback.getMappedRange())[0];
	readback.unmap();
	readback.destroy();
	return index === 0xffffffff ? -1 : index;
}

import { $, d, c, Q, G, GenArray, heldKeys } from "./globals.js";
import { vec3, vec3_add, vec3_muls } from "./math.js";
import { material, palette } from "./palette.js";
import shaderCode from "../shaders/shader.wgsl";
import postShaderCode from "../shaders/post.wgsl";

let cameraPosition = vec3(8, 8.5, 2);
let cameraYaw = -Math.PI / 2;
let cameraPitch = -Math.atan2(8.5, 8);
let cameraRoll = 0;
let lastFrameTime = performance.now();

const ENTITY_DATA_SIZE = 8;
const ENTITY_COUNT = 900;

let debug;

if (DEBUG && import.meta.env.DEV) {
    import("./debug/debug.js").then((module) => debug = module.debug);
}

// Bit-packed -1/+1 cube vertices.
const vertices = new Float32Array(GenArray(24, i=>(i / 3 >> i % 3 & 1) * 2 - 1));

// WGSL uniforms require vec3 values to begin at 16-byte boundaries.
const cameraUniform = new Float32Array(12);

var timeBuffer = d.createBuffer({
	"label": "Time buffer",
	"size": cameraUniform.byteLength,
	"usage": GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});


const entitys = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE); // 250 entities, 8 floats each

for (let i = 0; i < ENTITY_COUNT; i++) {
    let e = entitys.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
    e[0] = i % 64;
}

var entityBuffer = d.createBuffer({
	"label": "Entities",
	"size": entitys.byteLength,
	"usage": GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
});

var voxT = GenArray(64, i =>
	d.createTexture({
		"label": `Voxel texture ${i}`,
		"size": [64, 64, 64],
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	}),
);

const voxKindBuffers = voxT.map((_, kind) => {
	const buffer = d.createBuffer({
		label: `Voxel kind ${kind}`,
		size: 16,
		usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
	});
	Q.writeBuffer(buffer, 0, new Uint32Array([kind]));
	return buffer;
});


var paletteTexture = d.createTexture({
    "label": "Palette texture",
    "size": [256, 2],
    "format": "rgba8unorm",
    "usage": GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_DST,
});

const paletteData = new Uint32Array(256 * 2);
paletteData.set(palette);
for (let i = 0; i < 256; i++)
	paletteData[256 + i] = material[i * 2] | material[i * 2 + 1] << 8 | 255 << 24;

let depthTexture;
let sceneTexture;
let sceneView;

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

function resizeCanvas() {
	const bounds = c.getBoundingClientRect();
	const pixelRatio = devicePixelRatio;
	const width = Math.max(1, Math.round(bounds.width * pixelRatio));
	const height = Math.max(1, Math.round(bounds.height * pixelRatio));
	if (c.width === width && c.height === height && depthTexture && sceneTexture) return;

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
		"targets": [{ "format": navigator.gpu.getPreferredCanvasFormat() }],
	},
});
const bloomSampler = d.createSampler({ magFilter: "linear", minFilter: "linear" });

console.log(pipeline.getBindGroupLayout(0));
const bg = d.createBindGroup({
	"layout": pipeline.getBindGroupLayout(0),
	"entries": [
		{
			"binding": 0,
			"resource": { "buffer": timeBuffer },
		},
    	{
			"binding": 1,
			"resource": { "buffer": entityBuffer },
		},
        {
            binding: 2,
            resource: paletteTexture.createView(),
        }
	],
});

const VOXEL_SIZE = 64;
const sphereCenter = (VOXEL_SIZE - 1) / 2;
const sphereRadius = VOXEL_SIZE * 0.38;

voxT.forEach((texture, kind) => {
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
	const moveSpeed = heldKeys.has("shift") ? 32 : 12;

	if (heldKeys.has("arrowleft")) cameraYaw -= turnSpeed * deltaTime;
	if (heldKeys.has("arrowright")) cameraYaw += turnSpeed * deltaTime;
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
	const right = vec3(Math.cos(cameraYaw), 0, Math.sin(cameraYaw));
	const forward_amount = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	const strafe_amount = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const vertical_amount = Number(heldKeys.has("r")) - Number(heldKeys.has("f"));
	const movement = vec3(
		lookDirection[0] * forward_amount + right[0] * strafe_amount,
		lookDirection[1] * forward_amount + vertical_amount,
		lookDirection[2] * forward_amount + right[2] * strafe_amount,
	);
	const movement_length = Math.hypot(...movement);
	if (movement_length)
		cameraPosition = vec3_add(cameraPosition, vec3_muls(movement, moveSpeed * deltaTime / movement_length));

	const time = now / 1000;
	const fov = 60;
    let target = G.getCurrentTexture().createView();

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
				"view": sceneView,
				"clearValue": [0, 0, 0, 1],
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
						"resource": voxT[i].createView(),
					},
					{
						"binding": 1,
						"resource": { "buffer": voxKindBuffers[i] },
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
	if (DEBUG && debug) debug(bloomPass);
	bloomPass.end();

        
	Q.writeBuffer(timeBuffer, 0, cameraUniform);
	Q.writeBuffer(entityBuffer, 0, entitys);
    Q.writeTexture({
        "texture": paletteTexture,
    }, paletteData, {
        "bytesPerRow": 256 * 4,
        "rowsPerImage": 2,
	}, [256, 2]);

	
   
    Q.submit([e.finish()]);

    if (DEBUG) {
		let x = document.getElementById("fps");
		if (x)
			x.textContent = `FPS: ${Math.floor(1 / deltaTime)} | Time: ${Math.floor(performance.now() - now)}ms`;
	}
}

import { GenArray, label, d, Q } from "./globals.js";

const VOXEL_SIZE = 64;
let projectorSize, projectorVoxels;
let floorTileSize, floorTileVoxels;
let floorTileS04Size, floorTileS04Voxels;

if (DEBUG && import.meta.env.DEV) {
	const [
		{ ddsVolume },
		{ default: projectorDds },
		{ default: floorTileLr01Dds },
		{ default: floorTileS04Dds },
	] = await Promise.all([
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
}

export var voxT = GenArray(64, (i) =>
	d.createTexture({
		"label": label`Voxel texture ${i}`,
		"size":
			i == 2 && projectorSize
				? projectorSize
				: i == 4 && floorTileSize
					? floorTileSize
					: i == 5 && floorTileS04Size
						? floorTileS04Size
						: [VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE],
		"dimension": "3d",
		"format": "rgba32float",
		"usage": GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
	}),
);

const sphereCenter = (VOXEL_SIZE - 1) / 2;
const sphereRadius = VOXEL_SIZE * 0.38;

voxT.forEach((texture, kind) => {
	if (kind == 2 && projectorVoxels) {
		Q.writeTexture(
			{ "texture": texture },
			projectorVoxels,
			{
				"bytesPerRow": projectorSize[0] * 16,
				"rowsPerImage": projectorSize[1],
			},
			projectorSize,
		);
		return;
	}
	if (kind == 4 && floorTileVoxels) {
		Q.writeTexture(
			{ "texture": texture },
			floorTileVoxels,
			{
				"bytesPerRow": floorTileSize[0] * 16,
				"rowsPerImage": floorTileSize[1],
			},
			floorTileSize,
		);
		return;
	}
	if (kind == 5 && floorTileS04Voxels) {
		Q.writeTexture(
			{ "texture": texture },
			floorTileS04Voxels,
			{ "bytesPerRow": 64 * 16, "rowsPerImage": 4 },
			floorTileS04Size,
		);
		return;
	}
	const voxels = new Float32Array(VOXEL_SIZE ** 3 * 4);
	for (let z = 0; z < VOXEL_SIZE; z++) {
		for (let y = 0; y < VOXEL_SIZE; y++) {
			for (let x = 0; x < VOXEL_SIZE; x++) {
				const dx = x - sphereCenter;
				const dy = y - sphereCenter;
				const dz = z - sphereCenter;
				if (dx * dx + dy * dy + dz * dz > sphereRadius * sphereRadius)
					continue;
				voxels[((z * VOXEL_SIZE + y) * VOXEL_SIZE + x) * 4] = kind + 1;
			}
		}
	}
	// Every third kind is intentionally a solid cube; index 0 remains empty.
	if (kind % 3 == 0) voxels.fill(kind + 1);
	Q.writeTexture(
		{ "texture": texture },
		voxels,
		{ "bytesPerRow": VOXEL_SIZE * 4 * 4, "rowsPerImage": VOXEL_SIZE },
		[VOXEL_SIZE, VOXEL_SIZE, VOXEL_SIZE],
	);
});

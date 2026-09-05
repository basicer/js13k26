import { GenArray } from "./globals.js";

export const ENTITY_DATA_SIZE = 20; // (in floats)
// Types 128–253 are transparent aliases of type & 127; 254/255 remain reserved.
// Slot 3 is dissolve (0 = intact, 1 = fully affected), matching Entity in structs.wgsl.
// Slot 7 is transparency (0 = opaque, 1 = invisible); spawn resets both to zero.
// Slot 11 is dissolve palette (0 = remove chunks, otherwise replace their material).
// Slot 15 selects voxel model variant 0 or 1.
// Kind 1 is the empty marine root; kinds 8–11 are legs, body, arms, and gun.
export const ENTITY_COUNT = 1900;

export const entities = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE).fill(
	0,
);

const cameraEntity = entities.subarray(0, ENTITY_DATA_SIZE);
export const cameraPosition = cameraEntity.subarray(4, 7);
export const cameraRotation = cameraEntity.subarray(8, 11);
export const entityOverrides = new Map();

export const EArray = GenArray(ENTITY_COUNT, (i) => {
	let arr = entities.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
	arr.id = i;
	return arr;
});
EArray.map((e) => (e[0] = 255)); // Initialize all entities to empty

cameraEntity[0] = 254; // Camera entity kind
cameraPosition.set([-9, 7, 2]);
cameraRotation.set([-0.5, Math.PI / 2, 0]);
cameraEntity.set([1, 1, 1], 12);

export const spawn = (kind) => {
	let e = EArray.find((e) => e[0] === 255);
	if (!e) return null;
	// Entities are recycled (muzzle flashes and blood use the same pool), so
	// clear overrides, rotations, lights, and parent links from their old role.
	e.fill(0);
	e[0] = kind;
	e[12] = e[13] = e[14] = 1;
	e[16] = e[17] = e[18] = -2;
	return e;
}


let floor = spawn(5);
floor[5] = -32/64;
floor[12] = 32;
floor[13] = 4/64;
floor[14] = 32;

let light = spawn(6);
light[6] = 2;
light[5] = 2;
light[1] = 5;

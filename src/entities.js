import { GenArray } from "./globals.js";

export const ENTITY_DATA_SIZE = 32; // (in floats)
// Kind 0 is empty. Types 128–253 are transparent aliases; 254/255 remain reserved.
// Slot 3 is dissolve (0 = intact, 1 = fully affected), matching Entity in common.wgsl.
// Slot 7 is transparency (0 = opaque, 1 = invisible); spawn resets both to zero.
// Slot 11 is dissolve palette (0 = remove chunks, otherwise replace their material).
// Slot 15 selects voxel model variant 0 or 1.
// Slots 20-22 are velocity; slot 23 is total TTL (zero lives forever).
// Slot 24 is the full spotlight cone angle in radians; 2*PI is omnidirectional.
// Slots 25/26 hold actor health and walk phase; slot 27 is age in seconds.
// Age advances even for immortal entities and resets on reuse or a new corpse timer.
// Slot 28 is solid-box collision (0/1); slots 29-31 preserve GPU struct alignment.
// New entities live indefinitely unless given a nonzero TTL.
// Kind 1 is the empty marine root; kinds 8–11 are legs, body, arms, and gun.
export const ENTITY_COUNT = 1900;

export const entities = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE);

export const cameraEntity = entities.subarray(0, ENTITY_DATA_SIZE);
export const cameraPosition = cameraEntity.subarray(4, 7);
export const cameraRotation = cameraEntity.subarray(8, 11);
export const entityOverrides = new Map();

export const EArray = GenArray(ENTITY_COUNT, (i) => {
	let arr = entities.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
	arr.id = i;
	return arr;
});

export const spawn = (kind) => {
	let e = EArray.find((e) => e[0] === 0);
	if (!e) return null;
	// Entities are recycled (muzzle flashes and blood use the same pool), so
	// clear overrides, rotations, lights, and parent links from their old role.
	e.fill(0);
	e[0] = kind;
	e[24] = Math.PI * 2;
	e[12] = e[13] = e[14] = 1;
	e[16] = e[17] = e[18] = -2;
	return e;
};

export let entityVersion = 0;

export function setupEntities() {
	entityVersion++;
	entities.fill(0);
	entityOverrides.clear();
	cameraEntity[24] = Math.PI * 2;
	cameraEntity[0] = 254; // Camera entity kind
	cameraRotation.set([(-50 * Math.PI) / 180, Math.PI / 2, 0]);
	cameraPosition.set([-9.2 * Math.cos(cameraRotation[0]), -9.2 * Math.sin(cameraRotation[0]), 0]);
	cameraEntity.set([1, 1, 1], 12);

	const floor = spawn(5);
	floor[5] = -32 / 64;
	floor[12] = 32;
	floor[13] = 4 / 64;
	floor[14] = 32;

	let light = spawn(6);
	light[6] = 2;
	light[5] = 2;
	light[1] = 5;
}

// Preserve input/editor changes made while a GPU frame was in flight.
export function mergeEntityFrame(submitted, simulated, version = entityVersion) {
	if (version !== entityVersion) return;
	for (const entity of EArray) {
		const offset = entity.id * ENTITY_DATA_SIZE;
		if (entity.every((value, slot) => value === submitted[offset + slot]))
			entity.set(simulated.subarray(offset, offset + ENTITY_DATA_SIZE));
		// Movement and damage edits must not freeze the independent lifetime clock.
		else if ([0, 23, 27].every((slot) => entity[slot] === submitted[offset + slot]))
			entity[27] = simulated[offset + 27];
	}
}

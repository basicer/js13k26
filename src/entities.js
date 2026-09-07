import * as E from "./entities-const.js";
import { GenArray } from "./globals.js";

export const ENTITY_DATA_SIZE = E.STRIDE; // (in floats)
// Kind 0 is empty. Types 128–253 are transparent aliases; 254/255 remain reserved.
// Slot 3 is dissolve (0 = intact, 1 = fully affected), matching Entity in common.wgsl.
// Slot 7 is transparency (0 = opaque, 1 = invisible); spawn resets both to zero.
// Slot 11 is dissolve palette (0 = remove chunks, otherwise replace their material).
// Slot 15 selects voxel model variant 0 or 1.
// Slots 20-22 are velocity; slot 23 is total TTL (zero lives forever).
// Slot 24 is the full spotlight cone angle in radians; 2*PI is omnidirectional.
// Slots 25/26 hold actor health and walk phase; slot 27 is age in seconds.
// Age advances even for immortal entities and resets on reuse or a new corpse timer.
// Slot 28 is movement solidity; 29/30 are local hit radius and sphere center Y.
// Radius zero uses only the box. Lifecycle and movement properties follow.
// New entities live indefinitely unless given a nonzero TTL.
// Kind 1 is the empty marine root; kinds 8–11 are legs, body, arms, and gun.
// Unicorn kind 2 owns gameplay and walking legs; kind 18 is its attached head/neck.
// Kind 19 is a tiled steel door panel under a positioned kind-1 root.
export const ENTITY_COUNT = 1900;

export const entities = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE);

export const cameraEntity = entities.subarray(0, ENTITY_DATA_SIZE);
export const cameraPosition = cameraEntity.subarray(E.POS, E.POS + 3);
export const cameraRotation = cameraEntity.subarray(E.ROT, E.ROT + 3);
export const entityOverrides = new Map();

export const EArray = GenArray(ENTITY_COUNT, (i) => {
	let arr = entities.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
	arr.id = i;
	return arr;
});

export const spawn = (kind) => {
	let e = EArray.find((e) => e[E.KIND] === 0);
	if (!e) return null;
	// Entities are recycled (muzzle flashes and blood use the same pool), so
	// clear overrides, rotations, lights, and parent links from their old role.
	e.fill(0);
	e[E.KIND] = kind;
	e[E.LIGHT_ANGLE] = Math.PI * 2;
	e.fill(1, E.SCALE, E.SCALE + 3);
	e.fill(-2, E.TILE, E.TILE + 3);
	return e;
};

export let entityVersion = 0;

export function setupEntities() {
	entityVersion++;
	entities.fill(0);
	entityOverrides.clear();
	cameraEntity[E.LIGHT_ANGLE] = Math.PI * 2;
	cameraEntity[E.KIND] = 254; // Camera entity kind
	cameraRotation.set([(-50 * Math.PI) / 180, Math.PI / 2, 0]);
	cameraPosition.set([-9.2 * Math.cos(cameraRotation[0]), -9.2 * Math.sin(cameraRotation[0]), 0]);
	cameraEntity.set([1, 1, 1], E.SCALE);

}

// An invalid entity ID terminates the light list, including when it is empty.
export const lightEntities = new Uint32Array(32);

export function updateEntities(dt) {
	// Controllers run first so targets move this frame regardless of entity order.
	for (const entity of EArray) if (entity[E.KIND] === 15 && entity[E.CONTROLLER]) {
		const target = EArray[entity[E.CONTROLLER]];
		// Links are allocated entity slots; spawn clears all fields before reuse.
		target.fill(0, E.TARGET_POSITION, E.TARGET_POSITION + 3);
		target[E.TARGET_POSITION + (target[E.SCALE_X] > target[E.SCALE_Z] ? 0 : 2)] = entity[E.MODEL_VARIANT] * 4;
		target[E.LERP_SPEED] = 2;
	}
	lightEntities.fill(-1);
	let lights = 0;
	for (const entity of EArray) {
		if (!entity[E.KIND]) continue;
		if (entity[E.KIND] === 18) {
			const body = EArray[entity[E.PARENT]];
			// Bodies are allocated before heads, so expiry is handled before reuse.
			if (body[E.KIND] !== 2) { entity.fill(0); continue; }
			for (const slot of [E.DISSOLVE, E.DISSOLVE_PALETTE, E.MAT_OVERRIDE, E.TRANSPARENCY])
				entity[slot] = body[slot];
		}
		if (dt) {
			entity[E.AGE] += dt;
			if (entity[E.TTL] && entity[E.AGE] >= entity[E.TTL]) {
				entity.fill(0);
				continue;
			}
			const blend = 1 - Math.exp(-entity[E.LERP_SPEED] * dt);
			for (let axis = 0; axis < 3; axis++) entity[E.POS + axis] += entity[E.VELOCITY + axis] * dt +
				(entity[E.TARGET_POSITION + axis] - entity[E.POS + axis]) * blend;
			// Any entity can erode toward a target and retire once fully dissolved.
			if (entity[E.DISSOLVE_RATE]) {
				entity[E.DISSOLVE] = Math.min(entity[E.DISSOLVE_TARGET], entity[E.DISSOLVE] + entity[E.DISSOLVE_RATE] * dt);
				if (entity[E.DISSOLVE] >= 1) {
					entity.fill(0);
					continue;
				}
			}
			if (entity[E.GRAVITY]) {
				entity[E.VELOCITY_Y] -= entity[E.GRAVITY] * dt;
				const floor = -30 / 64 + entity[E.SCALE_Y] * 0.38;
				if (entity[E.POS_Y] <= floor + 0.000001) {
					entity[E.POS_Y] = floor;
					entity[E.VELOCITY_Y] = 0;
				}
			}
		}
		if (entity[E.SPOTLIGHT] > 0 && lights < lightEntities.length) lightEntities[lights++] = entity.id;
	}
}

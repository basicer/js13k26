import * as E from "../entities-const.js";
import { cameraEntity, cameraPosition, EArray, entityVersion } from "../entities.js";

let parentId = 0, version;

// Gameplay's root supplies translation and scale; aiming lives on its body child.
export function detachCamera() {
	if (!cameraEntity[E.PARENT]) return;
	cameraEntity[E.LERP_SPEED] = 0; // Manual camera control cancels the intro glide.
	parentId = cameraEntity[E.PARENT];
	version = entityVersion;
	const parent = EArray[parentId];
	for (let axis = 0; axis < 3; axis++)
		cameraPosition[axis] = parent[axis + E.POS] + cameraPosition[axis] * parent[axis + E.SCALE];
	cameraEntity[E.PARENT] = 0;
}

// Scene previews do not have a gameplay root to follow when play resumes.
export function freeCamera() {
	detachCamera();
	parentId = 0;
}

export function attachCamera() {
	if (!parentId || version !== entityVersion || cameraEntity[E.PARENT]) return;
	const parent = EArray[parentId];
	for (let axis = 0; axis < 3; axis++)
		cameraPosition[axis] = (cameraPosition[axis] - parent[axis + E.POS]) / parent[axis + E.SCALE];
	cameraEntity[E.PARENT] = parentId;
	parentId = 0;
}

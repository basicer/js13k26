import { cameraEntity, cameraPosition, EArray, entityVersion } from "../entities.js";

let parentId = 0, version;

// Gameplay's root supplies translation and scale; aiming lives on its body child.
export function detachCamera() {
	if (!cameraEntity[2]) return;
	parentId = cameraEntity[2];
	version = entityVersion;
	const parent = EArray[parentId];
	for (let axis = 0; axis < 3; axis++)
		cameraPosition[axis] = parent[axis + 4] + cameraPosition[axis] * parent[axis + 12];
	cameraEntity[2] = 0;
}

export function attachCamera() {
	if (!parentId || version !== entityVersion || cameraEntity[2]) return;
	const parent = EArray[parentId];
	for (let axis = 0; axis < 3; axis++)
		cameraPosition[axis] = (cameraPosition[axis] - parent[axis + 4]) / parent[axis + 12];
	cameraEntity[2] = parentId;
	parentId = 0;
}

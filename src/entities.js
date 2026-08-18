import { GenArray } from "./globals.js";

export const ENTITY_DATA_SIZE = 12;
export const ENTITY_COUNT = 1900;

export const entities = new Float32Array(ENTITY_COUNT * ENTITY_DATA_SIZE).fill(
	0,
);

const cameraEntity = entities.subarray(0, ENTITY_DATA_SIZE);
export const cameraPosition = cameraEntity.subarray(4, 7);
export const cameraRotation = cameraEntity.subarray(8, 11);
export const entityOverrides = new Map();

export const EArray = GenArray(ENTITY_COUNT, (i) =>
	entities.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE),
);
EArray.map((e) => (e[0] = 255)); // Initialize all entities to empty

cameraEntity[0] = 254; // Camera entity kind
cameraPosition.set([-6, 3, 2]);
cameraRotation.set([-0.3, Math.PI / 2, 0]);

for (let i = 1; i < 1000; i++) {
	let e = entities.subarray(i * ENTITY_DATA_SIZE, (i + 1) * ENTITY_DATA_SIZE);
	e[0] = i % 64;
	e[4] = Math.floor(i / 30);
	e[5] = 0;
	e[6] = i % 30;
	if (entityOverrides.has(i)) e.set(entityOverrides.get(i));
}

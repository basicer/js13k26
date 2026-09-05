import { spawn } from "./entities.js";

const solids = [];
const ground = -30 / 64;

function block(x, z, width, height, depth, material, bottom = ground, solid = true) {
	const entity = spawn(7);
	if (!entity) return;
	entity.set([x, bottom + height / 2, z], 4);
	entity.set([width, height, depth], 12);
	entity[19] = material;
	if (solid) solids.push([x - width / 2, x + width / 2, z - depth / 2, z + depth / 2, bottom + height]);
}

// Open-roof yard with broad lanes between rough concrete and cargo cover.
for (const side of [-1, 1]) {
	block(side * 15.5, 0, 1, 2.8, 32, 168);
	block(0, side * 15.5, 30, 2.8, 1, 168);
}
for (const [x, z, width, depth] of [[-6, -5, 5, 1], [5, -5, 1, 5], [-6, 2, 1, 4], [1, 8, 5, 1]]) {
	block(x, z, width, 1.9, depth, 175);
	block(x, z, width + 0.08, 0.12, depth + 0.08, 248, ground + 1.9, false);
}
for (const [x, z] of [[5, 5], [9, 0], [-10, 9]]) {
	block(x, z, 2.5, 1.8, 2.5, 62);
	block(x, z, 2.6, 0.12, 2.6, 101, ground + 1.8, false);
	block(x + 0.3, z + 0.2, 1.5, 1, 1.5, 69, ground + 1.92);
}

export function canStand(x, z, radius = 0.45) {
	return Math.abs(x) <= 15 - radius && Math.abs(z) <= 15 - radius
		&& !solids.some(([left, right, back, front]) =>
			x > left - radius && x < right + radius && z > back - radius && z < front + radius);
}

export function moveActor(entity, dx, dz) {
	// Small steps prevent tunneling; separate axes let actors slide along walls.
	const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
	for (let i = 0; i < steps; i++) {
		if (canStand(entity[4] + dx / steps, entity[6])) entity[4] += dx / steps;
		if (canStand(entity[4], entity[6] + dz / steps)) entity[6] += dz / steps;
	}
}

export function clearShot(x, z, targetX, targetZ) {
	// Intersect the shot segment with each block at muzzle height.
	return !solids.some(([left, right, back, front, top]) => {
		if (top < 1.25) return false;
		let near = 0, far = 1;
		for (const [origin, direction, min, max] of [[x, targetX - x, left, right], [z, targetZ - z, back, front]]) {
			if (Math.abs(direction) < 0.00001) {
				if (origin < min || origin > max) return false;
			} else {
				const a = (min - origin) / direction, b = (max - origin) / direction;
				near = Math.max(near, Math.min(a, b));
				far = Math.min(far, Math.max(a, b));
				if (near > far) return false;
			}
		}
		return true;
	});
}

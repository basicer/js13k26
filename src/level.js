import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;

function block(x, z, width, height, depth, material = 0, bottom = ground, solid = true) {
	const entity = spawn(7);
	if (!entity) return;
	entity.set([x, bottom + height / 2, z], 4);
	entity.set([width, height, depth], 12);
	// Whole panels meet both ends of every block; approximately two world units each.
	entity.set(
		[width, height, depth].map((size) => Math.max(1, Math.round(size / 2))),
		16,
	);
	entity[19] = material;
	entity[28] = Number(solid);
	return entity;
}

export function setupLevel() {
	// Open-roof yard with broad lanes between metallic bulkheads and cargo cover.
	for (const side of [-1, 1]) {
		block(side * 15.5, 0, 1, 2.8, 32);
		block(0, side * 15.5, 30, 2.8, 1);
	}
	for (const [x, z, width, depth] of [
		[-6, -5, 5, 1],
		[5, -5, 1, 5],
		[-6, 2, 1, 4],
		[1, 8, 5, 1],
	]) {
		block(x, z, width, 1.9, depth);
		block(x, z, width + 0.08, 0.12, depth + 0.08, 248, ground + 1.9, false);
	}
	// Freestanding safety rails along the open camera-side lane.
	for (const z of [-10, 0, 6]) block(-12, z, 4, 1, 0.2)[0] = 14;
	// Broad, full-height face behind the interior portal.
	block(9, 0, 2.5, 2.8, 3.6);
	for (const [x, z] of [
		[5, 5],
		[-10, 9],
	]) {
		block(x, z, 2.5, 1.8, 2.5);
		block(x, z, 2.6, 0.12, 2.6, 101, ground + 1.8, false);
		block(x + 0.3, z + 0.2, 1.5, 1, 1.5, 0, ground + 1.92);
	}
}

export function canStand(x, z, radius = 0.45) {
	return !EArray.some(
		(entity) =>
			entity[0] &&
			entity[28] &&
			Math.abs(x - entity[4]) < Math.abs(entity[12]) / 2 + radius &&
			Math.abs(z - entity[6]) < Math.abs(entity[14]) / 2 + radius,
	);
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
	return shotFraction(x, z, targetX, targetZ) === 1;
}

export function shotFraction(x, z, targetX, targetZ, y = 1.25, targetY = y) {
	// Intersect the shot segment against each solid box, including its height.
	return EArray.reduce((nearest, entity) => {
		if (!entity[0] || !entity[28]) return nearest;
		let near = 0,
			far = 1;
		for (const [origin, direction, axis] of [
			[x, targetX - x, 4],
			[z, targetZ - z, 6],
			[y, targetY - y, 5],
		]) {
			const half = Math.abs(entity[axis + 8]) / 2;
			const min = entity[axis] - half,
				max = entity[axis] + half;
			if (Math.abs(direction) < 0.00001) {
				if (origin < min || origin > max) return nearest;
			} else {
				const a = (min - origin) / direction,
					b = (max - origin) / direction;
				near = Math.max(near, Math.min(a, b));
				far = Math.min(far, Math.max(a, b));
				if (near > far) return nearest;
			}
		}
		return Math.min(nearest, near);
	}, 1);
}

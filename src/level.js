import * as E from "./entities-const.js";
import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;

function block(x, z, width, height, depth, material = 0, bottom = ground, solid = true) {
	const entity = spawn(7);
	if (!entity) return;
	entity.set([x, bottom + height / 2, z], E.POS);
	entity.set([width, height, depth], E.SCALE);
	// Whole panels meet both ends of every block; approximately two world units each.
	entity.set(
		[width, height, depth].map((size) => Math.max(1, Math.round(size / 2))),
		E.TILE,
	);
	entity[E.MAT_OVERRIDE] = material;
	entity[E.SOLID] = Number(solid);
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
	for (const z of [-10, 0, 6]) block(-12, z, 4, 1, 0.2)[E.KIND] = 14;
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
	// Small freestanding crates supplement the original cargo cover.
	for (const [x, z] of [[-3, -3], [-8, 5], [2, -8], [8, 7]]) {
		const crate = block(x, z, 0.75, 0.75, 0.75);
		crate[E.KIND] = 16;
		crate[E.HEALTH] = crate[E.MAX_HEALTH] = 4;
		crate[E.DISSOLVE_RATE] = .5;
	}
	// Flush against the front face of the nearby bulkhead.
	const console = spawn(15);
	console.set([-4.5, 0.6, -4.375], E.POS);
	console.set([1.25, 1, 0.25], E.SCALE);
	console[E.TILE_X] = console[E.TILE_Y] = console[E.TILE_Z] = 0;
}

export function canStand(x, z, radius = 0.45) {
	return !EArray.some(
		(entity) =>
			entity[E.KIND] &&
			entity[E.SOLID] &&
			Math.abs(x - entity[E.POS_X]) < Math.abs(entity[E.SCALE_X]) / 2 + radius &&
			Math.abs(z - entity[E.POS_Z]) < Math.abs(entity[E.SCALE_Z]) / 2 + radius,
	);
}

export function moveActor(entity, dx, dz) {
	const x = entity[E.POS_X], z = entity[E.POS_Z];
	// Small steps prevent tunneling; separate axes let actors slide along walls.
	const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
	for (let i = 0; i < steps; i++) {
		if (canStand(entity[E.POS_X] + dx / steps, entity[E.POS_Z])) entity[E.POS_X] += dx / steps;
		if (canStand(entity[E.POS_X], entity[E.POS_Z] + dz / steps)) entity[E.POS_Z] += dz / steps;
	}
	if (entity[E.WALK_STRIDE]) {
		entity[E.WALK] = (entity[E.WALK] + Math.hypot(entity[E.POS_X] - x, entity[E.POS_Z] - z) / entity[E.WALK_STRIDE]) % 2;
		entity[E.MODEL_VARIANT] = entity[E.WALK] | 0;
	}
}

export function clearShot(x, z, targetX, targetZ) {
	return shotFraction(x, z, targetX, targetZ) === 1;
}

// The segment parameter is preserved through inverse rotation and scale.
// Gameplay colliders are independent world entities, not articulated render parts.
export function entityShotFraction(entity, origin, direction) {
	if (!entity[E.SCALE_X] || !entity[E.SCALE_Y] || !entity[E.SCALE_Z]) return 1;
	const rays = [origin.map((n, i) => n - entity[E.POS + i]), [...direction]];
	// Inverse yaw, pitch, and roll are the same two-coordinate rotation.
	for (const [a, b, axis] of [[0, 2, E.ROT_Y], [1, 2, E.ROT_X], [0, 1, E.ROT_Z]]) {
		const c = Math.cos(entity[axis]), s = Math.sin(entity[axis]);
		for (const v of rays) {
			const old = v[a];
			v[a] = old * c + v[b] * s;
			v[b] = v[b] * c - old * s;
		}
	}
	const [o, d] = rays.map(v => v.map((n, i) => n / entity[E.SCALE + i]));
	let near = 0, far = 1;
	for (let i = 0; i < 3; i++) {
		if (!d[i]) {
			if (Math.abs(o[i]) > .5) return 1;
		} else {
			const a = (-.5 - o[i]) / d[i], b = (.5 - o[i]) / d[i];
			near = Math.max(near, Math.min(a, b));
			far = Math.min(far, Math.max(a, b));
		}
	}
	if (entity[E.HIT_RADIUS] > 0) {
		o[1] -= entity[E.HIT_CENTER_Y];
		let a = 0, b = 0, c = -(entity[E.HIT_RADIUS] ** 2);
		for (let i = 0; i < 3; i++) {
			a += d[i] * d[i];
			b += d[i] * o[i];
			c += o[i] * o[i];
		}
		if (!a) { if (c > 0) return 1; }
		else {
			const discriminant = b * b - a * c;
			if (discriminant < 0) return 1;
			const root = Math.sqrt(discriminant);
			near = Math.max(near, (-b - root) / a);
			far = Math.min(far, (-b + root) / a);
		}
	}
	return near <= far ? near : 1;
}

export function shotFraction(x, z, targetX, targetZ, y = 1.25, targetY = y) {
	const origin = [x, y, z], direction = [targetX - x, targetY - y, targetZ - z];
	return EArray.reduce((nearest, entity) => entity[E.KIND] && (entity[E.SOLID] || entity[E.KIND] === 5)
		? Math.min(nearest, entityShotFraction(entity, origin, direction)) : nearest, 1);
}

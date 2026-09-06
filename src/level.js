import * as E from "./entities-const.js";
import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;
// Four printable bytes per bulkhead: x + 16, z + 16, width, depth.
// This is an eight-room station around a long, cross-shaped service corridor.
const plan = "0@1PO@1P@0P1@OP14=51<=51D=51L=514C51<C51DC51LC51861;@61;H61;8J1;@J1;HJ1;";

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
	for (let i = 0; i < plan.length;) {
		block(plan.charCodeAt(i++) - 64, plan.charCodeAt(i++) - 64, plan.charCodeAt(i++) - 48, 2.8, plan.charCodeAt(i++) - 48);
	}
	// Set dressing uses the same printable coordinate offset as the structural plan.
	for (const z of "6@F") block(-12, z.charCodeAt() - 64, 4, 1, .2)[E.KIND] = 14;
	for (let i = 0, crates = "=A8EH8LG"; i < crates.length;) {
		const crate = block(crates.charCodeAt(i++) - 64, crates.charCodeAt(i++) - 64, .75, .75, .75);
		crate[E.KIND] = 16; crate[E.HEALTH] = crate[E.MAX_HEALTH] = 4; crate[E.DISSOLVE_RATE] = .5;
	}
	for (let i = 0, pylons = "46<6DJLJ"; i < pylons.length;) block(pylons.charCodeAt(i++) - 64, pylons.charCodeAt(i++) - 64, 1.5, 2.8, 1.5);
	// Reactor shroud: a deep pillar behind the central portal, not a featureless divider.
	block(9, 0, 2.5, 2.8, 3.6);
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

import * as E from "./entities-const.js";
import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;
// Typed rectangles: 0 wall / 1 window / 8 floor + x,z,width,depth; other types carry x,z only.
// 9 creates the next section: start, hallway, cargo, elevator, boss (no fields).
// 10 portal facing -X, 11 unicorn; place these after their section scenery.
// 6 rail (+Z), 2 crate, 3 pylon, 4 reactor, 5 console, 7 light.
// Start (-12,-12) → dogleg hall (2,-2) → cargo (-6,15) → lift (-22,20) → boss (-30,6).
// Shared bulkheads seal the perimeter; every threshold has 3+ units of clearance.
const plan = [
	9,8,4,4,12,12,0,-2,4,1,12,0,4,-2,12,1,0,4,10,12,1,0,10,0,1,4,0,10,8,1,4,2,0,8,5,9.4,1,
	9,8,16,4,12,6,8,18,14,8,16,0,16,1,12,1,0,22,12,1,22,0,12,7,4,1,1,14,15,1,16,7,18,4,7,18,18,2,20,9,11,18,11,11,19,18,
	9,8,10,31,24,18,0,21,22,2,1,0,7,22,18,1,0,22,31,1,18,0,10,40,24,1,1,-2,28,1,12,0,-2,39,1,2,0,14,29,1,8,0,6,35,1,6,2,15,27,2,15,28,2,13,30,2,7,34,2,5,36,2,4,36,3,3,26,7,18,27,7,10,34,7,2,37,10,21,28,10,21,36,11,17,26,11,10,26,11,3,33,11,13,37,
	9,8,-6,36,8,8,0,-6,40,8,1,0,-10,36,1,8,5,-1.4,39,7,-6,36,
	9,8,-14,22,24,20,0,-17,32,18,1,0,-3,32,2,1,1,-26,22,1,20,1,-2,22,1,20,0,-14,12,24,1,3,-20,22,3,-8,22,4,-14,16,2,-21,16,2,-7,16,7,-20,27,7,-8,27,7,-14,15,10,-3,27,10,-3,17,11,-21,27,11,-9,27,11,-20,17,11,-8,17
];

// Section roots only translate vertically; child X/Z remain in map coordinates.
export const sections = [];

export function setupLevel(place) {
	sections.length = 0;
	let parent = 0, i = 0;
	const read = () => plan[i++];
	while (i < plan.length) {
		const type = read();
		if (type === 9) {
			const section = spawn(1);
			sections.push(section);
			parent = section.id;
			continue;
		}
		const x = read() - 16, z = read() - 16;
		if (type > 9) { place(type, x, z, parent); continue; }
		const sizes = [[0,2.8,0],[0,2.8,0],[.75,.75,.75],[1.5,2.8,1.5],[2.5,2.8,3.6],[5/8,1/2,3/16],[6,1,.2],[.1,.1,.1],[0,4/64,0]][type];
		if (type < 2 || type === 8) { sizes[0] = read(); sizes[2] = read(); }
		const entity = spawn(7);
		entity.set([x, ground + sizes[1] / 2, z], E.POS);
		entity.set(sizes, E.SCALE);
		entity.set(sizes.map(size => Math.max(1, Math.round(size / 2))), E.TILE);
		entity[E.SOLID] = 1;
		entity[E.KIND] = [7,145,16,7,7,15,14,6,5][type];
		if (type === 2) { entity[E.HEALTH] = entity[E.MAX_HEALTH] = 4; entity[E.DISSOLVE_RATE] = .5; }
		if (type === 5) { entity[E.POS_Z] -= .4; entity[E.POS_Y] = .6; }
		if (type === 5 || type === 6) entity[E.ROT_Y] = type === 6 || x > -10 ? Math.PI / 2 : -Math.PI / 2;
		if (type > 6) {
			entity[E.POS_Y] = type === 7 ? 2 : -.5;
			entity[E.SOLID] = 0;
		}
		if (type === 7) entity[E.SPOTLIGHT] = 3.5;
		if (type === 5 || type > 6) entity.fill(type === 5 || type === 8 ? -2 : 0, E.TILE, E.TILE + 3);
		entity[E.PARENT] = parent;
	}
}

export function canStand(x, z, radius = 0.45, avoid = 0) {
	return !EArray.some(
		(entity) => {
			const dx = x - entity[E.POS_X], dz = z - entity[E.POS_Z], c = Math.cos(entity[E.ROT_Y]), s = Math.sin(entity[E.ROT_Y]);
			// Unicorn movement/spawns reserve space around other living unicorns.
			return avoid && entity !== avoid && entity[E.KIND] === 2 && entity[E.HEALTH] > 0 && Math.hypot(dx, dz) < .8 || entity[E.KIND] && entity[E.SOLID] &&
				Math.abs(dx * c + dz * s) < Math.abs(entity[E.SCALE_X]) / 2 + radius &&
				Math.abs(dz * c - dx * s) < Math.abs(entity[E.SCALE_Z]) / 2 + radius;
		},
	);
}

export function moveActor(entity, dx, dz) {
	const x = entity[E.POS_X], z = entity[E.POS_Z];
	const avoid = entity[E.KIND] === 2 && entity;
	// Small steps prevent tunneling; separate axes let actors slide along walls.
	const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.2));
	for (let i = 0; i < steps; i++) {
		if (canStand(entity[E.POS_X] + dx / steps, entity[E.POS_Z], .45, avoid)) entity[E.POS_X] += dx / steps;
		if (canStand(entity[E.POS_X], entity[E.POS_Z] + dz / steps, .45, avoid)) entity[E.POS_Z] += dz / steps;
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
// Gameplay uses map-local colliders; visual section offsets do not affect hits.
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

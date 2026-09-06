import * as E from "./entities-const.js";
import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;
// Typed rectangles: 0 wall / 1 window / 8 floor + x,z,width,depth; other types carry x,z only.
// 9 creates the next section: start, hallway, cargo, elevator, boss (no fields).
// : portal facing -X, ; unicorn; place these after their section scenery.
// 6 rail (+Z), 2 crate, 3 pylon, 4 reactor, 5 console, 7 light.
// Start (-11,-11) → bent hall (-3,-9) → cargo (0,0) → lift (8,2) → boss (9,10).
// Shared bulkheads seal the perimeter; every threshold has 3+ units of clearance.
const plan = "985588015180518105981092120981223724775598<5648=9440<3610?7180:7211;9147=9;=:98@@::1;@1:0B;610?E810E=140ED122=?2>?2BB2CB2BC3A>7@B:D=;=B;C=;B@98HB660H?610KB165JA7HB98IJ<:0EE411CJ1:0IO<10OJ1:0ME413FI3LI4IM7IG7IL:NG:NL;FG;LG;FL;LL";

// Section roots only translate vertically; child X/Z remain in map coordinates.
export const sections = [];
function block(x, z, width, height, depth, bottom = ground) {
	// Level construction runs immediately after the entity pool is reset.
	const entity = spawn(7);
	entity.set([x, bottom + height / 2, z], E.POS);
	entity.set([width, height, depth], E.SCALE);
	// Whole panels meet both ends of every block; approximately two world units each.
	entity.set(
		[width, height, depth].map((size) => Math.max(1, Math.round(size / 2))),
		E.TILE,
	);
	entity[E.SOLID] = 1;
	return entity;
}

export function setupLevel(place) {
	sections.length = 0;
	let parent = 0, i = 0;
	const read = () => plan.charCodeAt(i++) - 48;
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
		const sizes = [[0,2.8,0],[0,2.8,0],[.75,.75,.75],[1.5,2.8,1.5],[2.5,2.8,3.6],[1,1,1],[6,1,.2],[.1,.1,.1],[0,4/64,0]][type];
		if (type < 2 || type === 8) { sizes[0] = read(); sizes[2] = read(); }
		const entity = block(x, z, ...sizes);
		entity[E.KIND] = [7,145,16,7,7,15,14,6,5][type];
		if (type === 2) { entity[E.HEALTH] = entity[E.MAX_HEALTH] = 4; entity[E.DISSOLVE_RATE] = .5; }
		if (type === 5) { entity[E.POS_X] += .25; entity[E.POS_Z] -= .4; entity[E.POS_Y] = .6; }
		if (type === 5 || type === 6) entity[E.ROT_Y] = Math.PI / 2;
		if (type > 6) {
			entity[E.POS_Y] = type === 7 ? 2 : -.5;
			entity[E.SOLID] = 0;
		}
		if (type === 7) entity[E.SPOTLIGHT] = 3.5;
		if (type === 5 || type > 6) entity.fill(type === 8 ? -2 : 0, E.TILE, E.TILE + 3);
		entity[E.PARENT] = parent;
	}
}

export function canStand(x, z, radius = 0.45) {
	return !EArray.some(
		(entity) => {
			const dx = x - entity[E.POS_X], dz = z - entity[E.POS_Z], c = Math.cos(entity[E.ROT_Y]), s = Math.sin(entity[E.ROT_Y]);
			return entity[E.KIND] && entity[E.SOLID] &&
				Math.abs(dx * c + dz * s) < Math.abs(entity[E.SCALE_X]) / 2 + radius &&
				Math.abs(dz * c - dx * s) < Math.abs(entity[E.SCALE_Z]) / 2 + radius;
		},
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

import * as E from "./entities-const.js";
import { spawn, EArray } from "./entities.js";

const ground = -30 / 64;
// Typed rectangles: 0 wall / 1 window / 8 floor + x,z,width,depth; other types carry x,z only.
// 9 creates the next section: start, hallway, cargo, elevator, boss (no fields).
// 10 portal facing -X, 16 portal facing +X, 11 unicorn; place these after their section scenery.
// 6 rail (+Z), 2 crate (+ contents: 0 empty, 1 medkit, 2 shotgun), 3 pylon, 4 reactor, 5 console, 7 light.
// 12 door + x,z,width,depth: positioned root with a kind-19 panel at local zero.
// 13 shaft wall + x,z,width,depth,height,bottom (relative to ground); 14 rail + x,z,width,depth.
// 15 uses shaft-wall fields for the inclined elevator guide track.
// Start (-12,-12) → dogleg hall (2,-2) → cargo (-6,15) → lift (-17.5,20) → boss (-45.5,6).
// Shared bulkheads seal the perimeter; every threshold has 3+ units of clearance.
const plan = [
	9,8,4,4,12,8,0,-2,4,1,8,0,4,0,12,1,0,4,8,12,1,0,10,1,1,2,0,10,7,1,2,7,4,4,
	9,12,10,4,1,4,5,9.4,1.8,8,16,4,12,6,8,18,14,8,16,0,16,1,12,1,0,22,12,1,22,0,12,7,4,1,1,14,15,1,16,7,18,4,7,18,18,2,20,9,0,2,11,2.5,0,2,13,2,0,2,20,6,0,2,20,16,0,2,20,17,1,11,18,11,11,19,18,
	9,12,18,22,4,1,5,21.4,21,8,11.75,32.75,20.5,21.5,0,21,22,2,1,0,8.75,22,14.5,1,0,22,32.75,1,21.5,0,11.75,43.5,20.5,1,1,2,28,1,12,0,2,40.75,1,5.5,0,14,29,1,8,0,6,35,1,6,1,19,32,6,1,2,15,27,0,2,15,28,0,2,13,30,0,2,7,34,0,2,5,36,0,2,4,38,1,2,17,40,0,2,18,40,2,2,10,40,1,3,3,26,7,18,27,7,10,34,7,2,37,12,2,36,1,4,5,4.5,43.3,13,-13.75,43.5,30.5,1,82.8,-80,13,-20,36,1,15,100,-95,13,-26.25,28.5,5.5,1,82.8,-80,13,-9,28.5,21,1,82.8,-80,13,-21.5,28.5,4,1,40,-80,13,-21.5,28.5,4,1,40,-37.2,15,-8,36,0.5,0.5,44.72,-42.76,10,21,28,10,21,36,11,17,26,11,10,26,11,3,33,11,13,37,
	9,8,-1.5,36,6,6,14,-4.5,36,0.2,6,14,-1.5,39,6,0.2,14,1.5,33.5,0.2,1,14,1.5,38.5,0.2,1,14,-4,33,1,0.2,14,1,33,1,0.2,5,1,39,7,-1.5,36,
	9,12,-21.5,28.5,4,1,5,-19.7,31,8,-21.5,30.75,4,4.5,0,-23.5,30.75,0.2,4.5,0,-19.5,30.75,0.2,4.5,8,-29.5,20.25,24,16.5,0,-32.5,28.5,18,1,0,-18.5,28.5,2,1,1,-41.5,20.25,1,16.5,1,-17.5,20.25,1,16.5,0,-29.5,12,24,1,3,-35.5,22,3,-23.5,22,4,-29.5,16,2,-36.5,16,0,2,-22.5,16,0,2,-34.5,16,0,2,-24.5,16,0,2,-29.5,25,1,7,-35.5,27,7,-23.5,27,7,-29.5,15,10,-18.5,27,10,-18.5,17,16,-40.5,20.25,11,-36.5,27,11,-24.5,27,11,-35.5,17,11,-23.5,17
];

// Section roots translate; authored child coordinates stay in the map frame.
export const sections = [];

export function setupLevel(place) {
	sections.length = 0;
	let parent = 0, i = 0;
	const read = () => plan[i++];
	while (i < plan.length) {
		let type = read();
		const track = type === 15, shaft = type === 13 || track, rail = type === 14;
		const door = type === 12;
		if (type >= 12 && type < 16) type = 0;
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
		if (shaft) sizes[1] = read();
		if (rail) sizes[1] = 1;
		const y = ground + sizes[1] / 2 + (shaft ? read() : 0);
		// Allocate the anchor first so a following console targets the panel.
		const root = door && spawn(1);
		const entity = spawn(door || track ? 19 : rail ? 14 : [7,253,16,7,7,15,14,6,5][type]);
		entity.set([x, y, z], E.POS);
		// Window panes pass through local X; turn wide dividers to face across Z.
		if (type === 1 && sizes[0] > sizes[2]) { sizes.reverse(); entity[E.ROT_Y] = Math.PI / 2; }
		entity.set(sizes, E.SCALE);
		entity.set(sizes.map(size => Math.max(1, Math.round(size / 2))), E.TILE);
		entity[E.SOLID] = !shaft && type < 7;
		if (type === 2) { entity[E.CONTENTS] = read(); entity[E.HEALTH] = entity[E.MAX_HEALTH] = 4; entity[E.DISSOLVE_RATE] = .5; }
		if (type === 5) { entity[E.POS_Z] -= .4; entity[E.POS_Y] = .6; entity[E.CONTROLLER] = sections.length === 4 ? sections[0].id : entity.id - 1; }
		if (type === 5 || type === 6) entity[E.ROT_Y] = type === 6 || z < 23 ? Math.PI / 2 : Math.PI;
		if (type > 6) {
			entity[E.POS_Y] = type === 7 ? 2 : -.5;
		}
		if (type === 7) entity[E.SPOTLIGHT] = 3.5;
		if (type === 5 || type > 6 || rail || door || track) entity.fill(type === 7 ? 0 : -2, E.TILE, E.TILE + 3);
		entity[E.PARENT] = parent;
		entity[E.ROT_Z] = (shaft && sizes[0] < 2) * -.464;
		if (rail) {
			if (sizes[2] > sizes[0]) {
				entity[E.SCALE_X] = sizes[2]; entity[E.SCALE_Z] = sizes[0];
				entity[E.ROT_Y] = Math.PI / 2;
			}
		}
		if (door) {
			root.set(entity.subarray(E.POS, E.POS + 3), E.POS);
			root[E.PARENT] = parent;
			entity[E.PARENT] = root.id;
			entity.fill(0, E.POS, E.POS + 3);
		}
	}
	sections[4][E.POS_Y] = -40;
	for (const i of [1, 2, 4]) sections[i][E.PARENT] = sections[0].id;

}

// Horizontal section travel moves colliders; section height stays visual.
const collisionPosition = (entity, axis) => {
	let value = entity[E.POS + axis];
	while (entity[E.PARENT] && (axis !== 1 || entity[E.KIND] === 19)) {
		entity = EArray[entity[E.PARENT]];
		value += entity[E.POS + axis];
	}
	return value;
};

export function canStand(x, z, radius = 0.45, avoid = 0) {
	return !EArray.some(
		(entity) => {
			const dx = x - collisionPosition(entity, 0), dz = z - collisionPosition(entity, 2), c = Math.cos(entity[E.ROT_Y]), s = Math.sin(entity[E.ROT_Y]);
			// Unicorn movement/spawns reserve space around other living unicorns.
			return avoid && entity !== avoid && entity[E.KIND] === 2 && entity[E.HEALTH] > 0 && Math.hypot(dx, dz) < .8 || entity[E.KIND] && entity[E.SOLID] &&
				(entity[E.KIND] !== 19 || collisionPosition(entity, 1) - Math.abs(entity[E.SCALE_Y]) / 2 < 1.25) &&
				Math.abs(dx * c + dz * s) < Math.abs(entity[E.SCALE_X]) / 2 + radius &&
				Math.abs(dz * c - dx * s) < Math.abs(entity[E.SCALE_Z]) / 2 + radius;
		},
	);
}

export function moveActor(entity, dx, dz) {
	const x = entity[E.POS_X], z = entity[E.POS_Z];
	const avoid = entity[E.KIND] === 2 && entity;
	// Invisible marine-only boundaries close both entrances during transit and
	// extend down to the lower landing's opening.
	const lowerPlatform = sections[0][E.POS_Y] === 40 && z >= 17;
	if (entity[E.KIND] === 1 && (sections[0][E.POS_Y] % 40 || lowerPlatform)) {
		dx = Math.max(-20, Math.min(-15, x + dx)) - x;
		dz = Math.max(lowerPlatform ? 11 : 17.5, Math.min(22.5, z + dz)) - z;
	}
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
// Horizontal parent translation follows rendering; section height remains visual.
export function entityShotFraction(entity, origin, direction) {
	if (!entity[E.SCALE_X] || !entity[E.SCALE_Y] || !entity[E.SCALE_Z]) return 1;
	const rays = [origin.map((n, i) => n - collisionPosition(entity, i)), [...direction]];
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

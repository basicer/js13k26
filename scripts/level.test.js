import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function level() {
	const blocks = [];
	const context = vm.createContext({ E, EArray: blocks,
		spawn: kind => {
			const entity = new Float32Array(E.STRIDE);
			entity.id = blocks.length;
			entity[0] = kind;
			entity[12] = entity[13] = entity[14] = 1;
			blocks.push(entity);
			return entity;
		},
	});
	// Test-only collider fixture, independent of the packed level constructor.
	context.block = (x, z, width, height, depth, bottom = -30 / 64) => {
		const entity = context.spawn(7);
		entity.set([x, bottom + height / 2, z], E.POS);
		entity.set([width, height, depth], E.SCALE);
		entity[E.SOLID] = 1;
		return entity;
	};
	vm.runInContext(readFileSync(new URL("../src/level.js", import.meta.url), "utf8")
		.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	const placements = [];
	context.setupLevel((type,x,z,parent) => placements.push({type,x,z,parent}));
	// These route tests exercise the architecture with its doors opened.
	for (const entity of blocks) if (entity[E.KIND] === 19 && entity[E.SOLID]) entity[E.POS_Y] = 3;
	return { ...context, blocks, placements, sections: vm.runInContext("sections", context) };
}

const route = [[-11,-11],[-10,-12],[2,-12],[2,8],[-6,8],[-6,14],[-12.5,14],[-13,20],[-17.5,20]];

test("smaller starting room is crate-free, with loot spread through combat rooms", () => {
	const { blocks, sections, canStand } = level();
	assert.deepEqual(Array.from(sections, section => blocks.filter(e => e[E.KIND] === 16 && e[E.PARENT] === section.id).length), [0, 6, 9, 0, 5]);
	assert.deepEqual(Array.from(sections, section => blocks.filter(e => e[E.KIND] === 16 && e[E.PARENT] === section.id && e[E.CONTENTS] === 1).length), [0, 1, 2, 0, 1]);
	const shotguns = blocks.filter(e => e[E.KIND] === 16 && e[E.CONTENTS] === 2);
	assert.equal(shotguns.length, 1);
	assert.equal(shotguns[0][E.PARENT], sections[2].id);
	assert.equal(shotguns[0][E.POS_X], 2);
	assert.equal(shotguns[0][E.POS_Z], 24, "shotgun is tucked into the rear crate cluster");
	assert.ok(canStand(-11, -13.5), "new marine spawn stays clear");
	const floor = blocks.find(e => e[E.KIND] === 5 && e[E.PARENT] === sections[0].id);
	assert.equal(floor[E.SCALE_X], 12);
	assert.equal(floor[E.SCALE_Z], 8);
	assert.ok(canStand(-11, -11), "starting position stays clear");
	assert.ok(canStand(-16.9, -11, 0), "opening camera stays inside the room");
	assert.equal(canStand(-11, -16), false, "inset back wall seals the room");
	assert.equal(canStand(-11, -8), false, "inset front wall seals the room");
});

test("camera-side window walls preserve the room barriers and section parents", () => {
	const { blocks, sections, canStand } = level();
	const windows = blocks.filter(e => e[E.KIND] === 253);
	assert.equal(windows.length,5);
	for (const [x,z,section] of [[-2,-1,1],[-14,12,2],[-57.5,4.25,4],[-33.5,4.25,4]]) {
		const wall = windows.find(e => e[E.POS_X] === x && e[E.POS_Z] === z);
		assert.equal(wall[E.PARENT],sections[section].id);
		assert.equal(wall[E.SOLID],1);
		assert.equal(canStand(x,z),false);
	}
});

test("map-plane colliders preserve route clearance in both directions", () => {
	const { moveActor, canStand, blocks } = level();
	for (const points of [route, [...route].reverse()]) {
		const actor = new Float32Array(E.STRIDE);
		actor[E.POS_X] = points[0][0]; actor[E.POS_Z] = points[0][1];
		for (const [x,z] of points.slice(1)) {
			moveActor(actor, x-actor[E.POS_X], z-actor[E.POS_Z]);
			assert.ok(Math.hypot(actor[E.POS_X]-x, actor[E.POS_Z]-z) < .01, "blocked route at " + [x,z]);
		}
	}
	for (const [x,z] of route) assert.ok(canStand(x,z,.65), "room for actors at " + [x,z]);
	for (const wall of blocks.filter(e => e[E.KIND] === 7 && e[E.SOLID])) {
		assert.ok(Math.abs(wall[E.SCALE_Y] - 2.8) < 1e-6);
		for (const repeat of wall.subarray(E.TILE,E.TILE+3)) assert.ok(Number.isInteger(repeat) && repeat >= 1);
	}
});

test("floor connectivity reaches Cargo through its thresholds and stops at the open shaft", () => {
	const { canStand, blocks } = level();
	const floors = blocks.filter(e => e[E.KIND] === 5);
	// Flood at half-unit spacing with the same collision radius as gameplay.
	const flood = (sealed = () => false) => {
		const visited = new Set(), queue = [[-22,-22]];
		for (let i=0; i<queue.length; i++) {
			const [x,z] = queue[i], key = x+","+z;
			if (visited.has(key) || sealed(x/2,z/2) || !canStand(x/2,z/2)) continue;
			// The shaft now has deliberate floor gaps; a map-plane collider alone is not footing.
			if (!floors.some(e => Math.abs(x/2-e[E.POS_X]) <= e[E.SCALE_X]/2 && Math.abs(z/2-e[E.POS_Z]) <= e[E.SCALE_Z]/2)) continue;
			assert.ok(Math.abs(x)<128 && Math.abs(z)<128, "route leaks outside the floor at " + key);
			assert.ok(floors.some(e => Math.abs(x/2-e[E.POS_X]) <= e[E.SCALE_X]/2 && Math.abs(z/2-e[E.POS_Z]) <= e[E.SCALE_Z]/2), "missing floor at " + key);
			visited.add(key);
			queue.push([x+1,z],[x-1,z],[x,z+1],[x,z-1]);
		}
		return visited;
	};
	const connected = flood();
	for (const [x,z] of route.slice(0,8)) assert.ok(connected.has(x*2+","+z*2));
	assert.equal(connected.has("-35,40"), true, "the platform docks directly at Cargo");
	assert.equal(connected.has("-44,30"), false, "the lower hallway is across the shaft before travel");
	for (const seal of [
		(x,z) => x === -6 && z >= -14 && z <= -10,
		(x,z) => z === 6 && x >= 0 && x <= 4,
	]) assert.ok(!flood(seal).has("-26,40"), "a threshold can be bypassed");
});

test("packed floor sections stop downward shots without covering exterior space", () => {
	const { blocks, shotFraction } = level();
	const floors = blocks.filter(e => e[E.KIND] === 5);
	assert.equal(floors.length, 7);
	for (const floor of floors) {
		assert.equal(floor[E.SOLID], 0);
		assert.equal(floor[E.POS_Y] + floor[E.SCALE_Y]/2, -30/64);
	}
	assert.ok(shotFraction(-11,-11,-11,-11,1,-1) < 1);
	assert.equal(shotFraction(-11,0,-11,0,1,-1), 1, "empty space has no floor");
});

test("bulkheads break long sightlines and gate spawn points are clear", () => {
	const { clearShot, canStand, placements } = level();
	assert.ok(!clearShot(-11,-11,-20,-11));
	assert.ok(!clearShot(-11,-11,-6,15), "the bent hall conceals cargo");
	assert.ok(!clearShot(-6,14,-30,3), "the lift conceals the boss arena");
	assert.ok(clearShot(2,-12,2,4));
	for (const {x,z} of placements.filter(e => e.type === 10)) assert.ok(canStand(x-1,z), "blocked gate at " + [x,z]);
});

test("cargo divider blocks distant crate shots while the first console and doorway stay clear", () => {
	const { blocks, sections, clearShot, canStand } = level();
	const divider = blocks.find(e => e[E.PARENT] === sections[2].id && e[E.KIND] === 253 && e[E.POS_X] === 3 && e[E.POS_Z] === 16);
	assert.ok(divider);
	assert.equal(divider[E.SCALE_X], 1);
	assert.equal(divider[E.SCALE_Z], 6);
	assert.ok(Math.abs(divider[E.ROT_Y] - Math.PI / 2) < 1e-6, "pane faces across the corridor");
	assert.equal(clearShot(1, 10, 1, 23), false);
	divider[E.SOLID] = 0;
	assert.equal(clearShot(1, 10, 1, 23), true, "the new divider interrupts this crate approach sightline");
	const console = blocks.find(e => e[E.KIND] === 15 && e[E.PARENT] === sections[1].id);
	assert.ok(Math.abs(console[E.POS_Z] + 14.6) < 1e-5);
	assert.ok(console[E.POS_Z] - console[E.SCALE_X] / 2 > -15.5, "console clears the starting-room wall");
	const crate = blocks.find(e => e[E.KIND] === 16 && e[E.POS_X] === -5 && e[E.POS_Z] === -13.5);
	assert.ok(crate && Math.hypot(crate[E.POS_X] - console[E.POS_X], crate[E.POS_Z] - console[E.POS_Z]) < 2);
	assert.ok(canStand(-6, -12, .65), "nearby crate leaves the door lane open");
});

test("section height is visual and leaves hit tests and movement unchanged", () => {
	const { sections, blocks, canStand, shotFraction, spawn, moveActor } = level();
	assert.equal(sections.length,5);
	assert.ok(blocks.filter(e => e[E.KIND] !== 1).every(e => sections.some(s => s.id ===
		(e[E.KIND] === 19 ? blocks[e[E.PARENT]][E.PARENT] : e[E.PARENT]))));
	const hit = shotFraction(-13,12,-16,12,.5);
	assert.ok(hit < 1);
	const actor = spawn(1);
	actor[E.POS_X] = -22; actor[E.POS_Z] = 20;
	actor[E.PARENT] = sections[2].id;
	sections[2][E.POS_Y] = sections[4][E.POS_Y] = 8;
	assert.equal(canStand(-14.5,12),false,"raised walls keep the original map collider");
	assert.equal(shotFraction(-13,12,-16,12,.5),hit);
	assert.equal(shotFraction(-13,12,-16,12,8.5),1,"visual height is not added to the hit test");
	moveActor(actor,8,0);
	assert.equal(actor[E.PARENT],sections[2].id,"movement keeps the originally assigned section");
	assert.equal(actor[E.POS_Y],0);
	moveActor(actor,-8,0);
	assert.equal(actor[E.PARENT],sections[2].id,"visual height does not block a threshold");
	assert.equal(actor[E.POS_Y],0);
});

test("collision follows live entity movement, resizing, solidity and deletion", () => {
	const { block, blocks, canStand, clearShot } = level();
	blocks.forEach(entity => entity[E.KIND] = 0);
	block(0, -10, 2, 2, 2);
	const box = blocks.at(-1);
	assert.equal(canStand(0, -10), false);
	assert.equal(clearShot(-2, -10, 2, -10), false);
	box[4] = 4;
	assert.equal(canStand(0, -10), true);
	assert.equal(clearShot(-2, -10, 2, -10), true);
	box[12] = 8;
	assert.equal(canStand(0, -10), false);
	box[28] = 0;
	assert.equal(canStand(0, -10), true);
	box[28] = 1;
	box[0] = 0;
	assert.equal(canStand(0, -10), true);
	assert.equal(clearShot(-2, -10, 2, -10), true);
});

test("shots use the entity's actual bottom, and removed walls no longer constrain movement", () => {
	const { block, blocks, canStand, shotFraction } = level();
	blocks.forEach(entity => entity[E.KIND] = 0);
	block(0, -10, 2, 1, 2, 2);
	assert.equal(shotFraction(-2, -10, 2, -10, 1, 1), 1);
	assert.equal(shotFraction(-2, -10, 2, -10, 2.5, 2.5), .25);
	blocks.forEach(entity => entity[0] = 0);
	assert.equal(canStand(15.5, 0), true);
	assert.equal(canStand(100, 0), true);
});

test("shot intervals must overlap inside both the box and the sphere", () => {
	const { entityShotFraction, spawn } = level();
	const entity = spawn(2);
	const hit = (origin, direction) => entityShotFraction(entity, origin, direction);
	assert.equal(hit([0, -2, 0], [0, 4, 0]), .375, "radius zero is box-only");
	entity[E.HIT_RADIUS] = .25;
	entity[E.HIT_CENTER_Y] = .625;
	assert.equal(hit([0, -2, 0], [0, 4, 0]), .59375, "sphere entry after box entry is a valid hit");
	entity[E.HIT_CENTER_Y] = 1;
	assert.equal(hit([0, -2, 0], [0, 4, 0]), 1, "separate box and sphere hits are not a shared hit");
	entity[E.HIT_CENTER_Y] = 0;
	entity[E.HIT_RADIUS] = 1;
	assert.equal(hit([0, -2, 0], [0, 4, 0]), .375, "box clips an oversized sphere");
	entity[E.HIT_RADIUS] = .25;
	assert.equal(hit([.4, 0, -2], [0, 0, 4]), 1, "empty box corners miss the sphere");
	assert.equal(hit([0, 0, 0], [0, 0, 0]), 0, "stationary segment inside both");
	assert.equal(hit([.4, 0, 0], [0, 0, 0]), 1, "stationary segment outside the sphere");
	assert.equal(hit([0, 0, 2], [0, 0, 1]), 1, "intersection behind the ray is ignored");
	assert.equal(hit([0, 0, 2], [0, 0, -.5]), 1, "intersection beyond the segment is ignored");
	entity[E.HIT_RADIUS] = .5;
	assert.equal(hit([.5, 0, -1], [0, 0, 2]), .5, "tangent on the box boundary");
});

test("shot shapes follow pitch, yaw, roll, translation, and nonuniform scale", () => {
	const { entityShotFraction, spawn } = level();
	for (const [scale, rotation, origin, direction] of [
		[[4,1,1], [0,Math.PI/2,0], [0,0,-3], [0,0,6]],
		[[1,4,1], [Math.PI/2,0,0], [0,0,-3], [0,0,6]],
		[[4,1,1], [0,0,Math.PI/2], [0,-3,0], [0,6,0]],
	]) {
		const e = spawn(7);
		e.set(scale, E.SCALE); e.set(rotation, E.ROT);
		e.set([4,5,6], E.POS);
		assert.ok(Math.abs(entityShotFraction(e, origin.map((n,i) => n + e[E.POS+i]), direction) - 1/6) < 1e-6);
	}
	const e = spawn(2);
	e[E.HIT_RADIUS] = .25;
	e.set([4,2,1], E.SCALE);
	assert.equal(entityShotFraction(e, [-2,0,0], [4,0,0]), .25, "sphere scales into an ellipsoid");
	assert.equal(entityShotFraction(e, [0,.6,-1], [0,0,2]), 1);
	e[E.HIT_CENTER_Y] = .25;
	e[E.SCALE_Y] = -2;
	assert.equal(entityShotFraction(e, [0,-.5,-1], [0,0,2]), .375, "negative scale mirrors the center offset");
	e[E.SCALE_X] = 0;
	assert.equal(entityShotFraction(e, [0,-.5,-1], [0,0,2]), 1, "degenerate scale does not produce NaN");
});


test("walk stride animates arbitrary entities from actual movement, including blocked movement", () => {
	const { spawn, moveActor, blocks } = level();
	blocks.length = 0;
	const actor = spawn(15);
	actor[E.WALK_STRIDE] = .5;
	moveActor(actor, .75, 0);
	assert.ok(Math.abs(actor[E.WALK] - 1.5) < 1e-6);
	assert.equal(actor[E.MODEL_VARIANT], 1);
	const wall = spawn(7);
	wall[E.SOLID] = 1;
	wall[E.POS_X] = 1.8;
	const phase = actor[E.WALK];
	moveActor(actor, .5, 0);
	assert.equal(actor[E.WALK], phase, "blocked displacement contributes no walk phase");
	actor[E.WALK_STRIDE] = 0;
	moveActor(actor, 0, 1);
	assert.equal(actor[E.WALK], phase, "zero stride disables animation");
});

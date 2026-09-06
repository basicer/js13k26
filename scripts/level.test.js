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
			entity[0] = kind;
			entity[12] = entity[13] = entity[14] = 1;
			blocks.push(entity);
			return entity;
		},
	});
	vm.runInContext(readFileSync(new URL("../src/level.js", import.meta.url), "utf8")
		.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	context.setupLevel();
	return { ...context, blocks };
}

test("compact plan expands into an enclosed station with a cross-corridor", () => {
	const { blocks, canStand } = level();
	assert.equal(blocks.length, 30);
	const walls = blocks.filter(e => e[E.KIND] === 7);
	assert.equal(walls.length, 23);
	for (const wall of walls) {
		assert.ok(Math.abs(wall[E.SCALE_Y] - 2.8) < 1e-6);
		for (const repeat of wall.subarray(E.TILE, E.TILE + 3)) assert.ok(Number.isInteger(repeat) && repeat >= 1);
	}
	for (const [x, z] of [[-2, 0], [-8, -2], [0, 2], [14, 0]]) assert.ok(canStand(x, z));
	for (const [x, z] of [[15, 0], [0, 15], [8, 0], [-8, -10]]) assert.ok(!canStand(x, z));
	assert.equal(blocks.filter(e => e[E.KIND] === 16).length, 4);
	assert.equal(blocks.filter(e => e[E.KIND] === 14).length, 3);
});

test("rooms stay separated but corridor doors are traversable", () => {
	const { moveActor } = level();
	const actor = new Float32Array(E.STRIDE);
	actor[E.POS_X] = -9;
	actor[E.POS_Z] = -1;
	moveActor(actor, 0, -12);
	assert.ok(actor[E.POS_Z] < -5, "the service door opens into the lower rooms");
	moveActor(actor, -100, 0);
	assert.ok(actor[E.POS_X] > -15.6, "the exterior bulkhead still contains actors");
});

test("walls stop shots while the central corridor remains clear", () => {
	const { clearShot } = level();
	assert.ok(!clearShot(-2, 0, 12, 0), "the reactor bulkhead divides the spine");
	assert.ok(!clearShot(-12, -10, -4, -10), "room dividers block side-to-side fire");
	assert.ok(clearShot(-6, 0, 6, 0), "the long corridor has an open sightline");
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
	block(0, -10, 2, 1, 2, 0, 2);
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

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

test("arena leaves starting positions clear and excludes obstacles and outside spawns", () => {
	const { canStand, blocks } = level();
	assert.equal(blocks.length, 27);
	for (const [x, z] of [[-2, 0], [3, -2], [11, 4], [6, 10], [-11, 4], [-11, -7], [1, -11]]) {
		assert.ok(canStand(x, z), `Starting position ${x}, ${z}`);
	}
	for (const [x, z] of [[5, 5], [-6, -5], [16, 0], [0, -16]]) assert.ok(!canStand(x, z));
});

test("switch panel mounts flush on the bulkhead with no pedestal", () => {
	const { blocks, canStand } = level();
	const panel = blocks.find(e => e[E.KIND] === 15);
	const wall = blocks.find(e => e[E.KIND] === 7 && e[E.POS_X] === -6 && e[E.POS_Z] === -5);
	assert.equal(panel[E.POS_Z] - panel[E.SCALE_Z] / 2, wall[E.POS_Z] + wall[E.SCALE_Z] / 2);
	assert.equal(panel[E.ROT_Y], 0);
	assert.deepEqual(Array.from(panel.slice(E.SCALE, E.SCALE + 3)), [1.25, 1, .25]);
	assert.deepEqual(Array.from(panel.slice(E.TILE, E.TILE + 3)), [0, 0, 0]);
	assert.equal(panel[E.MODEL_VARIANT], 0);
	assert.equal(canStand(-4, -2), true, "old pedestal no longer blocks the lane");
});

test("bulkheads use the wall palette with whole panels on each axis", () => {
	const { blocks } = level();
	const walls = blocks.filter(entity => entity[0] === 7 && entity[19] === 0);
	assert.equal(walls.length, 13);
	for (const entity of walls) {
		assert.equal(entity[0], 7);
		for (const repeat of entity.subarray(16, 19)) {
			assert.ok(Number.isInteger(repeat) && repeat >= 1);
		}
	}
	assert.deepEqual(Array.from(blocks[0].subarray(16, 19)), [1, 1, 16]);
	assert.deepEqual(Array.from(blocks[1].subarray(16, 19)), [15, 1, 1]);
});

test("original cargo remains intact and four small crates are separate solid geometry", () => {
	const { blocks, canStand, clearShot } = level();
	const crates = blocks.filter(e => e[E.KIND] === 16);
	assert.equal(crates.length, 4);
	for (const [x, z] of [[5, 5], [-10, 9]]) {
		const base = blocks.find(e => e[E.KIND] === 7 && e[E.POS_X] === x && e[E.POS_Z] === z && e[E.MAT_OVERRIDE] === 0);
		const cap = blocks.find(e => e[E.KIND] === 7 && e[E.POS_X] === x && e[E.POS_Z] === z && e[E.MAT_OVERRIDE] === 101);
		const top = blocks.find(e => e[E.KIND] === 7 && Math.abs(e[E.POS_X] - x - .3) < 1e-6 && Math.abs(e[E.POS_Z] - z - .2) < 1e-6);
		assert.ok(base && cap && top);
		assert.ok(Math.abs(base[E.SCALE_X] - 2.5) < 1e-6 && Math.abs(base[E.SCALE_Y] - 1.8) < 1e-6);
		assert.ok(Math.abs(cap[E.SCALE_X] - 2.6) < 1e-6 && Math.abs(cap[E.SCALE_Y] - .12) < 1e-6);
		assert.ok(Math.abs(top[E.POS_Y] - (-30 / 64 + 1.92 + .5)) < 1e-6);
	}
	for (const crate of crates) {
		for (const size of crate.slice(E.SCALE, E.SCALE + 3)) assert.ok(Math.abs(size - .75) < 1e-6);
		assert.ok(Math.abs(crate[E.POS_Y] - crate[E.SCALE_Y] / 2 + 30 / 64) < 1e-6);
		assert.equal(canStand(crate[E.POS_X], crate[E.POS_Z]), false);
		assert.equal(clearShot(crate[E.POS_X] - 1, crate[E.POS_Z], crate[E.POS_X] + 1, crate[E.POS_Z]), true, "low crates do not obstruct chest-height shots");
		assert.equal(crate[E.SOLID], 1);
		assert.equal(crate[E.MAT_OVERRIDE], 0);
		assert.deepEqual(Array.from(crate.slice(E.TILE, E.TILE + 3)), [1, 1, 1]);
	}
});

test("movement cannot tunnel through cover or perimeter and can slide along a wall", () => {
	const { moveActor, canStand } = level();
	const actor = new Float32Array(E.STRIDE);
	actor[4] = -6;
	actor[6] = -7;
	moveActor(actor, 0, 6);
	assert.ok(actor[6] < -5.9);
	assert.ok(canStand(actor[4], actor[6]));
	moveActor(actor, 1, 1);
	assert.ok(actor[4] > -5.1);
	assert.ok(actor[6] < -5.9);
	moveActor(actor, -100, 0);
	assert.ok(actor[4] >= -14.55);
});

test("freestanding railings leave the original yellow wall caps intact", () => {
 const { blocks, canStand } = level();
 const rails = blocks.filter(e => e[0] === 14);
 assert.equal(rails.length, 3);
 for (const rail of rails) {
  assert.equal(rail[19], 0);
  assert.ok(Math.abs(rail[5] - rail[13] / 2 + 30 / 64) < .00001);
  assert.equal(rail[17], 1);
  assert.equal(rail[16], 2);
  assert.ok(!canStand(rail[4], rail[6]));
 }
 const caps = blocks.filter(e => e[19] === 248);
 assert.equal(caps.length, 4);
 assert.ok(caps.every(e => e[0] === 7 && Math.abs(e[13] - .12) < .00001));
});

test("shots stop at cover in either direction, while open lanes remain clear", () => {
	const { clearShot } = level();
	assert.ok(!clearShot(-6, -7, -6, -3));
	assert.ok(!clearShot(-6, -3, -6, -7));
	assert.ok(!clearShot(3, 5, 7, 5));
	assert.ok(!clearShot(3, 3, 7, 7));
	assert.ok(clearShot(-2, 0, 4, -1));
	assert.ok(clearShot(-2, -7, -2, 5));
});

test("collision follows live entity movement, resizing, solidity and deletion", () => {
	const { block, blocks, canStand, clearShot } = level();
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

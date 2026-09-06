import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function level() {
	const blocks = [];
	const context = vm.createContext({ EArray: blocks,
		spawn: kind => {
			const entity = new Float32Array(32);
			entity[0] = kind;
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
	assert.equal(blocks.length, 22);
	for (const [x, z] of [[-2, 0], [3, -2], [11, 4], [6, 10], [-11, 4], [-11, -7], [1, -11]]) {
		assert.ok(canStand(x, z), `Starting position ${x}, ${z}`);
	}
	for (const [x, z] of [[5, 5], [-6, -5], [16, 0], [0, -16]]) assert.ok(!canStand(x, z));
});

test("bulkheads and cargo use the wall palette with whole panels on each axis", () => {
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

test("movement cannot tunnel through cover or perimeter and can slide along a wall", () => {
	const { moveActor, canStand } = level();
	const actor = new Float32Array(32);
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

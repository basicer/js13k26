import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function level() {
	const blocks = [];
	const context = vm.createContext({
		spawn: kind => {
			const entity = new Float32Array(20);
			entity[0] = kind;
			blocks.push(entity);
			return entity;
		},
	});
	vm.runInContext(readFileSync(new URL("../src/level.js", import.meta.url), "utf8")
		.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	return { ...context, blocks };
}

test("arena leaves starting positions clear and excludes obstacles and outside spawns", () => {
	const { canStand, blocks } = level();
	assert.equal(blocks.length, 21);
	for (const [x, z] of [[-2, 0], [4, -1], [7, 3], [3, 6], [-5, 5], [-8, -3], [1, -7]]) {
		assert.ok(canStand(x, z), `Starting position ${x}, ${z}`);
	}
	for (const [x, z] of [[5, 5], [-6, -5], [16, 0], [0, -16]]) assert.ok(!canStand(x, z));
});

test("bulkheads and cargo use the wall palette with whole panels on each axis", () => {
	const { blocks } = level();
	const walls = blocks.filter(entity => entity[19] === 0);
	assert.equal(walls.length, 14);
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
	const actor = new Float32Array(20);
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

test("shots stop at cover in either direction, while open lanes remain clear", () => {
	const { clearShot } = level();
	assert.ok(!clearShot(-6, -7, -6, -3));
	assert.ok(!clearShot(-6, -3, -6, -7));
	assert.ok(!clearShot(3, 5, 7, 5));
	assert.ok(!clearShot(3, 3, 7, 7));
	assert.ok(clearShot(-2, 0, 4, -1));
	assert.ok(clearShot(-2, -7, -2, 5));
});

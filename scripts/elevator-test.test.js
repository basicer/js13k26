import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as E from "../src/entities-const.js";

test("elevator warp and TEST align both stops, preserve the player during travel, and restart safely", () => {
	const context = vm.createContext({ E, GenArray: (n, f) => Array.from({ length: n }, (_, i) => f(i)) });
	const run = code => vm.runInContext(code, context);
	for (const file of ["entities", "level", "debug/elevatorTest"])
		run(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""));
	run("setupEntities(); setupLevel(() => {}); const player = spawn(1)");
	assert.equal(run("sections[4][E.PARENT]"), run("sections[0].id"));
	for (const i of [1, 2]) assert.equal(run(`sections[${i}][E.PARENT]`), run("sections[0].id"));
	assert.equal(run("sections[0][E.PARENT]"), 0);
	assert.equal(run("sections[3][E.PARENT]"), 0);
	assert.equal(run("sections[4][E.POS_Y]"), -40);
	run("entityOverrides.set(player.id, player.slice()); warpPlayer(player, warpLocations[4]); startElevatorTest(player)");
	assert.deepEqual(Array.from(run("player.subarray(E.POS,E.POS+3)")), [-17.5,0,20]);
	assert.equal(run("entityOverrides.has(player.id)"), false);
	run("updateElevatorTest(5)");
	assert.equal(run("sections[0][E.POS_Y]"), 20);
	assert.equal(run("sections[0][E.POS_X]"), 10);
	assert.equal(run("sections[4][E.POS_Y]+sections[0][E.POS_Y]"), -20);
	run("updateElevatorTest(0)");
	assert.equal(run("sections[0][E.POS_Y]"), 20);
	run("updateElevatorTest(6); updateElevatorTest(5)");
	assert.equal(run("sections[0][E.POS_Y]"), 40);
	assert.equal(run("sections[0][E.POS_X]"), 20);
	assert.equal(run("sections[4][E.POS_Y]+sections[0][E.POS_Y]"), 0);
	assert.equal(run("sections[3][E.POS_Y]"), 0);
	// At the lower stop the stationary platform meets the translated landing.
	run("EArray.filter(e => e[E.KIND] === 19).forEach(e => e[E.POS_Y] = 3); moveActor(player,0,-9)");
	assert.ok(run("Math.hypot(player[E.POS_X]+17.5,player[E.POS_Y],player[E.POS_Z]-11)") < .0001);
	assert.equal(run("canStand(-15.5,15)"), false, "the hallway wall collider follows its section");
	assert.ok(run("shotFraction(-17.5,15,-14,15,.6)") < 1, "shots hit the translated hallway wall");
	run("startElevatorTest(player); updateElevatorTest(2)");
	assert.equal(run("sections[0][E.POS_Y]"), 8);
	run("setupEntities(); setupLevel(() => {}); updateElevatorTest(8)");
	assert.equal(run("sections[0][E.POS_Y]"), 0);
	// Warping cancels a running test and selects the destination's floor height.
	run("const traveler = spawn(1)");
	for (let i = 0; i < run("warpLocations.length"); i++) {
		run(`startElevatorTest(traveler); updateElevatorTest(2); warpPlayer(traveler, warpLocations[${i}]); updateElevatorTest(10)`);
		const [,x,z,height] = run(`warpLocations[${i}]`);
		assert.deepEqual(Array.from(run("traveler.subarray(E.POS,E.POS+3)")), [x+height/2,0,z]);
		assert.equal(run("sections[0][E.POS_Y]"), height);
		assert.equal(run(`canStand(${x+height/2},${z})`), true);
	}
	const beforeTest = Array.from(run("traveler.subarray(E.POS,E.POS+3)"));
	run("startElevatorTest(traveler)");
	assert.deepEqual(Array.from(run("traveler.subarray(E.POS,E.POS+3)")), beforeTest);
});

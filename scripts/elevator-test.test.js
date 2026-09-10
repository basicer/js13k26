import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as E from "../src/entities-const.js";

test("platform panel launches the production ride without debug code", () => {
	const context = vm.createContext({ E, GenArray: (n, f) => Array.from({ length: n }, (_, i) => f(i)) });
	const run = code => vm.runInContext(code, context);
	for (const file of ["entities", "level"])
		run(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""));
	run("setupEntities(); setupLevel(() => {}); const panel = EArray.find(e => e[E.KIND] === 15 && e[E.CONTROLLER] === sections[0].id); const rider = spawn(1); rider.set([-17.5,0,20],E.POS)");
	assert.equal(run("panel[E.PARENT]"), run("sections[3].id"));
	assert.ok(run("Math.abs(panel[E.POS_X]+17.5)<3 && Math.abs(panel[E.POS_Z]-20)<3"));
	run("updateEntities(10)");
	assert.equal(run("sections[0][E.POS_Y]"), 0, "red panel leaves elevator docked");
	run("panel[E.MODEL_VARIANT] ^= 1; updateEntities(0)");
	assert.equal(run("sections[0][E.POS_Y]"), 0, "pause freezes the ride");
	run("for(let i=0;i<900;i++) updateEntities(1/60)");
	assert.ok(Math.abs(run("sections[0][E.POS_Y]") - 20) < .001);
	run("panel[E.MODEL_VARIANT] ^= 1; updateEntities(15.01); updateEntities(100)");
	assert.equal(run("sections[0][E.POS_Y]"), 40, "second click cannot abort the launched ride or overshoot the stop");
	assert.equal(run("sections[0][E.POS_X]"), 20);
	assert.deepEqual(Array.from(run("rider.subarray(E.POS,E.POS+3)")), [-17.5,0,20]);
	run("setupEntities(); setupLevel(() => {}); updateEntities(10)");
	assert.equal(run("sections[0][E.POS_Y]"), 0, "reset clears the ride and panel");
});

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
	run("updateEntities(15)");
	assert.equal(run("sections[0][E.POS_Y]"), 20);
	assert.equal(run("sections[0][E.POS_X]"), 10);
	assert.equal(run("sections[4][E.POS_Y]+sections[0][E.POS_Y]"), -20);
	run("updateEntities(0)");
	assert.equal(run("sections[0][E.POS_Y]"), 20);
	// Normal movement and knockback both use moveActor, including large steps.
	for (const [dx,dz] of [[20,0],[-20,0],[0,20],[0,-20],[20,-20]]) {
		run(`player.set([-17.5,0,20],E.POS); moveActor(player,${dx},${dz})`);
		assert.ok(run("player[E.POS_X]>=-20.0001 && player[E.POS_X]<=-14.9999 && player[E.POS_Z]>=17.4999 && player[E.POS_Z]<=22.5001"), "marine stays aboard during transit");
	}
	run("player.set([-17.5,0,20],E.POS)");
	run("updateEntities(18); updateEntities(15)");
	assert.equal(run("sections[0][E.POS_Y]"), 40);
	assert.equal(run("sections[0][E.POS_X]"), 20);
	assert.equal(run("sections[4][E.POS_Y]+sections[0][E.POS_Y]"), 0);
	assert.equal(run("sections[3][E.POS_Y]"), 0);
	// At the lower stop the stationary platform meets the translated landing.
	run("EArray.filter(e => e[E.KIND] === 19 && e[E.SOLID]).forEach(e => e[E.POS_Y] = 3); moveActor(player,0,-9)");
	assert.ok(run("Math.hypot(player[E.POS_X]+17.5,player[E.POS_Y],player[E.POS_Z]-11)") < .0001);
	for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20]]) {
		run(`player.set([-17.5,0,20],E.POS); moveActor(player,${dx},${dz})`);
		assert.ok(run("player[E.POS_X]>=-20.0001 && player[E.POS_X]<=-14.9999 && player[E.POS_Z]<=22.5001"), "the lower platform's shaft-facing and side edges remain closed");
	}
	assert.equal(run("canStand(-15.5,15)"), false, "the hallway wall collider follows its section");
	assert.ok(run("shotFraction(-17.5,15,-14,15,.6)") < 1, "shots hit the translated hallway wall");
	run("startElevatorTest(player); updateEntities(6)");
	assert.equal(run("sections[0][E.POS_Y]"), 8);
	run("setupEntities(); setupLevel(() => {}); updateEntities(8)");
	assert.equal(run("sections[0][E.POS_Y]"), 0);
	// Warping cancels a running test and selects the destination's floor height.
	run("const traveler = spawn(1)");
	for (let i = 0; i < run("warpLocations.length"); i++) {
		run(`startElevatorTest(traveler); updateEntities(6); warpPlayer(traveler, warpLocations[${i}]); updateEntities(10)`);
		const [,x,z,height] = run(`warpLocations[${i}]`);
		assert.deepEqual(Array.from(run("traveler.subarray(E.POS,E.POS+3)")), [x+height/2,0,z]);
		assert.equal(run("sections[0][E.POS_Y]"), height);
		assert.equal(run(`canStand(${x+height/2},${z})`), true);
	}
	const beforeTest = Array.from(run("traveler.subarray(E.POS,E.POS+3)"));
	run("startElevatorTest(traveler)");
	assert.deepEqual(Array.from(run("traveler.subarray(E.POS,E.POS+3)")), beforeTest);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import * as E from "../src/entities-const.js";
import { palette } from "../src/palette.js";

test("Cargo owns the deep shaft; Elevator docks flush with Cargo and the lower Boss hallway", () => {
	const context = vm.createContext({ E, GenArray: (n, f) => Array.from({ length: n }, (_, i) => f(i)) });
	const run = code => vm.runInContext(code, context);
	for (const file of ["entities", "level"])
		run(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""));
	run("setupEntities(); setupLevel(() => {}); const walls = EArray.filter(e => e[E.SCALE_Y] >= 40 && e[E.KIND] === 7); const rails = EArray.filter(e => e[E.KIND] === 14)");
	assert.equal(run("walls.length"), 6);
	assert.equal(run("walls.some(e => e[E.POS_X] === -26)"), false);
	for (const wall of run("walls")) assert.equal(wall[E.PARENT], run("sections[2].id"));
	assert.equal(run("rails.length"), 6);
	for (const rail of run("rails")) {
		assert.equal(rail[E.PARENT], run("sections[3].id"));
		assert.equal(rail[E.SOLID], 1);
		assert.deepEqual(Array.from(rail.subarray(E.TILE,E.TILE+3)), [-2,-2,-2]);
		assert.equal(run(`canStand(${rail[E.POS_X]},${rail[E.POS_Z]})`), false);
	}
	const platform = run("EArray.find(e => e[E.KIND] === 5 && e[E.PARENT] === sections[3].id && e[E.POS_X] === -17.5 && e[E.POS_Z] === 20)");
	assert.equal(platform[E.SCALE_X], 6);
	assert.equal(platform[E.SCALE_Z], 6);
	assert.equal(run("EArray.filter(e => e[E.KIND] === 5 && e[E.PARENT] === sections[3].id).length"), 1);
	for (const [x,z] of [[-26,20],[-22,24]])
		assert.equal(run(`EArray.some(e => e[E.KIND] === 5 && Math.abs(e[E.POS_X]-(${x}))<e[E.SCALE_X]/2 && Math.abs(e[E.POS_Z]-${z})<e[E.SCALE_Z]/2)`), false);
	// The open shaft is not filled by the old 8x8 elevator floor.
	assert.equal(run("EArray.some(e => e[E.KIND] === 5 && Math.abs(e[E.POS_X]+25.4)<e[E.SCALE_X]/2 && Math.abs(e[E.POS_Z]-20)<e[E.SCALE_Z]/2)"), false);
	run("EArray.filter(e => e[E.KIND] === 19 && e[E.SOLID]).forEach(e => e[E.POS_Y] = 3)");
	for (const [x,z] of [[-17.5,20],[-16,20],[-37.5,15]]) assert.equal(run(`canStand(${x},${z},.65)`), true);
	const north = run("walls.find(e => e[E.POS_Z] === 27.5)");
	const east = run("walls.find(e => e[E.POS_Z] === 20)");
	const south = run("walls.find(e => e[E.POS_Z] === 12.5)");
	assert.equal(east[E.MAT_OVERRIDE], 0, "inclined shaft keeps its wall material");
	assert.equal(north[E.POS_Z] - north[E.SCALE_Z]/2 - (platform[E.POS_Z]+3), 4);
	assert.equal(platform[E.POS_Z]-3 - (south[E.POS_Z]+south[E.SCALE_Z]/2), 4);
	assert.equal(north[E.POS_X], -29.75);
	assert.equal(north[E.SCALE_X], 30.5);
	for (const wall of [north, south])
		assert.ok(Math.abs(wall[E.POS_Y]-wall[E.SCALE_Y]/2 - (-80-30/64)) < 1e-5, "shaft continues forty units below the lower stop");
	assert.ok(Math.abs(north[E.POS_Y]+north[E.SCALE_Y]/2 - (2.8-30/64)) < 1e-5);
	const exitWalls = run("walls.filter(e => e[E.POS_Z] === 12.5)");
	assert.equal(exitWalls.length, 4);
	const covered = (x,y) => exitWalls.some(w => Math.abs(x-w[E.POS_X]) < w[E.SCALE_X]/2 && Math.abs(y-w[E.POS_Y]) < w[E.SCALE_Y]/2);
	assert.equal(covered(-37.5,-40+.6), false, "shaft wall leaves the Boss doorway visible");
	assert.equal(covered(-40,-40+.6), true, "west jamb remains");
	assert.equal(covered(-35,-40+.6), true, "east jamb remains");
	assert.equal(covered(-37.5,-36), true, "wall remains over the exit");
	assert.equal(covered(-37.5,-42), true, "pit wall continues below the exit");
	run("sections[0][E.POS_Y] = 40; sections[0][E.POS_X] = 20");
	const landing = run("EArray.find(e => e[E.KIND] === 5 && e[E.PARENT] === sections[4].id && e[E.POS_Z] === 14.75)");
	assert.equal(landing[E.POS_X]+20, platform[E.POS_X]);
	assert.equal(landing[E.POS_Z]+landing[E.SCALE_Z]/2, platform[E.POS_Z]-3);
	assert.equal(run("canStand(-17.5,15)"), true);
	const track = run("EArray.find(e => e[E.ROT_Z] && e[E.KIND] === 19)");
	assert.equal(track[E.PARENT], run("sections[2].id"));
	assert.equal(track[E.KIND], 19);
	assert.equal(track[E.MAT_OVERRIDE], 0, "track retains the door texture seams");
	assert.deepEqual(Array.from(track.subarray(E.TILE,E.TILE+3)), [-2,-2,-2]);
	assert.equal(east[E.ROT_Z], track[E.ROT_Z], "shaft wall follows the guide beam");
	const wallHalfHeight = Math.cos(east[E.ROT_Z]) * east[E.SCALE_Y] / 2 + Math.abs(Math.sin(east[E.ROT_Z])) * east[E.SCALE_X] / 2;
	assert.ok(east[E.POS_Y] - wallHalfHeight <= -80 - 30/64, "sloped wall still extends forty units below the lower stop");
	assert.ok(east[E.POS_Y] + wallHalfHeight <= -30/64, "sloped wall ends below the Cargo entrance");
	const deckEdge = platform[E.POS_X] + platform[E.SCALE_X] / 2;
	const door = run("EArray.find(e => e[E.KIND] === 19 && EArray[e[E.PARENT]][E.POS_Z] === 20)");
	const doorRoot = run(`EArray[${door[E.PARENT]}]`);
	assert.ok(doorRoot[E.POS_X] - door[E.SCALE_X] / 2 >= deckEdge, "Cargo door thickness stays outside the deck");
	for (let rise = 0; rise <= 40; rise++) {
		const wallY = platform[E.POS_Y] - platform[E.SCALE_Y] / 2;
		const wallX = east[E.POS_X] + rise / 2 - Math.tan(east[E.ROT_Z]) * (wallY - east[E.POS_Y] - rise);
		assert.ok(wallX - east[E.SCALE_X] / (2 * Math.cos(east[E.ROT_Z])) >= deckEdge, "inclined shaft wall stays outside the deck");
		// Intersect the rotated beam with the deck's bottom plane, including its width.
		const y = platform[E.POS_Y] - platform[E.SCALE_Y] / 2;
		const beamX = track[E.POS_X] + rise / 2 - Math.tan(track[E.ROT_Z]) * (y - track[E.POS_Y] - rise);
		assert.ok(beamX - track[E.SCALE_X] / (2 * Math.cos(track[E.ROT_Z])) >= deckEdge, "track thickness clears the deck throughout travel");
	}
	assert.ok(palette[1024 + 181 * 4] > 200, "door steel is metallic");
	assert.ok(Math.abs(-Math.cos(track[E.ROT_Z])/Math.sin(track[E.ROT_Z])-2)<.002);
	for (const [sign,x,y] of [[1,-14,-.4-30/64],[-1,-34,-40.4-30/64]]) {
		assert.ok(Math.abs(track[E.POS_X]-Math.sin(track[E.ROT_Z])*track[E.SCALE_Y]/2*sign-x)<.01);
		assert.ok(Math.abs(track[E.POS_Y]+Math.cos(track[E.ROT_Z])*track[E.SCALE_Y]/2*sign-y)<.01);
	}
	assert.equal(run("sections[3][E.POS_Y]"), 0);
	assert.equal(run("sections[4][E.POS_Y] + sections[0][E.POS_Y]"), 0);
});

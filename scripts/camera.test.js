import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function scene() {
	const context = vm.createContext({ E,
		DEBUG: true, heldKeys: new Set(), cameraFov: 45,
		GenArray: (n, fn) => Array.from({ length: n }, (_, i) => fn(i)),
		sound: { wobble() {}, hurt() {}, explode() {} }, setTimeout() {},
	});
	for (const file of ["entities", "level", "game", "debug/camera"])
		vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	const run = code => vm.runInContext(code, context);
	run(`globalThis.worldCamera = () => Array.from(cameraPosition, (value, axis) =>
		cameraEntity[2] ? EArray[cameraEntity[2]][axis + 4] + value * EArray[cameraEntity[2]][axis + 12] : value);`);
	return run;
}

test("camera inherits root movement while aiming and corpse rotation stay on the body", () => {
	const run = scene();
	assert.equal(run("cameraEntity[2] === player.id"), true);
	const initial = Array.from(run("worldCamera()"));
	run("player[4] += 7; player[6] -= 3;");
	const moved = Array.from(run("worldCamera()"));
	assert.deepEqual(moved, [initial[0] + 7, initial[1], initial[2] - 3]);
	run("aimMarineAtCursor(500, 300, 800, 600);");
	const angle = run("marineBody[9]");
	run("player[4] += 5; player[6] += 9; aimMarineAtCursor(500, 300, 800, 600);");
	assert.equal(run("marineBody[9]"), angle, "cursor aiming is independent of root translation");
	assert.equal(run("player[8] === 0 && player[9] === 0 && player[10] === 0"), true);
	const beforeDeath = Array.from(run("worldCamera()"));
	run("marineBody[8] = Math.PI / 2;");
	assert.deepEqual(Array.from(run("worldCamera()")), beforeDeath);
});

test("debug detach and reattach preserve world position and resume following", () => {
	const run = scene();
	const before = Array.from(run("worldCamera()"));
	run("detachCamera(); detachCamera();");
	assert.equal(run("cameraEntity[2]"), 0);
	assert.deepEqual(Array.from(run("worldCamera()")), before);
	run("player[4] += 4;");
	assert.deepEqual(Array.from(run("worldCamera()")), before);
	run("cameraPosition[0] += 2; cameraPosition[1] += 3;");
	const flown = Array.from(run("worldCamera()"));
	run("attachCamera(); attachCamera();");
	assert.equal(run("cameraEntity[2] === player.id"), true);
	assert.deepEqual(Array.from(run("worldCamera()")), flown);
	run("player[6] += 2;");
	assert.deepEqual(Array.from(run("worldCamera()")), [flown[0], flown[1], flown[2] + 2]);
});

test("restart replaces a detached debug camera with a fresh attached follow camera", () => {
	const run = scene();
	const initial = Array.from(run("worldCamera()"));
	run("detachCamera(); cameraPosition.fill(99); setupGame(); attachCamera();");
	assert.equal(run("cameraEntity[2] === player.id"), true);
	assert.deepEqual(Array.from(run("worldCamera()")), initial);
});

test("startup logo stands on the floor with a temporary front light and short simulation TTL", () => {
	const run = scene();
	const logo = run("EArray.find(e => e[0] === 13)");
	const camera = Array.from(run("worldCamera()"));
	const [pitch, yaw] = Array.from(run("cameraRotation"));
	const delta = [logo[4] - camera[0], logo[5] - camera[1], logo[6] - camera[2]];
	const forward = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)];
	const up = [-Math.sin(yaw) * Math.sin(pitch), Math.cos(pitch), Math.cos(yaw) * Math.sin(pitch)];
	const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
	assert.ok(dot(delta, forward) > 3);
	assert.ok(Math.abs(dot(delta, up)) < 2, "sculpture remains near the opening view");
	assert.ok(Math.abs(dot(delta, [Math.cos(yaw), 0, Math.sin(yaw)])) < 0.02);
	assert.ok(Math.abs(logo[8] + .32) < 0.00001);
	assert.equal(logo[9], yaw);
	assert.ok(logo[12] > 5 && logo[14] > 1, "large, deep sculpture");
	const light = run("EArray.find(e => e[0] === 1 && e[1] > 0)");
	assert.ok(light[4] < logo[4], "light is on the visible face's side");
	assert.ok(light[5] > logo[5]);
	assert.equal(light[23], logo[23]);
	assert.deepEqual(Array.from(logo.slice(16, 19)), [0, 0, 0]);
	assert.equal(logo[28], 0, "logo is non-solid");
	for (let frame = 0; frame < 100; frame++) run("updateEntities(0)");
	assert.equal(logo[0], 13, "logo survives the startup pause");
	run("updateEntities(0.11)");
	assert.equal(logo[0], 0, "logo expires just after gameplay starts");
	assert.equal(light[0], 0, "the temporary logo light expires in the same frame");

});

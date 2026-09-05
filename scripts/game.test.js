import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function game() {
	const sounds = { hurt: 0, gunshot: 0, reload: 0, emptyClick: 0, spaceholder1: 0 };
	const context = vm.createContext({
		heldKeys: new Set(), cameraPosition: [0, 5, 8], cameraRotation: [-0.5, 0, 0],
		spawn: kind => {
			const entity = new Float32Array(20);
			entity[0] = kind;
			entity[12] = entity[13] = entity[14] = 1;
			entity[16] = entity[17] = entity[18] = -2;
			return entity;
		},
		sound: Object.fromEntries(Object.keys(sounds).map(key => [key, () => sounds[key]++])),
	});
	for (const file of ["level", "game"]) {
		vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	}
	const run = code => vm.runInContext(code, context);
	run("unicorns.splice(1); spawnCooldown = 1000;");
	const touch = () => run("unicorns[0].entity[4] = player[4] + 1; unicorns[0].entity[6] = player[6];");
	return { run, touch, sounds };
}

test("contact hurts once, plays a sound and pushes the attacker away", () => {
	const { run, touch, sounds } = game();
	touch();
	run("updateGame(0)");
	assert.equal(run("marineHealth"), 4);
	assert.equal(sounds.hurt, 1);
	assert.ok(run("unicorns[0].entity[4] - player[4] > 2.7"));
	touch();
	run("updateGame(0.4)");
	assert.equal(sounds.hurt, 1);
	run("updateGame(0.46)");
	assert.equal(run("marineHealth"), 3);
	assert.equal(sounds.hurt, 2);
});

test("a crowd cannot deal multiple hits in one frame", () => {
	const { run, touch, sounds } = game();
	touch();
	run("spawnUnicorn(player[4] - 1, player[6]); updateGame(0)");
	assert.equal(run("marineHealth"), 4);
	assert.equal(sounds.hurt, 1);
});

test("marine damage builds blood coverage to 30% and fully stains the corpse", () => {
	const { run, touch } = game();
	assert.equal(run("player[11]"), 255);
	assert.equal(run("unicorns[0].entity[11]"), 255);
	assert.equal(run("player[3]"), 0);
	for (let hit = 1; hit <= 5; hit++) {
		touch();
		run("updateGame(0.86)");
		assert.ok(Math.abs(run("player[3]") - (hit < 5 ? hit * 0.075 : 1)) < 0.000001);
		const amount = run("player[3]");
		touch();
		run("updateGame(0)");
		assert.equal(run("player[3]"), amount, "Invulnerability and death prevent extra damage");
	}
	assert.equal(run("player[11]"), 255);
	assert.equal(run("unicorns[0].entity[3]"), 0);
});

test("fifth hit leaves a corpse and disables movement, aiming, firing and reload", () => {
	const { run, touch, sounds } = game();
	for (let i = 0; i < 5; i++) {
		touch();
		run("updateGame(0.86)");
	}
	assert.equal(run("marineHealth"), 0);
	assert.equal(sounds.hurt, 4);
	assert.equal(sounds.spaceholder1, 1);
	assert.ok(Math.abs(run("player[8]") - Math.PI / 2) < 0.001);
	run("heldKeys.add('d'); bulletsInMagazine = 10; setMarineTrigger(true); fireMarineGun(); reloadMarineGun(); aimMarineAtCursor(0, 0, 800, 600); updateGame(2)");
	assert.equal(run("player[4]"), -2);
	assert.equal(run("player[9]"), 0);
	assert.equal(run("reloadCooldown"), 0);
	assert.equal(sounds.gunshot, 0);
	assert.equal(sounds.reload, 0);
	assert.equal(sounds.hurt, 4);
	assert.equal(sounds.spaceholder1, 1);
	assert.equal(run("player[0]"), 1, "corpse remains allocated");
});

test("dead unicorns cannot hurt and exact overlap produces finite knockback", () => {
	const { run, touch, sounds } = game();
	touch();
	run("unicorns[0].dead = true; updateGame(0)");
	assert.equal(sounds.hurt, 0);
	run("unicorns[0].dead = false; unicorns[0].entity[4] = player[4]; updateGame(0)");
	assert.equal(sounds.hurt, 1);
	assert.ok(run("Number.isFinite(unicorns[0].entity[4]) && Number.isFinite(unicorns[0].entity[6])"));
});

test("knockback stays inside the arena and cover prevents contact damage", () => {
	const { run, touch, sounds } = game();
	run("player[4] = 12");
	touch();
	run("updateGame(0)");
	assert.ok(run("canStand(unicorns[0].entity[4], unicorns[0].entity[6])"));
	assert.ok(run("unicorns[0].entity[4] <= 14.55"));
	run("hurtCooldown = 0; player[4] = -6; player[6] = -5.6; unicorns[0].entity[4] = -6; unicorns[0].entity[6] = -4.4; updateGame(0)");
	assert.equal(sounds.hurt, 1);
});

test("tracers start at the muzzle, stop at cover and expire", () => {
	const { run } = game();
	run("unicorns.length = 0; fireMarineGun();");
	const tracer = run("temporary.find(effect => effect.entity[0] === 7).entity");
	assert.ok(Math.abs(tracer[6] - Math.cos(tracer[9]) * tracer[14] / 2 - 30 / 64) < 0.001);
	assert.ok(tracer[14] <= 0.251);
	assert.equal(tracer[19], 242);
	const startZ = tracer[6], startY = tracer[5];
	run("updateGame(0.05)");
	assert.equal(tracer[0], 7);
	assert.ok(Math.abs(tracer[6] - startZ - 2.25) < 0.001);
	assert.equal(tracer[5], startY);
	run("updateGame(1)");
	assert.ok(Math.abs(tracer[6] + Math.cos(tracer[9]) * tracer[14] / 2 - 15) < 0.001);
	assert.equal(tracer[0], 255);
});

test("tracer and flash originate at the model bore at every facing and scale", () => {
	for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
		const { run } = game();
		run(`unicorns.length = 0; player[9] = ${yaw}; player[12] = 1.2; player[13] = 1.4; player[14] = 0.8; fireMarineGun()`);
		const angle = run("player[9]");
		const expected = [
			-2 + Math.cos(angle) * 1.2 / 64 - Math.sin(angle) * 30 * 0.8 / 64,
			10.5 * 1.4 / 64,
			Math.sin(angle) * 1.2 / 64 + Math.cos(angle) * 30 * 0.8 / 64,
		];
		const flash = run("temporary[0].entity");
		const tracer = run("temporary.find(effect => effect.entity[0] === 7).entity");
		const start = [tracer[4] + Math.sin(tracer[9]) * tracer[14] / 2, tracer[5], tracer[6] - Math.cos(tracer[9]) * tracer[14] / 2];
		for (let axis = 0; axis < 3; axis++) {
			assert.ok(Math.abs(start[axis] - expected[axis]) < 0.00001);
			assert.ok(Math.abs(flash[axis + 4] - expected[axis]) < 0.00001);
		}
	}
});

test("tracers follow hits and are absent for empty or reloading weapons", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64; unicorns[0].entity[6] = 4; fireMarineGun()");
	const tracer = run("temporary.find(effect => effect.entity[0] === 7).entity");
	run("updateGame(1)");
	const endX = tracer[4] - Math.sin(tracer[9]) * tracer[14] / 2;
	const endZ = tracer[6] + Math.cos(tracer[9]) * tracer[14] / 2;
	assert.ok(Math.abs(endX - (-2 + 1/64)) < 0.001);
	assert.ok(Math.abs(endZ - 3.7) < 0.001);
	assert.equal(run("unicorns[0].health"), 3);
	run("temporary.length = 0; shotCooldown = 0; bulletsInMagazine = 0; fireMarineGun(); reloadMarineGun(); fireMarineGun()");
	assert.equal(run("temporary.length"), 0);
});

test("unicorn damage dissolves up to 30% while alive and completes on death", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64; unicorns[0].entity[6] = 4; spawnUnicorn(2, 3)");
	assert.equal(run("unicorns[0].entity[3]"), 0);
	assert.equal(run("unicorns[0].entity[11]"), 255);
	for (let hit = 1; hit <= 4; hit++) {
		run("shotCooldown = 0; fireMarineGun()");
		assert.ok(Math.abs(run("unicorns[0].entity[3]") - (hit < 4 ? hit * 0.1 : 1)) < 0.000001);
		assert.equal(run("unicorns[0].health"), 4 - hit);
		assert.equal(run("unicorns[0].dead"), hit === 4);
		assert.equal(run("unicorns[1].entity[3]"), 0);
	}
	run("shotCooldown = 0; fireMarineGun(); spawnUnicorn(3, 4)");
	assert.equal(run("unicorns[0].entity[3]"), 1);
	assert.equal(run("unicorns[2].entity[3]"), 0);
});

test("targets beyond the capped forgiveness remain misses without tracer steering", () => {
	for (const z of [2, 4, 12]) {
		const { run } = game();
		run(`unicorns[0].entity[4] = -1.5; unicorns[0].entity[6] = ${z}; fireMarineGun()`);
		assert.equal(run("unicorns[0].health"), 4);
		assert.equal(run("unicorns[0].entity[3]"), 0);
		assert.equal(Math.abs(run("temporary.find(effect => effect.entity[0] === 7).velocity[0]")), 0);
	}
});

test("small edge misses register without steering the firing ray", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64 + 0.38; unicorns[0].entity[6] = 4; fireMarineGun()");
	assert.equal(run("unicorns[0].health"), 3);
	assert.equal(Math.abs(run("temporary.find(effect => effect.entity[0] === 7).velocity[0]")), 0);
});

test("blood starts at the unicorn center even for an off-center hit", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64 + 0.38; unicorns[0].entity[5] = 0.2; unicorns[0].entity[6] = 4; fireMarineGun()");
	const center = Array.from(run("unicorns[0].entity.subarray(4, 7)"));
	const blood = run("temporary.filter(effect => effect.entity[19] === 255)");
	assert.equal(blood.length, 28);
	for (const drop of blood) {
		assert.deepEqual(Array.from(drop.entity.subarray(4, 7)), center);
		assert.equal(drop.entity[7], 0.5);
	}
});

test("blood falls faster and settles on the floor instead of above its origin", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64; unicorns[0].entity[6] = 4; fireMarineGun()");
	const blood = run("temporary.find(effect => effect.entity[19] === 255)");
	const initialSpeed = blood.velocity[1];
	run("updateGame(0.01)");
	assert.ok(Math.abs(blood.velocity[1] - (initialSpeed - 0.11)) < 0.000001);
	for (let i = 0; i < 70; i++) run("updateGame(0.01)");
	assert.ok(blood.entity[5] < 0);
	assert.ok(Math.abs(blood.entity[5] - (-30 / 64 + blood.entity[13] * 0.38)) < 0.000001);
	assert.equal(blood.velocity[1], 0);
});

test("a directly aimed target takes priority over a closer assisted target", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -1.6; unicorns[0].entity[6] = 3; spawnUnicorn(-2 + 1/64, 6); fireMarineGun()");
	assert.equal(run("unicorns[0].health"), 4);
	assert.equal(run("unicorns[1].health"), 3);
});

test("the first body on the firing ray wins, and cover blocks damage", () => {
	const { run } = game();
	run("unicorns[0].entity[4] = -2 + 1/64; unicorns[0].entity[6] = 6; spawnUnicorn(-2 + 1/64, 3); fireMarineGun()");
	assert.equal(run("unicorns[0].health"), 4);
	assert.equal(run("unicorns[1].health"), 3);
	run("shotCooldown = 0; player[4] = -6; player[6] = -7; unicorns[0].entity[4] = -6; unicorns[0].entity[6] = -3; fireMarineGun()");
	assert.equal(run("unicorns[0].health"), 4);
});

test("a muzzle reaching through cover cannot draw a backward tracer", () => {
	const { run } = game();
	run("unicorns.length = 0; player[4] = -6; player[6] = -6; fireMarineGun()");
	assert.equal(run("temporary.filter(effect => effect.entity[0] === 7).length"), 0);
});

test("wall and cover hits throw short-lived sparks back from the impact", () => {
	for (const [x, z, wallZ] of [[-2, 0, 15], [-6, -7, -5.5]]) {
		const { run } = game();
		run(`unicorns.length = 0; player[4] = ${x}; player[6] = ${z}; fireMarineGun()`);
		const sparks = run("temporary.filter(effect => effect.entity[0] === 6 && effect.entity[19] !== 246)");
		assert.equal(sparks.length, 8);
		for (const spark of sparks) {
			assert.ok(Math.abs(spark.entity[6] - (wallZ - 0.06)) < 0.00001);
			assert.ok(spark.velocity[2] < 0);
			assert.ok(spark.lifetime >= 0.25 && spark.lifetime <= 0.45);
			assert.equal(spark.entity[1], 0, "Sparks do not cast point light");
			assert.equal(spark.entity[7], 0, "Sparks remain opaque");
			assert.equal(spark.entity[11], 0, "Ordinary particles retain default dissolve behavior");
			assert.deepEqual(Array.from(spark.entity.subarray(16, 19)), [0, 0, 0], "Particles sample the full sphere");
			assert.ok(spark.entity[12] >= 0.1 && spark.entity[12] <= 0.16);
		}
		run("updateGame(0.5)");
		assert.ok(sparks.every(spark => spark.entity[0] === 255));
	}
});

test("enemy hits, range misses and obstructed muzzles do not create wall sparks", () => {
	for (const setup of [
		"unicorns[0].entity[4] = -2 + 1/64; unicorns[0].entity[6] = 4",
		"unicorns.length = 0; player[6] = -10",
		"unicorns.length = 0; player[4] = -6; player[6] = -5.8",
	]) {
		const { run } = game();
		run(`${setup}; fireMarineGun()`);
		assert.equal(run("temporary.filter(effect => effect.entity[0] === 6 && [242, 248].includes(effect.entity[19])).length"), 0);
	}
});

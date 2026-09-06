import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function game() {
	let nextEntityId = 1;
	const timers = [];
	let restarts = 0;
	const sounds = { hurt: 0, gunshot: 0, reload: 0, emptyClick: 0, explode: 0, shotgunPump: 0, wobble: 0 };
	let seed = 123456;
	const randomMath = Object.create(Math);
	randomMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
	const EArray = [];
	const context = vm.createContext({
		EArray, getUnicorns: () => EArray.filter(e => e[0] === 2), getPortals: () => EArray.filter(e => e[0] === 12), effects: () => EArray.filter(e => e[0] !== 0 && e[23] !== 0),
		DEBUG: true, Math: randomMath,
		setTimeout: (callback, delay) => timers.push({ callback, delay }),
		setupEntities: () => { EArray.length = 0; nextEntityId = 1; },
		heldKeys: new Set(), cameraEntity: new Float32Array(32), cameraPosition: [0, 5, 8], cameraRotation: [-0.5, 0, 0],
		spawn: kind => {
			let entity = EArray.find(e => e[0] === 0);
			if (!entity) {
				entity = new Float32Array(32);
				entity.id = nextEntityId++;
				EArray.push(entity);
			}
			entity.fill(0);
			entity[28] = 0;
			entity[0] = kind;
			entity[23] = 0;
			entity[24] = Math.PI * 2;
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
	run("globalThis.initialUnicorns = getUnicorns().length; getUnicorns().slice(1).forEach(e => e[0] = 0);");
	const touch = () => run("getUnicorns()[0][4] = player[4] + 1; getUnicorns()[0][6] = player[6];");
	return { run, touch, sounds, timers };
}

test("only a fatal hit schedules one restart after five seconds", () => {
	const { run, touch, timers } = game();
	touch();
	run("updateGame(0);");
	assert.equal(timers.length, 0);
	run("marineHealth = 1; hurtCooldown = 0;");
	touch();
	run("updateGame(0); updateGame(1); updateGame(10);");
	assert.equal(run("marineHealth"), 0);
	assert.equal(timers.length, 1);
	assert.equal(timers[0].delay, 5000);
	assert.equal(run("marineHealth"), 0);
	timers[0].callback();
	assert.equal(run("marineHealth"), 5);
	assert.equal(run("getUnicorns().length"), 5);
	assert.equal(run("getPortals().every(e => e[25] === 50)"), true);
	assert.equal(run("weapons.every(w => w[4] === w[0])"), true);
});

test("in-place setup restores the entire world and rejects previous-run GPU readbacks", () => {
	const timers = [];
	const context = vm.createContext({
		DEBUG: true, heldKeys: new Set(), cameraFov: 60,
		GenArray: (n, fn) => Array.from({ length: n }, (_, i) => fn(i)),
		sound: { wobble() {}, hurt() {}, explode() {} },
		setTimeout: (callback, delay) => timers.push({ callback, delay }),
	});
	for (const file of ["entities", "level", "game"]) {
		vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	}
	const run = code => vm.runInContext(code, context);
	run("globalThis.initial = entities.slice(); globalThis.storage = entities; globalThis.view = EArray[1];");
	for (let cycle = 0; cycle < 2; cycle++) {
		run(`
			globalThis.oldVersion = entityVersion;
			globalThis.oldFrame = entities.slice();
			globalThis.oldResult = entities.slice(); oldResult[27] = 999;
			marineHealth = 1; hurtCooldown = 0;
			globalThis.enemy = EArray.find(e => e[0] === 2);
			enemy[4] = player[4]; enemy[6] = player[6]; updateGame(0);
			heldKeys.add('w'); entityOverrides.set(1, {});
			weapons.forEach(w => w[4] = 0); entities.fill(3, 32);
		`);
		assert.equal(timers[cycle].delay, 5000);
		timers[cycle].callback();
		assert.equal(run("entities === storage && EArray[1] === view"), true);
		assert.equal(run("entities.every((value, i) => value === initial[i])"), true);
		assert.equal(run("marineHealth === 5 && selectedWeapon === 1 && weapons.every(w => w[4] === w[0])"), true);
		assert.equal(run("!heldKeys.size && !entityOverrides.size && !triggerHeld && !reloadCooldown"), true);
		run("mergeEntityFrame(oldFrame, oldResult, oldVersion);");
		assert.equal(run("entities.every((value, i) => value === initial[i])"), true);
	}
});

test("recycled entity slots reset actor state and are targeted only once", () => {
	const { run } = game();
	run("globalThis.recycled = getUnicorns()[0]; recycled[26] = 1.7; recycled[25] = 0; recycled[0] = 0; spawnUnicorn(-2 + 1/64, 4);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(run("getUnicorns()[0] === recycled"), true);
	assert.equal(run("recycled[25]"), 4);
	assert.equal(run("recycled[26]"), 0);
	run("fireMarineGun();");
	assert.equal(run("recycled[25]"), 3);
	// Reusing that slot for an effect removes it from all actor behavior.
	run("recycled[0] = 0; spawn(6); updateGame(0.1, true);");
	assert.equal(run("getUnicorns().length"), 0);
	assert.equal(run("recycled[25]"), 0);
	assert.equal(run("recycled[26]"), 0);
});

test("marine has four parts parented under an empty root", () => {
	const { run } = game();
	assert.deepEqual(Array.from(run("marineParts.map(part => part[0])")), [8, 9, 10, 11]);
	assert.equal(run("player[0]"), 1);
	assert.equal(run("marineLegs[2] === marineBody.id && marineBody[2] === player.id"), true);
	assert.equal(run("marineArms[2] === marineBody.id && marineGun[2] === marineArms.id"), true);
	assert.equal(run("marineParts.slice(0, 3).every(part => part[4] === 0 && part[5] === 0 && part[6] === 0 && part[16] === 0 && part[17] === 0 && part[18] === 0)"), true);
	assert.deepEqual(Array.from(run("marineGun.subarray(4, 7)")), [0.04749999940395355, 0.1328125, 0.22374999523162842]);
	assert.deepEqual(Array.from(run("marineGun.subarray(12, 15)")), [0.17000000178813934, 0.25, 0.5600000023841858]);
	assert.deepEqual(Array.from(run("marineGun.subarray(16, 19)")), [1, 1, 1]);
	run("player[3] = 0.3; player[11] = 255; updateGame(0);");
	assert.equal(run("marineParts.every(part => part[3] === player[3] && part[11] === 255)"), true);
});

test("wall portals face inward and spawn the initial herd and replacements clear of walls", () => {
	const { run } = game();
	assert.deepEqual(JSON.parse(run("JSON.stringify(EArray.filter(entity => entity[0] === 12).map(entity => [entity[4], entity[6]]))")), [
		[3, -15], [15, 4], [6, 15], [-7, -15], [7.5, 0],
	]);
	assert.equal(run("EArray.filter(e => e[0] === 12).every(e => canStand(e[4] - Math.sin(e[9]), e[6] + Math.cos(e[9])))"), true);
	assert.equal(run("initialUnicorns"), 5);
	assert.equal(run("getPortals().every(e => Math.abs(e[1] - 2.1) < 0.00001 && Math.abs(e[24] - 2.772) < 0.00001)"), true);
	assert.equal(run("EArray.filter(e => e[0] === 2).every(e => canStand(e[4], e[6]))"), true);
	run("getUnicorns().forEach(e => e[0] = 0); getPortals()[0][27] = 26; updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(run("portalLocations.some(([x, z, yaw]) => Math.abs(getUnicorns()[0][4] - (x - Math.sin(yaw))) < 0.00001 && Math.abs(getUnicorns()[0][6] - (z + Math.cos(yaw))) < 0.00001)"), true);
	assert.equal(run("canStand(getUnicorns()[0][4], getUnicorns()[0][6])"), true);
});

test("wall and interior pillar portals survive 49 hits and dissolve completely after hit 50", () => {
	const { run } = game();
	run("getUnicorns().forEach(e => e[0] = 0);");
	for (let index = 0; index < 5; index++) {
		run(`globalThis.portalTarget = getPortals()[${index}];
			globalThis.normal = marineFacing(portalTarget[9]);
			player[4] = portalTarget[4] + normal[0] * 3;
			player[6] = portalTarget[6] + normal[1] * 3;
			globalThis.shootPortal = () => firePellet(player[4], 0.2, player[6], -normal[0], -normal[1], true);`);
		run("for (let hit = 0; hit < 49; hit++) shootPortal();");
		assert.equal(run("portalTarget[25]"), 1);
		assert.equal(run("portalTarget[3]"), 0);
		run("updateGame(0.1, true);");
		assert.ok(run("portalTarget[3] > 0 && portalTarget[3] < 0.294"));
		run("updateGame(2, true);");
		assert.ok(Math.abs(run("portalTarget[3]") - 0.294) < 0.00001);
		run("shootPortal();");
		assert.equal(run("portalTarget[25]"), 0);
		run("updateGame(0.1, true); shootPortal();");
		assert.ok(run("portalTarget[3] > 0.294 && portalTarget[3] < 1"));
		run("updateGame(2, true);");
		assert.equal(run("portalTarget[3]"), 1);
		assert.equal(run("portalTarget[1]"), 0);
		assert.equal(run("portalTarget[11]"), 0);
		assert.equal(run("portalTarget[25]"), 0);
	}
	run("getPortals().forEach(p => p[27] = 26); updateGame(2, true);");
	assert.equal(run("getUnicorns().length"), 0);
});

test("portal shots respect cover, nearer unicorns and the arch outline", () => {
	const { run } = game();
	// Cargo at (5, 5) blocks this ray to the south wall portal.
	run("getUnicorns().forEach(e => e[0] = 0); player[4] = 6; player[6] = 0; firePellet(6, 0.2, 0, 0, 1, true);");
	assert.equal(run("getPortals()[2][25]"), 50);
	// A unicorn between the gun and the north portal absorbs the hit.
	run("player[4] = 3; player[6] = -12; spawnUnicorn(3, -13); firePellet(3, 0.2, -12, 0, -1, true);");
	assert.equal(run("getUnicorns()[0][25]"), 3);
	assert.equal(run("getPortals()[0][25]"), 50);
	run("getUnicorns().forEach(e => e[0] = 0); firePellet(3, 2, -12, 0, -1, false); firePellet(4.8, 0.2, -12, 0, -1, true);");
	assert.equal(run("getPortals()[0][25]"), 50);
	// The wider lower arc takes hits, but its empty upper corners do not.
	run("firePellet(4.2, 0.2, -12, 0, -1, true);");
	assert.equal(run("getPortals()[0][25]"), 49);
	run("firePellet(4.2, 1.1, -12, 0, -1, false);");
	assert.equal(run("getPortals()[0][25]"), 49);
});

test("gates spawn independently after twenty-five seconds, reset age and play wobble", () => {
	const { run, sounds } = game();
	assert.equal(sounds.wobble, 5, "Initial herd plays the spawn sound");
	run("getPortals().forEach(p => p[27] = 8); updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(sounds.wobble, 5);
	run("getPortals().forEach(p => p[27] = 25.1); updateGame(0);");
	assert.equal(run("getUnicorns().length"), 6, "Every gate spawns, even above the old herd cap");
	assert.equal(run("getPortals().every(p => p[27] === 0)"), true);
	assert.equal(sounds.wobble, 10);
	run("updateGame(0);");
	assert.equal(sounds.wobble, 10, "Reset gates cannot spawn again immediately");
	run("getPortals()[1][27] = 26; updateGame(0);");
	assert.equal(run("getUnicorns().length"), 7);
	assert.equal(sounds.wobble, 11);
});

test("failed gate spawns retain their timer without playing wobble", () => {
	const { run, sounds } = game();
	run("getPortals()[0][27] = 26; spawn = () => null; updateGame(0);");
	assert.equal(run("getPortals()[0][27]"), 26);
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(sounds.wobble, 5);
});

test("replacement unicorns only emerge from surviving portals", () => {
	const { run } = game();
	run("getUnicorns().forEach(e => e[0] = 0); getPortals().forEach((p, i) => p[25] = i === 1 ? 1 : 0);");
	for (let attempt = 0; attempt < 10; attempt++) {
		run("getUnicorns().forEach(e => e[0] = 0); getPortals().forEach(p => p[27] = 26); updateGame(0);");
		assert.equal(run("getUnicorns().length"), 1);
		assert.equal(run("getUnicorns()[0][4]"), 14);
		assert.equal(run("getUnicorns()[0][6]"), 4);
	}
});

test("weapon selection preserves independent magazines and cancels reload without refilling", () => {
	const { run } = game();
	run("selectMarineWeapon(1); fireMarineGun(); reloadMarineGun(); selectMarineWeapon(2);");
	assert.equal(run("weapon[4]"), 30);
	assert.equal(run("reloadCooldown"), 0);
	run("selectMarineWeapon(3);"); assert.equal(run("weapon[4]"), 8);
	run("selectMarineWeapon(1);"); assert.equal(run("weapon[4]"), 11);
	run("selectMarineWeapon(0); selectMarineWeapon(4);"); assert.equal(run("selectedWeapon"), 0);
});

test("pistol and shotgun require a fresh click while rifle repeats when held", () => {
	for (const [number, capacity] of [[1, 12], [2, 30], [3, 8]]) {
		const { run, sounds } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(${number}); setMarineTrigger(true); fireMarineGun(); updateGame(0.8);`);
		assert.equal(sounds.gunshot, number === 2 ? 2 : 1);
		assert.equal(run("weapon[4]"), capacity - (number === 2 ? 2 : 1));
		if (number !== 2) {
			run("fireMarineGun();"); assert.equal(sounds.gunshot, 1);
			run("setMarineTrigger(false); setMarineTrigger(true); fireMarineGun();");
			assert.equal(sounds.gunshot, 2);
		}
	}
});

test("pistol can fire its whole magazine in separate clicks without elapsed time", () => {
	const { run, sounds } = game();
	run("getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(1); for (let i = 0; i < 12; i++) { setMarineTrigger(false); setMarineTrigger(true); fireMarineGun(); }");
	assert.equal(sounds.gunshot, 12);
	assert.equal(run("weapon[4]"), 0);
	assert.equal(run("shotCooldown"), 0);
});

test("shotgun ready sound plays once at cooldown completion", () => {
	const { run, sounds } = game();
	run("getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(3); fireMarineGun(); updateGame(0.69);");
	assert.equal(sounds.shotgunPump, 0);
	run("updateGame(0.02);"); assert.equal(sounds.shotgunPump, 1);
	run("updateGame(1);"); assert.equal(sounds.shotgunPump, 1);
});

test("shotgun ready sound is suppressed after switching, reloading, death, or the last shell", () => {
	for (const action of ["selectMarineWeapon(1)", "reloadMarineGun()", "marineHealth = 0", "weapon[4] = 0"]) {
		const { run, sounds } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(3); fireMarineGun(); ${action}; updateGame(1);`);
		assert.equal(sounds.shotgunPump, 0, action);
	}
});

test("all weapons refill their capacity after their full reload animation", () => {
	for (const [number, capacity, duration] of [[1, 12, 1.15], [2, 30, 2.5875], [3, 8, 2.3]]) {
		const { run, sounds } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(${number}); weapon[4] = 0; reloadMarineGun();`);
		assert.equal(run("reloadCooldown"), duration);
		run(`updateGame(${duration / 2}); fireMarineGun();`);
		assert.equal(run("weapon[4]"), 0); assert.equal(sounds.gunshot, 0);
		assert.ok(Math.abs(run("marineArms[8]") - 0.85) < 0.000001);
		run(`updateGame(${duration / 2 + 0.001});`);
		assert.equal(run("weapon[4]"), capacity);
		assert.equal(run("marineArms[8]"), 0);
	}
});

test("shotgun fires twelve distinct pellet rays per shell with a 0.7 second cooldown", () => {
	const { run, sounds } = game();
	run("getUnicorns().forEach(e => e[0] = 0); EArray.forEach(e => e[28] = 0); selectMarineWeapon(3); setMarineTrigger(true); fireMarineGun();");
	assert.equal(run("weapon[4]"), 7);
	assert.equal(run("effects().filter(effect => effect[0] === 7).length"), 12);
	assert.equal(run("new Set(effects().filter(effect => effect[0] === 7).map(effect => effect[9])).size"), 12);
	assert.equal(run("effects().filter(effect => effect[1] === 12).length"), 1);
	const first = run("effects().filter(effect => effect[0] === 7).map(effect => Array.from(effect.subarray(20, 23)))");
	assert.ok(first.some(v => v[1] > 0));
	assert.ok(first.some(v => v[1] < 0));
	for (const velocity of first) {
		assert.ok(Math.abs(Math.hypot(...velocity) - 45) < 0.00001);
		assert.ok(velocity[2] / 45 >= Math.cos(0.14) - 0.000001);
	}
	run("setMarineTrigger(false); updateGame(0.69); fireMarineGun();");
	assert.equal(sounds.gunshot, 1);
	run("updateGame(0.02); fireMarineGun();");
	assert.equal(sounds.gunshot, 2); assert.equal(run("weapon[4]"), 6);
	const second = run("effects().filter(effect => effect[0] === 7).map(effect => Array.from(effect.subarray(20, 23)))");
	assert.notEqual(JSON.stringify(first), JSON.stringify(second));
});

test("pellet height affects hits and short cover intersection", () => {
	const { run } = game();
	run("EArray.forEach(e => e[28] = 0); getUnicorns().forEach(e => e[0] = 0); spawnUnicorn(0, 8); firePellet(0, 0.1640625, 0, 0, Math.cos(0.14), false, Math.sin(0.14));");
	assert.equal(run("getUnicorns()[0][25]"), 4);
	run("firePellet(0, 0.1640625, 0, 0, 1, false, 0);");
	assert.equal(run("getUnicorns()[0][25]"), 3);
	run("block(0, 5.5, 2, 0.5 - ground, 1);");
	assert.equal(run("shotFraction(0, 0, 0, 10, 0.2, 2)"), 1);
	assert.ok(run("shotFraction(0, 0, 0, 10, 0.2, 0.2)") < 1);
});

test("shotgun cone can hit multiple targets and respects cover", () => {
	for (const blocked of [false, true]) {
		const { run } = game();
		run("getUnicorns().forEach(e => e[0] = 0); EArray.forEach(e => e[28] = 0); spawnUnicorn(-2.55, 6); spawnUnicorn(-1.45, 6); selectMarineWeapon(3);");
		if (blocked) run("block(-2, 2.5, 6, 2 - ground, 1);");
		run("fireMarineGun();");
		assert.equal(run("getUnicorns().every(unicorn => unicorn[25] < 4)"), !blocked);
		if (blocked) assert.equal(run("getUnicorns().every(unicorn => unicorn[25] === 4)"), true);
	}
});

test("reload lowers arms around the shoulders and restores the firing pose", () => {
	const { run } = game();
	run("weapon[4] = 20; reloadMarineGun(); updateGame(1.29375);");
	assert.ok(Math.abs(run("marineArms[8]") - 0.85) < 0.000001);
	assert.equal(run("marineGun[2] === marineArms.id"), true);
	assert.ok(Math.abs(run("marineArms[5] + (12 / 64) * Math.cos(marineArms[8])") - 12 / 64) < 0.000001);
	assert.ok(Math.abs(run("marineArms[6] + (12 / 64) * Math.sin(marineArms[8])")) < 0.000001);
	run("updateGame(1.3);");
	assert.equal(run("marineArms[8]"), 0);
	assert.equal(run("marineArms[5]"), 0);
	assert.equal(Math.abs(run("marineArms[6]")), 0);
	assert.equal(run("weapon[4]"), 30);
});

test("reload drops the arms fast, holds them down, and raises them at the end", () => {
	for (const number of [1, 2, 3]) {
		const { run } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); selectMarineWeapon(${number}); weapon[4] = 0; reloadMarineGun(); updateGame(0.12);`);
		assert.ok(Math.abs(run("marineArms[8]") - 0.85) < 0.000001);
		run("updateGame(weapons[selectedWeapon][1] - 0.12 - 0.15);");
		assert.ok(Math.abs(run("marineArms[8]") - 0.85) < 0.000001);
		run("updateGame(0.075);");
		assert.ok(Math.abs(run("marineArms[8]") - 0.425) < 0.000001);
		run("updateGame(0.076);");
		assert.equal(run("marineArms[8]"), 0);
	}
});

test("shift sprints, lowers the gun, and interrupts weapon actions", () => {
	const walk = game(), sprint = game();
	for (const { run } of [walk, sprint]) run("getUnicorns().forEach(e => e[0] = 0); EArray.forEach(e => e[28] = 0); heldKeys.add('w');");
	walk.run("updateGame(0.1);");
	sprint.run("weapon[4] = 0; reloadMarineGun(); heldKeys.add('shift'); updateGame(0.1);");
	assert.ok(Math.abs(walk.run("player[6]") + 0.44) < 0.000001);
	assert.ok(Math.abs(sprint.run("player[6]") + 0.58) < 0.000001);
	assert.equal(sprint.run("reloadCooldown"), 0);
	assert.ok(Math.abs(sprint.run("marineArms[8]") - 0.85) < 0.000001);
	sprint.run("weapon[4] = 1; fireMarineGun(); reloadMarineGun();");
	assert.equal(sprint.run("weapon[4]"), 1);
	assert.equal(sprint.run("effects().filter(effect => effect[0] === 7).length"), 0);
	assert.equal(sprint.run("reloadCooldown"), 0);
});

test("walking alternates marine leg variants and stops for free camera or blocked movement", () => {
	const { run } = game();
	run("EArray.forEach(e => e[28] = 0); heldKeys.add('w'); updateGame(0.15);");
	assert.equal(run("marineLegs[15]"), 1);
	assert.equal(run("marineBody[15] === 0 && marineArms[15] === 0 && marineGun[15] === 0"), true);
	run("updateGame(0.15);");
	assert.equal(run("marineLegs[15]"), 0);
	const before = run("marineWalk");
	run("updateGame(1, true);");
	assert.equal(run("marineWalk"), before);
	run("moveActor = () => {}; updateGame(1);");
	assert.equal(run("marineWalk"), before);
	run("heldKeys.clear(); updateGame(1);");
	assert.equal(run("marineWalk"), before);
});

test("legs turn toward travel while torso and gun retain firing direction", () => {
	const { run } = game();
	run("EArray.forEach(e => e[28] = 0); marineBody[9] = 0; heldKeys.add('d'); updateGame(0.3);");
	assert.equal(run("marineBody[9]"), 0);
	assert.equal(run("marineBody[9]"), 0);
	assert.equal(run("marineGun[9]"), 0);
	assert.ok(run("marineLegs[9]") < -1.3);
	assert.ok(run("marineLegs[9]") > -Math.PI / 2);
	run("marineBody[9] = 1; updateGame(0);");
	assert.ok(Math.abs(run("wrapAngle(marineBody[9] + marineLegs[9] - marineLegYaw)")) < 0.000001);
	assert.ok(Math.abs(run("marineLegs[9]")) <= Math.PI / 2 + 0.000001);
	run("heldKeys.clear(); updateGame(0.5);");
	assert.ok(Math.abs(run("marineLegs[9]")) < 0.01);
});

test("backpedaling keeps feet forward and backward diagonals stay within ninety degrees", () => {
	for (const keys of ["w", "wa", "wd"]) {
		const { run } = game();
		// At yaw zero the marine faces +Z, while camera-relative W travels -Z.
		run(`EArray.forEach(e => e[28] = 0); getUnicorns().forEach(e => e[0] = 0); for (const key of '${keys}') heldKeys.add(key); updateGame(0.3);`);
		const angle = run("marineLegs[9]");
		assert.ok(Math.abs(angle) <= Math.PI / 2);
		if (keys === "w") assert.ok(Math.abs(angle) < 0.000001);
		else assert.ok(Math.abs(angle) > 0.6 && Math.abs(angle) < 0.8);
	}
});

test("sudden torso turns immediately clamp feet to both rotation limits", () => {
	for (const yaw of [-2.5, 2.5]) {
		const { run } = game();
		run(`marineBody[9] = ${yaw}; updateGame(0);`);
		assert.ok(Math.abs(run("marineLegs[9]")) <= Math.PI / 2 + 0.000001);
		assert.ok(Math.abs(Math.abs(run("marineLegs[9]")) - Math.PI / 2) < 0.000001);
	}
});

test("leg turning takes the shortest angle and is frame-rate independent", () => {
	const a = game(), b = game();
	for (const { run } of [a, b]) run("EArray.forEach(e => e[28] = 0); marineLegYaw = Math.PI - 0.05; marineBody[9] = -Math.PI + 0.05;");
	a.run("updateGame(0.2);");
	b.run("for (let i = 0; i < 20; i++) updateGame(0.01);");
	assert.ok(Math.abs(a.run("marineLegYaw") - b.run("marineLegYaw")) < 0.000001);
	assert.ok(Math.abs(a.run("marineLegs[9]")) < 0.01);
});

test("unicorn walk cycle alternates model variants as it moves", () => {
	const { run } = game();
	run("EArray.forEach(e => e[28] = 0);");
	assert.equal(run("getUnicorns()[0][15]"), 0);
	run("updateGame(0.2)");
	assert.equal(run("getUnicorns()[0][15]"), 1);
	run("updateGame(0.2)");
	assert.equal(run("getUnicorns()[0][15]"), 0);
});

test("walk cycle is frame-rate independent and freezes when blocked, stopped, or dead", () => {
	const coarse = game(), fine = game();
	for (const { run } of [coarse, fine]) run("EArray.forEach(e => e[28] = 0);");
	coarse.run("updateGame(0.3)");
	fine.run("for (let i = 0; i < 30; i++) updateGame(0.01);");
	assert.equal(coarse.run("getUnicorns()[0][15]"), fine.run("getUnicorns()[0][15]"));
	assert.ok(Math.abs(coarse.run("getUnicorns()[0][26]") - fine.run("getUnicorns()[0][26]")) < 0.0001);
	const before = coarse.run("getUnicorns()[0][26]");
	coarse.run("moveActor = () => {}; updateGame(1);");
	assert.equal(coarse.run("getUnicorns()[0][26]"), before);
	coarse.touch(); coarse.run("hurtCooldown = 10; updateGame(1);");
	assert.equal(coarse.run("getUnicorns()[0][26]"), before);
	coarse.run("getUnicorns()[0][25] = 0; updateGame(1);");
	assert.equal(coarse.run("getUnicorns()[0][26]"), before);
	assert.equal(coarse.run("getUnicorns()[0][15]"), 1);
});

test("unicorns must close to one unit before contact damage", () => {
	const { run, sounds } = game();
	run("getUnicorns()[0][4] = player[4] + 1.3; getUnicorns()[0][6] = player[6]; updateGame(0);");
	assert.equal(run("marineHealth"), 5);
	run("updateGame(0.1);");
	assert.equal(run("marineHealth"), 5);
	assert.ok(run("getUnicorns()[0][4] - player[4] < 1.3"));
	run("updateGame(0.1);");
	assert.equal(run("marineHealth"), 4);
	assert.equal(sounds.hurt, 1);
});

test("contact hurts once, plays a sound and pushes the marine away", () => {
	const { run, touch, sounds } = game();
	touch();
	run("updateGame(0)");
	assert.equal(run("marineHealth"), 4);
	assert.equal(sounds.hurt, 1);
	assert.equal(run("getUnicorns()[0][4]"), -1, "attacker is not knocked back");
	assert.ok(Math.abs(run("player[4]") + 2.9) < 0.00001);
	assert.ok(run("getUnicorns()[0][4] - player[4] > 1.8"));
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

test("marine damage builds rainbow coverage to 30% and fully colors the corpse", () => {
	const { run, touch } = game();
	assert.equal(run("player[11]"), 255);
	assert.equal(run("getUnicorns()[0][11]"), 249);
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
	assert.equal(run("getUnicorns()[0][3]"), 0);
});

test("fifth hit leaves a corpse and disables movement, aiming, firing and reload", () => {
	const { run, touch, sounds } = game();
	for (let i = 0; i < 5; i++) {
		const position = Array.from(run("player.subarray(4, 7)"));
		touch();
		run("updateGame(0.86)");
		if (i === 4) assert.deepEqual(Array.from(run("player.subarray(4, 7)")), position);
	}
	assert.equal(run("marineHealth"), 0);
	assert.equal(sounds.hurt, 4);
	assert.equal(sounds.explode, 1);
	assert.ok(Math.abs(run("marineBody[8]") - Math.PI / 2) < 0.001);
	const corpseX = run("player[4]");
	run("heldKeys.add('d'); weapon[4] = 10; setMarineTrigger(true); fireMarineGun(); reloadMarineGun(); aimMarineAtCursor(0, 0, 800, 600); updateGame(2)");
	assert.equal(run("player[4]"), corpseX);
	assert.equal(run("marineBody[9]"), 0);
	assert.equal(run("reloadCooldown"), 0);
	assert.equal(sounds.gunshot, 0);
	assert.equal(sounds.reload, 0);
	assert.equal(sounds.hurt, 4);
	assert.equal(sounds.explode, 1);
	assert.equal(run("player[0]"), 1, "corpse remains allocated");
	assert.equal(run("player[5]"), 0, "fallen gun rests at floor height");
	run("updateGame(4)");
	assert.equal(run("marineParts.every(part => part[0] !== 0 && part[23] === 0)"), true);
});

test("dead unicorns cannot hurt and exact overlap produces finite knockback", () => {
	const { run, touch, sounds } = game();
	touch();
	run("getUnicorns()[0][25] = 0; updateGame(0)");
	assert.equal(sounds.hurt, 0);
	run("getUnicorns()[0][25] = 4; getUnicorns()[0][4] = player[4]; updateGame(0)");
	assert.equal(sounds.hurt, 1);
	assert.ok(run("Number.isFinite(player[4]) && Number.isFinite(player[6])"));
});

test("knockback stays inside the arena and cover prevents contact damage", () => {
	const { run, touch, sounds } = game();
	run("player[4] = 14; getUnicorns()[0][4] = 13; getUnicorns()[0][6] = player[6]");
	run("updateGame(0)");
	assert.ok(run("canStand(player[4], player[6])"));
	assert.ok(run("player[4] > 14 && player[4] <= 14.55"));
	run("hurtCooldown = 0; player[4] = -6; player[6] = -5.6; getUnicorns()[0][4] = -6; getUnicorns()[0][6] = -4.4; updateGame(0)");
	assert.equal(sounds.hurt, 1);
});

test("tracers store a GPU trajectory ending at cover", () => {
	const { run } = game();
	run("getUnicorns().forEach(e => e[0] = 0); fireMarineGun();");
	const tracer = run("effects().find(effect => effect[0] === 7)");
	assert.ok(Math.abs(tracer[6] - Math.cos(tracer[9]) * tracer[14] / 2 - 30 / 64) < 0.001);
	assert.ok(tracer[14] <= 0.251);
	assert.equal(tracer[19], 242);
	const startZ = tracer[6], startY = tracer[5];
	const ttl = tracer[23];
	run("updateGame(0.05)");
	assert.equal(tracer[6], startZ);
	assert.equal(tracer[5], startY);
	assert.equal(tracer[23], ttl, "Gameplay leaves movement and TTL to compute");
	assert.ok(Math.abs(tracer[6] + tracer[22] * ttl + Math.cos(tracer[9]) * tracer[14] / 2 - 15) < 0.001);
});

test("tracer and flash originate at the model bore at every facing and scale", () => {
	for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
		const { run } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); marineBody[9] = ${yaw}; player[12] = 1.2; player[13] = 1.4; player[14] = 0.8; fireMarineGun()`);
		const angle = run("marineBody[9]");
		const expected = [
			-2 + Math.cos(angle) * 1.2 / 64 - Math.sin(angle) * 30 * 0.8 / 64,
			10.5 * 1.4 / 64,
			Math.sin(angle) * 1.2 / 64 + Math.cos(angle) * 30 * 0.8 / 64,
		];
		const flash = run("effects().find(effect => effect[0] === 6 && effect[1] > 0)");
		const tracer = run("effects().find(effect => effect[0] === 7)");
		const start = [tracer[4] + Math.sin(tracer[9]) * tracer[14] / 2, tracer[5], tracer[6] - Math.cos(tracer[9]) * tracer[14] / 2];
		for (let axis = 0; axis < 3; axis++) {
			assert.ok(Math.abs(start[axis] - expected[axis]) < 0.00001);
			assert.ok(Math.abs(flash[axis + 4] - expected[axis]) < 0.00001);
		}
	}
});

test("tracers follow hits and are absent for empty or reloading weapons", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][6] = 4; fireMarineGun()");
	const tracer = run("effects().find(effect => effect[0] === 7)");
	run("updateGame(1)");
	const endX = tracer[4] + tracer[20] * tracer[23] - Math.sin(tracer[9]) * tracer[14] / 2;
	const endZ = tracer[6] + tracer[22] * tracer[23] + Math.cos(tracer[9]) * tracer[14] / 2;
	assert.ok(Math.abs(endX - (-2 + 1/64)) < 0.001);
	assert.ok(Math.abs(endZ - 3.7) < 0.001);
	assert.equal(run("getUnicorns()[0][25]"), 3);
	run("for (const effect of effects()) effect[0] = 0; shotCooldown = 0; weapon[4] = 0; fireMarineGun(); reloadMarineGun(); fireMarineGun()");
	assert.equal(run("effects().length"), 0);
});

test("unicorn death preserves damage, rolls onto its side and gives the corpse a TTL", () => {
	const { run } = game();
	run("getUnicorns()[0][27] = 40;");
	run("getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][6] = 4; spawnUnicorn(2, 3)");
	assert.equal(run("getUnicorns()[0][3]"), 0);
	assert.equal(run("getUnicorns()[0][11]"), 249);
	for (let hit = 1; hit <= 4; hit++) {
		run("shotCooldown = 0; fireMarineGun()");
		assert.ok(Math.abs(run("getUnicorns()[0][3]") - Math.min(hit, 3) * 0.1) < 0.000001);
		assert.equal(run("getUnicorns()[0][23]"), hit < 4 ? 0 : 5);
		assert.equal(run("getUnicorns()[0][27]"), hit < 4 ? 40 : 0);
		assert.equal(run("getUnicorns()[0][25]"), 4 - hit);
		assert.equal(run("!getUnicorns()[0][25]"), hit === 4);
		assert.equal(run("getUnicorns()[1][3]"), 0);
	}
	run("shotCooldown = 0; fireMarineGun(); spawnUnicorn(3, 4)");
	assert.ok(Math.abs(run("getUnicorns()[0][3]") - 0.3) < 0.000001);
	assert.equal(run("getUnicorns()[0][8]"), 0, "head-to-tail axis stays level");
	assert.ok(Math.abs(run("getUnicorns()[0][10]") - Math.PI / 2) < 0.000001);
	assert.equal(run("getUnicorns()[0][5]"), -20 / 64);
	assert.equal(run("getUnicorns()[2][3]"), 0);
});

test("targets beyond the capped forgiveness remain misses without tracer steering", () => {
	for (const z of [2, 4, 12]) {
		const { run } = game();
		run(`getUnicorns()[0][4] = -1.5; getUnicorns()[0][6] = ${z}; fireMarineGun()`);
		assert.equal(run("getUnicorns()[0][25]"), 4);
		assert.equal(run("getUnicorns()[0][3]"), 0);
		assert.equal(Math.abs(run("effects().find(effect => effect[0] === 7)[20]")), 0);
	}
});

test("small edge misses register without steering the firing ray", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64 + 0.38; getUnicorns()[0][6] = 4; fireMarineGun()");
	assert.equal(run("getUnicorns()[0][25]"), 3);
	assert.equal(Math.abs(run("effects().find(effect => effect[0] === 7)[20]")), 0);
});

test("blood starts at the unicorn center even for an off-center hit", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64 + 0.38; getUnicorns()[0][5] = 0.2; getUnicorns()[0][6] = 4; fireMarineGun()");
	const center = Array.from(run("getUnicorns()[0].subarray(4, 7)"));
	const blood = run("effects().filter(effect => effect[19] === 249)");
	assert.equal(blood.length, 28);
	for (const drop of blood) {
		assert.deepEqual(Array.from(drop.subarray(4, 7)), center);
		assert.equal(drop[7], 0.5);
		assert.equal(drop[0], 134, "Transparent sphere draws after opaque types");
	}
});

test("blood stores velocity and TTL directly on its entity", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][6] = 4; fireMarineGun()");
	const blood = run("effects().find(effect => effect[19] === 249)");
	assert.ok(blood[21] >= .3 && blood[21] <= 1.1);
	assert.ok(blood[23] >= .9 && blood[23] <= 1.35);
	const before = Array.from(blood);
	run("updateGame(0.01)");
	assert.deepEqual(Array.from(blood), before);
});

test("a directly aimed target takes priority over a closer assisted target", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -1.6; getUnicorns()[0][6] = 3; spawnUnicorn(-2 + 1/64, 6); fireMarineGun()");
	assert.equal(run("getUnicorns()[0][25]"), 4);
	assert.equal(run("getUnicorns()[1][25]"), 3);
});

test("the first body on the firing ray wins, and cover blocks damage", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][6] = 6; spawnUnicorn(-2 + 1/64, 3); fireMarineGun()");
	assert.equal(run("getUnicorns()[0][25]"), 4);
	assert.equal(run("getUnicorns()[1][25]"), 3);
	run("shotCooldown = 0; player[4] = -6; player[6] = -7; getUnicorns()[0][4] = -6; getUnicorns()[0][6] = -3; fireMarineGun()");
	assert.equal(run("getUnicorns()[0][25]"), 4);
});

test("a muzzle reaching through cover cannot draw a backward tracer", () => {
	const { run } = game();
	run("getUnicorns().forEach(e => e[0] = 0); player[4] = -6; player[6] = -6; fireMarineGun()");
	assert.equal(run("effects().filter(effect => effect[0] === 7).length"), 0);
});

test("wall and cover hits throw short-lived sparks back from the impact", () => {
	for (const [x, z, wallZ] of [[-2, 0, 15], [-6, -7, -5.5]]) {
		const { run } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); player[4] = ${x}; player[6] = ${z}; fireMarineGun()`);
		const sparks = run("effects().filter(effect => effect[0] === 6 && effect[19] !== 246)");
		assert.equal(sparks.length, 8);
		for (const spark of sparks) {
			assert.ok(Math.abs(spark[6] - (wallZ - 0.06)) < 0.00001);
			assert.ok(spark.subarray(20, 23)[2] < 0);
			assert.ok(spark[23] >= 0.25 && spark[23] <= 0.45);
			assert.equal(spark[1], 0, "Sparks do not cast spotlight");
			assert.equal(spark[3], 0.5, "Sparks start half dissolved");
			assert.equal(spark[7], 0, "Sparks remain opaque");
			assert.equal(spark[11], 0, "Ordinary particles retain default dissolve behavior");
			assert.deepEqual(Array.from(spark.subarray(16, 19)), [0, 0, 0], "Particles sample the full sphere");
			assert.ok(spark[12] >= 0.1 && spark[12] <= 0.16);
		}
		run("updateGame(0.5)");
		assert.ok(sparks.every(spark => spark[0] === 6), "CPU gameplay does not expire particles");
	}
});

test("enemy hits, range misses and obstructed muzzles do not create wall sparks", () => {
	for (const setup of [
		"getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][6] = 4",
		"getUnicorns().forEach(e => e[0] = 0); player[6] = -10",
		"getUnicorns().forEach(e => e[0] = 0); player[4] = -6; player[6] = -5.8",
	]) {
		const { run } = game();
		run(`${setup}; fireMarineGun()`);
		assert.equal(run("effects().filter(effect => effect[0] === 6 && [242, 248].includes(effect[19])).length"), 0);
	}
});

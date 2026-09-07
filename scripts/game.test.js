import * as E from "../src/entities-const.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

// Apply the shader's entity basis and parent chain to a model-space point.
function worldPoint(entities, entity, point = [0,0,0]) {
	while (entity) {
		const [x,y,z] = point.map((n,i) => n * entity[E.SCALE+i]);
		const [p,a,r] = entity.slice(E.ROT,E.ROT+3);
		const right = x*Math.cos(r)-y*Math.sin(r), up = x*Math.sin(r)+y*Math.cos(r);
		const back = up*Math.sin(p)+z*Math.cos(p);
		point = [right*Math.cos(a)-back*Math.sin(a), up*Math.cos(p)-z*Math.sin(p), right*Math.sin(a)+back*Math.cos(a)]
			.map((n,i) => n + entity[E.POS+i]);
		entity = entity[E.PARENT] ? entities.find(e => e.id === entity[E.PARENT]) : null;
	}
	return point;
}

function game() {
	let nextEntityId = 1;
	const timers = [];
	let restarts = 0;
	const sounds = { hurt: 0, gunshot: 0, reload: 0, emptyClick: 0, explode: 0, shotgunPump: 0, wobble: 0 };
	let seed = 123456;
	const randomMath = Object.create(Math);
	randomMath.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
	const EArray = [];
	const context = vm.createContext({ E,
		EArray, getUnicorns: () => EArray.filter(e => e[0] === 2), getPortals: () => EArray.filter(e => e[0] === 12), effects: () => EArray.filter(e => e[0] !== 0 && e[23] !== 0),
		DEBUG: true, Math: randomMath, flash() {},
		setTimeout: (callback, delay) => timers.push({ callback, delay }),
		setupEntities: () => { EArray.length = 0; nextEntityId = 1; },
		heldKeys: new Set(), cameraEntity: new Float32Array(E.STRIDE), cameraPosition: [0, 5, 8], cameraRotation: [-0.5, 0, 0],
		spawn: kind => {
			let entity = EArray.find(e => e[0] === 0);
			if (!entity) {
				entity = new Float32Array(E.STRIDE);
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
	// Test-only collider fixture, independent of the packed level constructor.
	context.block = (x, z, width, height, depth, bottom = -30 / 64) => {
		const entity = context.spawn(7);
		entity.set([x, bottom + height / 2, z], E.POS);
		entity.set([width, height, depth], E.SCALE);
		entity[E.SOLID] = 1;
		return entity;
	};
	for (const file of ["level", "game"]) {
		vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url), "utf8")
			.replace(/^import .*;\r?\n/gm, "").replaceAll("export ", ""), context);
	}
	context.lightEntities = new Uint32Array(32);
	const entitySource = readFileSync(new URL("../src/entities.js", import.meta.url), "utf8");
	vm.runInContext(entitySource.slice(entitySource.indexOf("export function updateEntities"))
		.replace("export ", ""), context);
	const run = code => vm.runInContext(code, context);
	run("globalThis.initialUnicorns = getUnicorns().length; getUnicorns().slice(1).forEach(e => e[0] = 0);");
	const touch = () => run("getUnicorns()[0][4] = player[4] + 1; getUnicorns()[0][6] = player[6];");
	return { run, touch, sounds, timers };
}

test("start room contains the splash and no enemy gate", () => {
	const { run } = game();
	assert.equal(run("getPortals().length"), 4);
	assert.equal(run("getPortals().some(e => e[E.POS_X] < -7 && e[E.POS_Z] < -7)"), false);
	assert.equal(run("EArray.some(e => e[E.KIND] === 13 && e[E.POS_X] < -7 && e[E.POS_X] > -15 && e[E.POS_Z] === -11)"), true);
	assert.equal(run("EArray.some(e => e[E.KIND] === 6 && e[E.SCALE_X] === 1 && e[E.SPOTLIGHT] > 0)"), false);
});

test("initial defenders spawn at every authored position with clear footing", () => {
	const { run } = game();
	assert.equal(run("initialUnicorns"), 10);
	run("setupGame();");
	assert.equal(run("getUnicorns().length"), 10);
	assert.equal(run("getUnicorns().every(e => canStand(e[E.POS_X],e[E.POS_Z]) && e[E.PARENT] === 0)"), true);
	assert.equal(run("getPortals().every(e => Math.sin(e[E.ROT_Y]) > .99 && canStand(e[E.POS_X]-1,e[E.POS_Z]))"), true);
});

test("sections move rendering while combat and effects keep map-local coordinates", () => {
	const { run } = game();
	run("setupGame(); player.set([-22,0,20], E.POS); sections[2][E.POS_Y] = sections[4][E.POS_Y] = 8;");
	let entities = run("EArray");
	assert.equal(run("player[E.PARENT]"),0);
	assert.equal(worldPoint(entities,run("player"),[0,0,0])[1],0);
	for (const enemy of run("getUnicorns()")) assert.equal(worldPoint(entities,enemy,[0,0,0])[1],0);
	for (const gate of run("getPortals()")) assert.equal(worldPoint(entities,gate,[0,0,0])[1],gate[E.POS_Y]+8);
	run("globalThis.gate = getPortals()[0]; spawnFromPortal(gate);");
	assert.equal(run("getUnicorns().at(-1)[E.PARENT]"),0);
	assert.equal(run("getUnicorns().at(-1)[E.POS_Y]"),0);
	run("globalThis.crate = EArray.find(e => e[E.KIND] === 16 && e[E.PARENT] === sections[2].id); crate[E.HEALTH] = 1; player[E.POS_X] = crate[E.POS_X]; player[E.POS_Z] = crate[E.POS_Z]-1; firePellet(crate[E.POS_X],.1,crate[E.POS_Z]-1,0,1);");
	assert.equal(run("EArray.some(e => e[E.KIND] === 11 && e[E.PARENT] === sections[2].id)"),true);
	run("particleBurst([0,0,1],1,.1,[249],1,[0,0,0],[0,0,0],0,sections[2].id);");
	assert.equal(run("effects().at(-1)[E.POS_Y]"),0);
	assert.equal(worldPoint(entities,run("effects().at(-1)"),[0,0,0])[1],8);
	run("setupGame();");
	assert.equal(run("sections.every(e => e[E.POS_Y] === 0)"),true);
});

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

test("in-place setup restores the entire world and advances the debug camera version", () => {
	const timers = [];
	const context = vm.createContext({ E,
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
		assert.equal(run("entityVersion === oldVersion + 1"), true);
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
	assert.equal(run("getPortals().map(e => [e[E.POS_X],e[E.POS_Z],e[E.ROT_Y]]).some(([x, z, yaw]) => Math.abs(getUnicorns()[0][4] - (x - Math.sin(yaw))) < 0.00001 && Math.abs(getUnicorns()[0][6] - (z + Math.cos(yaw))) < 0.00001)"), true);
	assert.equal(run("canStand(getUnicorns()[0][4], getUnicorns()[0][6])"), true);
});

test("wall and interior pillar portals survive 49 hits and dissolve completely after hit 50", () => {
	const { run } = game();
	run("getUnicorns().forEach(e => e[0] = 0);");
	for (let index = 0; index < 5; index++) {
		run(`globalThis.portalTarget = getPortals()[0];
			globalThis.normal = marineFacing(portalTarget[9]);
			player[4] = portalTarget[4] + normal[0] * 3;
			player[6] = portalTarget[6] + normal[1] * 3;
			globalThis.shootPortal = () => firePellet(player[4], 0.2, player[6], -normal[0], -normal[1]);`);
		run("for (let hit = 0; hit < 49; hit++) shootPortal();");
		assert.equal(run("portalTarget[25]"), 1);
		assert.equal(run("portalTarget[3]"), 0);
		run("updateGame(0.1, true); updateEntities(0.1);");
		assert.ok(run("portalTarget[3] > 0 && portalTarget[3] < 0.294"));
		run("updateGame(2, true); updateEntities(2);");
		assert.ok(Math.abs(run("portalTarget[3]") - 0.294) < 0.00001);
		run("shootPortal();");
		assert.equal(run("portalTarget[25]"), 0);
		run("updateGame(0.1, true); updateEntities(0.1); shootPortal();");
		assert.ok(run("portalTarget[3] > 0.294 && portalTarget[3] < 1"));
		run("updateGame(2, true); updateEntities(2);");
		assert.equal(run("portalTarget.every(n => n === 0)"), true);
		assert.equal(run("portalTarget[1]"), 0);
		assert.equal(run("portalTarget[11]"), 0);
		assert.equal(run("portalTarget[25]"), 0);
	}
	run("getPortals().forEach(p => p[27] = 26); updateGame(2, true); updateEntities(2);");
	assert.equal(run("getUnicorns().length"), 0);
});

test("portal shots respect cover, nearer unicorns and the elliptical outline", () => {
	const { run } = game();
	// Cargo at (5, 5) blocks this ray to the south wall portal.
	run("getUnicorns().forEach(e => e[0] = 0); player[4] = 6; player[6] = 0; firePellet(6, 0.2, 0, 0, 1);");
	assert.equal(run("getPortals()[2][25]"), 50);
	// A unicorn between the gun and the north portal absorbs the hit.
	run("player[4] = 3; player[6] = -12; spawnUnicorn(3, -13); firePellet(3, 0.2, -12, 0, -1);");
	assert.equal(run("getUnicorns()[0][25]"), 3);
	assert.equal(run("getPortals()[0][25]"), 50);
	run("getUnicorns().forEach(e => e[0] = 0); firePellet(3, 2, -12, 0, -1); firePellet(4.8, 0.2, -12, 0, -1);");
	assert.equal(run("getPortals()[0][25]"), 50);
	// The wider lower arc takes hits, but its empty upper corners do not.
	run("firePellet(4.2, 0.2, -12, 0, -1);");
	assert.equal(run("getPortals()[0][25]"), 49);
	run("firePellet(4.2, 1.1, -12, 0, -1);");
	assert.equal(run("getPortals()[0][25]"), 49);
});

test("gates spawn independently every 12.5 seconds, reset age and play wobble", () => {
	const { run, sounds } = game();
	assert.equal(sounds.wobble, 10, "Initial herd plays the spawn sound");
	run("getPortals().forEach(p => p[27] = 12.49); updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(sounds.wobble, 10);
	run("getPortals().forEach(p => p[27] = 12.5); updateGame(0);");
	assert.equal(run("getUnicorns().length"), 5, "Every gate spawns, even above the old herd cap");
	assert.equal(run("getPortals().every(p => p[27] === 0)"), true);
	assert.equal(sounds.wobble, 14);
	run("updateGame(0);");
	assert.equal(sounds.wobble, 14, "Reset gates cannot spawn again immediately");
	run("getUnicorns()[2][E.POS_X] -= 2; getPortals()[1][27] = 12.5; updateGame(0);");
	assert.equal(run("getUnicorns().length"), 6);
	assert.equal(sounds.wobble, 15);
});

test("failed gate spawns retain their timer without playing wobble", () => {
	const { run, sounds } = game();
	run("getPortals()[0][27] = 26; spawn = () => null; updateGame(0);");
	assert.equal(run("getPortals()[0][27]"), 26);
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(sounds.wobble, 10);
});

test("crowded gates wait for clearance without resetting their spawn timer", () => {
	const { run, sounds } = game();
	run("globalThis.gate = getPortals()[0]; spawnFromPortal(gate); gate[E.AGE] = 12.5;");
	const count = run("getUnicorns().length"), wobble = sounds.wobble;
	run("updateGame(0);");
	assert.equal(run("getUnicorns().length"), count);
	assert.equal(run("gate[E.AGE]"), 12.5);
	assert.equal(sounds.wobble, wobble);
	run("getUnicorns().at(-1)[E.HEALTH] = 0; updateGame(0);");
	assert.equal(run("getUnicorns().length"), count + 1, "corpses do not obstruct a spawn");
	assert.equal(run("gate[E.AGE]"), 0);
});

test("portal damage advances spawning but respects crowding and destruction", () => {
	const { run } = game();
	run(`EArray.forEach(e => { e[E.SOLID] = 0; if (e[E.KIND] === 2) e[E.KIND] = 0; });
		globalThis.gate = getPortals()[0];
		hurtCooldown = 10;
		gate[E.AGE] = 11.5;
		player[E.POS_X] = gate[E.POS_X] - 3; player[E.POS_Z] = gate[E.POS_Z];
		globalThis.shootGate = () => firePellet(player[E.POS_X],gate[E.POS_Y],player[E.POS_Z],1,0);
		shootGate();`);
	assert.equal(run("gate[E.HEALTH]"), 49);
	assert.equal(run("gate[E.AGE]"), 12.5);
	run("updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(run("gate[E.AGE]"), 0);
	// Shoot from beyond the occupied exit so this pellet reaches the portal.
	run("player[E.POS_X] = gate[E.POS_X] - .5; gate[E.AGE] = 11.5; shootGate(); updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(run("gate[E.AGE]"), 12.5);
	run("getUnicorns()[0][E.KIND] = 0; updateGame(0);");
	assert.equal(run("getUnicorns().length"), 1);
	assert.equal(run("gate[E.AGE]"), 0);
	run("getUnicorns()[0][E.KIND] = 0; gate[E.HEALTH] = 1; shootGate(); updateGame(0);");
	assert.equal(run("gate[E.HEALTH]"), 0);
	assert.equal(run("getUnicorns().length"), 0);
});

test("converging unicorns keep their spacing, including large movement steps", () => {
	const { run } = game();
	run(`EArray.forEach(e => { e[E.SOLID] = 0; if (e[E.KIND] === 2) e[E.KIND] = 0; });
		for (const [x,z] of [[-2,0],[2,0],[0,-2],[0,2]]) spawnUnicorn(x,z);
		for (let i=0; i<60; i++) for (const e of getUnicorns()) moveActor(e,-e[E.POS_X],-e[E.POS_Z]);`);
	const herd = run("getUnicorns()");
	assert.equal(herd.length, 4);
	for (let i=0; i<herd.length; i++) for (let j=0; j<i; j++)
		assert.ok(Math.hypot(herd[i][E.POS_X]-herd[j][E.POS_X], herd[i][E.POS_Z]-herd[j][E.POS_Z]) >= .8-1e-6);
	assert.ok(herd.some(e => Math.hypot(e[E.POS_X],e[E.POS_Z]) < 1), "unicorns can move without colliding with themselves");
	assert.equal(run("spawnUnicorn(getUnicorns()[0][E.POS_X],getUnicorns()[0][E.POS_Z])"), false);
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
	assert.equal(run("EArray.filter(effect => effect[1] === 12).length"), 1);
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
	run("EArray.forEach(e => e[28] = 0); getUnicorns().forEach(e => e[0] = 0); spawnUnicorn(0, 8); firePellet(0, 0.1640625, 0, 0, Math.cos(0.14), Math.sin(0.14));");
	assert.equal(run("getUnicorns()[0][25]"), 4);
	run("firePellet(0, 0.1640625, 0, 0, 1, 0);");
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
	const before = run("player[E.WALK]");
	run("updateGame(1, true);");
	assert.equal(run("player[E.WALK]"), before);
	run("moveActor = () => {}; updateGame(1);");
	assert.equal(run("player[E.WALK]"), before);
	run("heldKeys.clear(); updateGame(1);");
	assert.equal(run("player[E.WALK]"), before);
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
	assert.equal(coarse.run("getUnicorns()[0][15]"), before | 0);
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
	assert.equal(sounds.hurt, 5);
	assert.equal(sounds.explode, 1);
	assert.ok(Math.abs(run("marineBody[8]") - Math.PI / 2) < 0.001);
	const corpseX = run("player[4]");
	run("heldKeys.add('d'); weapon[4] = 10; setMarineTrigger(true); fireMarineGun(); reloadMarineGun(); aimMarineAtCursor(0, 0, 800, 600); updateGame(2)");
	assert.equal(run("player[4]"), corpseX);
	assert.equal(run("marineBody[9]"), 0);
	assert.equal(run("reloadCooldown"), 0);
	assert.equal(sounds.gunshot, 0);
	assert.equal(sounds.reload, 0);
	assert.equal(sounds.hurt, 5);
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
	assert.equal(tracer[23], ttl, "Gameplay leaves movement and TTL to the shared entity update");
	assert.ok(Math.abs(tracer[6] + tracer[22] * ttl + Math.cos(tracer[9]) * tracer[14] / 2 - 15) < 0.001);
});

test("tracer and flash originate at the model bore at every facing and scale", () => {
	for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2, 0.7]) {
		const { run } = game();
		run(`getUnicorns().forEach(e => e[0] = 0); marineBody[9] = ${yaw}; player[12] = 1.2; player[13] = 1.4; player[14] = 0.8; fireMarineGun()`);
		const angle = run("marineBody[9]");
		const expected = [
			-2 + (Math.cos(angle) - Math.sin(angle) * 30) * 1.2 / 64,
			10.5 * 1.4 / 64,
			(Math.sin(angle) + Math.cos(angle) * 30) * 0.8 / 64,
		];
		const flash = worldPoint(run("EArray"), run("muzzleFlash"));
		const tracer = run("effects().find(effect => effect[0] === 7)");
		const start = [tracer[4] + Math.sin(tracer[9]) * tracer[14] / 2, tracer[5], tracer[6] - Math.cos(tracer[9]) * tracer[14] / 2];
		for (let axis = 0; axis < 3; axis++) {
			assert.ok(Math.abs(start[axis] - expected[axis]) < 0.00001);
			assert.ok(Math.abs(flash[axis] - expected[axis]) < 0.00001);
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

test("shots outside the sphere remain misses at every distance", () => {
	for (const z of [2, 4, 12]) {
		const { run } = game();
		run(`getUnicorns()[0][4] = -1.5; getUnicorns()[0][6] = ${z}; fireMarineGun()`);
		assert.equal(run("getUnicorns()[0][25]"), 4);
		assert.equal(run("getUnicorns()[0][3]"), 0);
		assert.equal(Math.abs(run("effects().find(effect => effect[0] === 7)[20]")), 0);
	}
});

test("small edge misses no longer receive aim assistance", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64 + 0.38; getUnicorns()[0][6] = 4; fireMarineGun()");
	assert.equal(run("getUnicorns()[0][25]"), 4);
	assert.equal(Math.abs(run("effects().find(effect => effect[0] === 7)[20]")), 0);
});

test("blood starts at the unicorn center even for an off-center hit", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64 + 0.18; getUnicorns()[0][5] = 0.1; getUnicorns()[0][6] = 4; fireMarineGun()");
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

test("a nearer miss does not intercept a farther direct hit", () => {
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

test("single-shot weapons use height and low cover without aim assistance", () => {
	const { run } = game();
	run("getUnicorns()[0][4] = -2 + 1/64; getUnicorns()[0][5] = 1; getUnicorns()[0][6] = 4; fireMarineGun();");
	assert.equal(run("getUnicorns()[0][25]"), 4, "a target above the firing line misses");
	run("getUnicorns()[0][5] = 0; block(-2, 2, 1, .5 - ground, .5); shotCooldown = 0; fireMarineGun();");
	assert.equal(run("getUnicorns()[0][25]"), 4, "short cover blocks a shot at muzzle height");
});

test("floor uses the same box intersection and dead targets or effects do not intercept shots", () => {
	const { run } = game();
	run(`EArray.forEach(e => e[0] = 0);
		const floor = spawn(5); floor.set([0,-32/64,0], E.POS); floor.set([32,4/64,32], E.SCALE);
		player[E.POS_X] = player[E.POS_Z] = 0;
		firePellet(0, .5, 0, 0, Math.SQRT1_2, -Math.SQRT1_2);`);
	assert.equal(run("effects().filter(e => e[E.MAT_OVERRIDE] === 242 && e[E.KIND] === 6).length"), 4);
	const { run: shoot } = game();
	shoot(`getUnicorns()[0].set([-2+1/64, 0, 2], E.POS); getUnicorns()[0][E.HEALTH] = 0;
		spawnUnicorn(-2+1/64, 4); const effect = spawn(6); effect.set([-2+1/64,0,1], E.POS); fireMarineGun();`);
	assert.equal(shoot("getUnicorns()[1][E.HEALTH]"), 3);
});

test("crates drop one marine gun on the fatal hit while the crate finishes dissolving", () => {
	const { run } = game();
	const crateCount = run("EArray.filter(e => e[E.KIND] === 16).length");
	run(`getUnicorns().forEach(e => e[0] = 0);
		globalThis.crate = EArray.find(e => e[E.KIND] === 16); globalThis.crateParent = crate[E.PARENT];
		player[E.POS_X] = crate[E.POS_X]; player[E.POS_Z] = crate[E.POS_Z] - 1;
		globalThis.shootCrate = () => firePellet(player[E.POS_X], .1, player[E.POS_Z], 0, 1);`);
	assert.equal(run("EArray.filter(e => e[E.KIND] === 16).every(e => e[E.HEALTH] === 4 && e[E.DISSOLVE_PALETTE] === 0)"), true);
	for (let hit = 1; hit <= 3; hit++) {
		run("shootCrate(); updateGame(.2, true); updateEntities(.2);");
		assert.equal(run("crate[E.HEALTH]"), 4 - hit);
		assert.ok(Math.abs(run("crate[E.DISSOLVE]") - hit * .075) < 1e-6);
		assert.equal(run("canStand(crate[E.POS_X], crate[E.POS_Z])"), false);
		assert.equal(run("crate[E.SPOTLIGHT]"), 0, "crates never inherit portal lights");
	}
	assert.equal(run("effects().filter(e => e[E.MAT_OVERRIDE] === 249).length"), 0, "wood does not bleed");
	run("globalThis.position = Array.from(crate.subarray(E.POS, E.POS + 3)); shootCrate();");
	assert.equal(run("crate[E.HEALTH]"), 0);
	assert.equal(run("crate[E.KIND]"), 16, "the model remains during collapse");
	run("globalThis.droppedGun = EArray.find(e => e[E.KIND] === 11 && e[E.PARENT] === crateParent);");
	assert.equal(run("!!droppedGun && droppedGun !== crate"), true, "gun exists immediately, before advancing the dissolve");
	assert.equal(run("droppedGun[E.POS_X] === position[0] && droppedGun[E.POS_Z] === position[2]"), true);
	assert.ok(Math.abs(run("droppedGun[E.POS_Y] - droppedGun[E.SCALE_X] / 2") - (-30/64)) < 1e-6, "gun lies on its side at the droppedGun base");
	assert.deepEqual(Array.from(run("droppedGun.subarray(E.SCALE,E.SCALE+3)")), Array.from(new Float32Array([.17,.25,.56])));
	assert.deepEqual(Array.from(run("droppedGun.subarray(E.TILE,E.TILE+3)")), [1,1,1], "whole gun model, no tiling");
	assert.ok(Math.abs(run("droppedGun[E.ROT_Z]") - Math.PI/2) < 1e-6);
	for (const slot of [E.HEALTH,E.SOLID,E.DISSOLVE,E.DISSOLVE_PALETTE,E.SPOTLIGHT,E.TTL])
		assert.equal(run(`droppedGun[${slot}]`), 0, "drop has no droppedGun damage, collision, parent, or weapon light");
	run("globalThis.drop = Array.from(droppedGun);");
	assert.equal(run("canStand(...[position[0],position[2]])"), true, "no invisible movement obstacle after destruction");
	assert.equal(run("shotFraction(position[0],position[2]-1,position[0],position[2]+1,.1)"), 1, "destroyed crate no longer blocks bullets");
	run("shootCrate(); updateGame(.5, true); updateEntities(.5);");
	assert.equal(run("crate[E.HEALTH]"), 0, "additional pellets cannot damage the collapsing crate");
	assert.ok(Math.abs(run("crate[E.DISSOLVE]") - .475) < 1e-6);
	assert.deepEqual(Array.from(run("crate.subarray(E.POS,E.POS+3)")), Array.from(run("position")), "crate does not receive an actor death pose");
	run("updateGame(2, true); updateEntities(2);");
	assert.equal(run("crate.every(n => n === 0)"), true, "crate slot clears after collapse");
	run("shootCrate(); updateGame(10, true); updateEntities(10);");
	assert.deepEqual(Array.from(run("droppedGun")).filter((_, i) => i !== E.AGE), Array.from(run("drop")).filter((_, i) => i !== E.AGE), "gun persists through crate cleanup");
	assert.equal(run("EArray.filter(e => e[E.KIND] === 11 && e[E.PARENT] === crateParent).length"), 1, "no second drop after collapse");
	assert.equal(run("EArray.filter(e => e[E.KIND] === 16).length"), crateCount - 1, "other crates stay intact");
});

test("crate cover protects a target until the fatal pellet; subsequent pellets pass through", () => {
	const { run } = game();
	run(`getUnicorns().forEach(e => e[0] = 0);
		globalThis.crate = EArray.find(e => e[E.KIND] === 16);
		player[E.POS_X] = crate[E.POS_X]; player[E.POS_Z] = crate[E.POS_Z] - 1;
		spawnUnicorn(crate[E.POS_X], crate[E.POS_Z] + 1);
		for (let hit = 0; hit < 4; hit++) firePellet(player[E.POS_X], .1, player[E.POS_Z], 0, 1);`);
	assert.equal(run("getUnicorns()[0][E.HEALTH]"), 4);
	run("firePellet(player[E.POS_X], .1, player[E.POS_Z], 0, 1);");
	assert.equal(run("getUnicorns()[0][E.HEALTH]"), 3);
});

test("one permanent muzzle flash follows the arms and reuses its 35ms timer", () => {
	const { run } = game();
	run("globalThis.flash = muzzleFlash; globalThis.stepFlash = dt => { updateGame(dt, true); updateEntities(dt); };");
	assert.equal(run("flash[E.PARENT] === marineArms.id"), true);
	assert.equal(run("flash[E.TRANSPARENCY]"), 1);
	assert.equal(run("flash[E.SPOTLIGHT]"), 0);
	assert.equal(run("flash[E.TTL]"), 0);
	assert.equal(run("marineParts.includes(flash)"), false, "flash does not inherit actor damage colors");
	run("fireMarineGun(); stepFlash(.02);");
	assert.equal(run("flash[E.TRANSPARENCY]"), 0);
	assert.equal(run("flash[E.SPOTLIGHT]"), 12);
	run("stepFlash(.016);");
	assert.equal(run("flash[E.TRANSPARENCY]"), 1);
	assert.equal(run("flash[E.SPOTLIGHT]"), 0);
	run("stepFlash(.05); selectMarineWeapon(1); fireMarineGun(); stepFlash(.02); setMarineTrigger(false); fireMarineGun(); stepFlash(.02);");
	assert.equal(run("flash[E.TRANSPARENCY]"), 0, "a new shot restarts the duration");
	run("stepFlash(.02);");
	assert.equal(run("flash[E.TRANSPARENCY]"), 1);
	assert.equal(run("EArray.filter(e => e[E.KIND] === 6 && e[E.MAT_OVERRIDE] === 246).length"), 1);
	assert.equal(run("flash === muzzleFlash"), true);
	for (const setup of ["weapon[4] = 0", "reloadCooldown = 1", "marineHealth = 0"]) {
		run(`weapon[4] = 10; reloadCooldown = 0; marineHealth = 5; setMarineTrigger(false); ${setup}; fireMarineGun();`);
		assert.equal(run("flash[E.SPOTLIGHT]"), 0, "blocked firing cannot reactivate the flash");
	}
});

test("attached flash stays on the model bore through arm poses and parent transforms", () => {
	const { run } = game();
	for (const pose of [0, .3, .85]) {
		run(`player.set([3,.4,-2], E.POS); player.set([1.2,1.4,.8], E.SCALE);
			marineBody[E.ROT_Y] = .7; marineArms[E.ROT_X] = ${pose};
			marineArms[E.POS_Y] = .03; marineArms[E.POS_Z] = -.02;`);
		const entities = run("EArray");
		const actual = worldPoint(entities, run("muzzleFlash"));
		const bore = worldPoint(entities, run("marineGun"), [5/16-.5, 12.5/20-.5, 30/32-.5]);
		for (let i=0;i<3;i++) assert.ok(Math.abs(actual[i]-bore[i]) < 1e-6);
	}
});

test("permanent flash survives entity updates and only contributes light while active", () => {
	const context = vm.createContext({ E, DEBUG:true, heldKeys:new Set(), cameraFov:60,
		GenArray:(n,fn)=>Array.from({length:n},(_,i)=>fn(i)), setTimeout(){},
		sound:{wobble(){}, gunshot(){}, hurt(){}, explode(){}} });
	for (const file of ["entities","level","game"])
		vm.runInContext(readFileSync(new URL(`../src/${file}.js`, import.meta.url),"utf8").replace(/^import .*;\r?\n/gm,"").replaceAll("export ",""),context);
	const run = code => vm.runInContext(code,context);
	run("updateEntities(0);");
	assert.equal(run("lightEntities.includes(muzzleFlash.id)"), false);
	run("fireMarineGun(); updateEntities(.01);");
	assert.equal(run("lightEntities.includes(muzzleFlash.id)"), true);
	run("updateGame(.04,true); updateEntities(100);");
	assert.equal(run("lightEntities.includes(muzzleFlash.id)"), false);
	assert.equal(run("muzzleFlash[E.KIND]"), 6);
	assert.equal(run("muzzleFlash[E.DISSOLVE]"), 0);
	assert.deepEqual(Array.from(run("muzzleFlash.subarray(E.POS,E.POS+3)")), [1/64,10.5/64,30/64]);
});

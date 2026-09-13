import * as E from "./entities-const.js";
import { heldKeys } from "./globals.js";
import { flash } from "./render.js";
import { cameraEntity, cameraRotation, spawn, EArray, setupEntities } from "./entities.js";
import * as sound from "./sfx.js";
import { collisionPosition, canStand, moveActor, clearShot, shotFraction, entityShotFraction, setupLevel, sections } from "./level.js";

function placeActor(type, x, z, parent) {
	if (type === 11) return spawnUnicorn(x, z);
	const portal = spawn(12);
	// Local +Z points out of the arch, toward its spawn area.
	portal[E.SPOTLIGHT] = 2.1;
	portal[E.LIGHT_ANGLE] = 2.772;
	portal.set([x, 0.1875, z], E.POS);
	portal[E.ROT_Y] = (type === 10 ? 1 : type - 17) * Math.PI / 2;
	portal.set([3.6, 3, 0.45], E.SCALE);
	portal.fill(0, E.TILE, E.TILE + 3);
	portal[E.HEALTH] = portal[E.MAX_HEALTH] = 50;
	portal[E.UNICORN_INTERVAL] = 12.5;
	portal[E.DISSOLVE_RATE] = 0.5;
	portal[E.HIT_RADIUS] = 24.5 / 64;
	portal[E.PARENT] = parent;
}

function spawnUnicorn(x, z, y = 0) {
	if (!canStand(x, z, 0.45, true)) return false;
	const unicorn = spawn(2);
	const head = spawn(18);
	// Shared model coordinates, like the marine: the torso is the gameplay root.
	head[E.PARENT] = unicorn.id;
	head.fill(0, E.TILE, E.TILE + 3);
	unicorn.set([x, y, z], E.POS);
	unicorn[E.DISSOLVE_PALETTE] = 249;
	unicorn[E.HEALTH] = 4;
	unicorn[E.WALK_STRIDE] = 0.35;
	unicorn[E.HIT_RADIUS] = 0.3;
	unicorn[E.HIT_CENTER_Y] = 10.5 / 64;
	lastSpawnedUnicorn = unicorn;
	sound.wobble();
	return true;
}

// Spawners reinforce the placed defenders on their own age timers.
function spawnFromEntity(entity) {
	// Spawn on the playable floor, using the same translated position as collisions.
	return collisionPosition(entity, 1, true) === entity[E.POS_Y] && spawnUnicorn(
		collisionPosition(entity, 0) - (entity[E.KIND] !== 12 || Math.sin(entity[E.ROT_Y])),
		collisionPosition(entity, 2) + (entity[E.KIND] === 12 && Math.cos(entity[E.ROT_Y])));
}

// Capacity, reload seconds, shot interval, pellet count.
const weapons = [
	[12, 1.15, 0, 1],
	[30, 2.5875, 0.08, 1],
	[8, 2.3, 0.7, 12],
];
let player, marineParts, marineLegs, marineBody, marineArms, marineGun, muzzleFlash, lastSpawnedUnicorn;
let selectedWeapon, weapon, triggerConsumed, shotgunPumpPending, shotCooldown, triggerHeld, emptyClickPlayed;
let ownedWeapons, cratesBroken;
let gameTime;
let reloadCooldown, marineLegYaw, hurtCooldown, portals, elevatorSide, elevatorFinished;

export function setupGame() {
	gameTime = 0;
	setupEntities();
	setupLevel(placeActor);
	portals = 5;
	heldKeys.clear();
	player = spawn(1);
	// Translation-only root: body aiming and death poses must not rotate the camera.
	player[E.POS_X] = -11;
	player[E.POS_Z] = -13.5;
	player[E.WALK_STRIDE] = 0.65;
	cameraEntity[E.PARENT] = player.id;

	// Permanent floor inlay, with only a thin gold surface exposed.
	const logo = spawn(13);
	logo.set([-11, -30 / 64, -11.5], E.POS);
	logo.set([-Math.PI / 2, cameraRotation[1], 0], E.ROT);
	logo.set([5.25, 5.25, 0.05], E.SCALE);
	logo.fill(0, E.TILE, E.TILE + 3);
	logo[E.PARENT] = sections[0].id;

	player[E.DISSOLVE_PALETTE] = 255; // Dissolve into the procedural rainbow material.
	// Parts share the original centered model frame; body carries the overall pose.
	marineParts = [8, 9, 10, 11].map(spawn);
	[marineLegs, marineBody, marineArms, marineGun] = marineParts;
	marineBody[E.PARENT] = player.id;
	marineLegs[E.PARENT] = marineBody.id;
	marineArms[E.PARENT] = marineBody.id;
	marineGun[E.PARENT] = marineArms.id;
	marineGun.set([0.0475, 0.1328125, 0.22375], E.POS);
	marineGun.set([0.17, 0.25, 0.56], E.SCALE);
	marineGun[E.SPOTLIGHT] = 10.5;
	marineGun[E.LIGHT_ANGLE] = Math.PI / 6; // 30-degree flashlight cone along the gun's +Z.

	for (const part of marineParts) {
		part[E.DISSOLVE_PALETTE] = 255;
		part.fill(0, E.TILE, E.TILE + 3);
	}
	marineGun.fill(1, E.TILE, E.TILE + 3);
	// Permanent flash follows the arms through aiming, movement, and reload poses.
	muzzleFlash = spawn(6);
	muzzleFlash[E.PARENT] = marineArms.id;
	muzzleFlash.set([1 / 64, 10.5 / 64, 30 / 64], E.POS);
	muzzleFlash.fill(0.14, E.SCALE, E.SCALE + 3);
	muzzleFlash.fill(0, E.TILE, E.TILE + 3);
	muzzleFlash[E.MAT_OVERRIDE] = 246;
	muzzleFlash[E.TRANSPARENCY] = 1;

	selectedWeapon = cratesBroken = 0;
	ownedWeapons = [0];
	for (const entry of weapons) entry[4] = entry[0];
	weapon = weapons[selectedWeapon];
	triggerConsumed = false;
	shotgunPumpPending = false;
	shotCooldown = 0;
	triggerHeld = false;
	emptyClickPlayed = false;

	reloadCooldown = 0;
	marineLegYaw = 0;
	player[E.HEALTH] = 7;
	hurtCooldown = 0;
	elevatorSide = elevatorFinished = 0;
}
setupGame();

const clockDigits = n => ("" + (n | 0)).padStart(2, "0");
const random = (minimum, range) => minimum + Math.random() * range;
const isSprinting = () =>
	player[E.HEALTH] &&
	heldKeys.has("shift") &&
	(heldKeys.has("w") || heldKeys.has("a") || heldKeys.has("s") || heldKeys.has("d"));
const heading = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
// Voxel characters and their weapons are authored facing local +Z, while the
// engine's transform forward points down local -Z.
const lookAtYaw = (dx, dz) => Math.atan2(dx, -dz) + Math.PI;
const clampLeg = (angle) => Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const marineFacing = (yaw) => [-Math.sin(yaw), Math.cos(yaw)];

// Configurable bursts share emission, fading, gravity, and floor settling.
function particleBurst(
	position,
	count,
	scale,
	materials,
	lifetime,
	velocity,
	spread,
	transparency,
	parent,
) {
	for (let i = 0; i < count; i++) {
		const entity = spawn(transparency > 0 ? 134 : 6);
		entity.set(position, E.POS);
		entity[E.PARENT] = parent;
		entity[E.TRANSPARENCY] = transparency;
		entity.fill(random(scale, scale * 0.6), E.SCALE, E.SCALE + 3);
		entity.fill(0, E.TILE, E.TILE + 3);
		entity[E.MAT_OVERRIDE] = materials[i % materials.length];
		entity[E.DISSOLVE] = 0.5;
		entity[E.TTL] = random(lifetime, lifetime * 0.5);
		entity[E.DISSOLVE_RATE] = 0.5 / entity[E.TTL];
		entity[E.DISSOLVE_TARGET] = 1;
		entity[E.GRAVITY] = 9;
		entity.set(
			velocity.map((value, axis) => value + random(-spread[axis] / 2, spread[axis])),
			E.VELOCITY,
		);
	}
}

export function toggleMarineFlashlight() {
	marineGun[E.SPOTLIGHT] = marineGun[E.SPOTLIGHT] ? 0 : 10.5;
	sound.emptyClick();
}

export function selectMarineWeapon(number = (selectedWeapon === 1 ? ownedWeapons[0] : 1) + 1) {
	const next = number - 1;
	if (!player[E.HEALTH] || !ownedWeapons.includes(next) || next === selectedWeapon) return;

	selectedWeapon = next;
	flash(["Pistol", "Rifle", "Shotgun"][next]);
	shotgunPumpPending = false;
	weapon = weapons[next];
	reloadCooldown = 0;
	setMarineTrigger(false);
	marineArms[E.ROT_X] = marineArms[E.POS_Y] = marineArms[E.POS_Z] = 0;
}

// Colored damage reaches 30% before death; eroding props reserve their final
// collapse for death. All health-driven dissolve uses this one calculation.
function updateDamageDissolve(entity, health, maximum) {
	const goal = health ? ((maximum - health) * 0.3) / (maximum - (entity[E.DISSOLVE_PALETTE] > 0)) : 1;
	entity[entity[E.DISSOLVE_RATE] ? E.DISSOLVE_TARGET : E.DISSOLVE] = goal;
}

export function fireMarineGun() {
	if (selectedWeapon !== 1 && triggerConsumed) return;
	if (!player[E.HEALTH] || isSprinting() || reloadCooldown > 0 || (DEBUG && player[E.KIND] === 0)) return;
	if (weapon[4] === 0) {
		if (!emptyClickPlayed) sound.emptyClick();
		emptyClickPlayed = true;
		return;
	}
	if (shotCooldown > 0) return;

	shotCooldown = weapon[2];
	shotgunPumpPending = selectedWeapon === 2;
	triggerConsumed = true;
	sound.gunshot();
	weapon[4]--;

	const [forwardX, forwardZ] = marineFacing(marineBody[E.ROT_Y]);
	// The compact gun's transform keeps its bore at the established muzzle point.
	const muzzleX = player[E.POS_X] + ((forwardX * 30 + forwardZ) * player[E.SCALE_X]) / 64;
	const muzzleY = player[E.POS_Y] + (10.5 / 64) * player[E.SCALE_Y];
	const muzzleZ = player[E.POS_Z] + ((forwardZ * 30 - forwardX) * player[E.SCALE_Z]) / 64;
	// Reuse the attached flash for every weapon, including a whole shotgun volley.
	muzzleFlash[E.AGE] = 0;
	muzzleFlash[E.TRANSPARENCY] = 0;
	muzzleFlash[E.SPOTLIGHT] = 12;

	const pellets = weapon[3]; // A crate unlock can change weapons during this shot.
	for (let pellet = 0; pellet < pellets; pellet++) {
		// Uniform solid-angle sampling in an eight-degree cone around the bore.
		const cosine = pellets === 1 ? 1 : 1 - Math.random() * (1 - Math.cos(0.14));
		const radial = Math.sqrt(1 - cosine * cosine);
		const angle = pellets === 1 ? 0 : random(0, Math.PI * 2);
		const side = radial * Math.cos(angle),
			vertical = radial * Math.sin(angle);
		firePellet(
			player,
			muzzleX,
			muzzleY,
			muzzleZ,
			forwardX * cosine - forwardZ * side,
			forwardZ * cosine + forwardX * side,
			vertical,
		);
	}
}

// Bullets hit anything except their firing entity.
export function firePellet(shooter, muzzleX, muzzleY, muzzleZ, forwardX, forwardZ, forwardY) {
	let target;
	const bulletRange = 14;
	let range = shotFraction(shooter[E.POS_X], shooter[E.POS_Z], muzzleX, muzzleZ, muzzleY) < 1 ? 0 : bulletRange;
	let closest = range;
	const origin = [muzzleX, muzzleY, muzzleZ];
	const direction = [forwardX * bulletRange, forwardY * bulletRange, forwardZ * bulletRange];
	for (const entity of EArray) {
		if (entity === shooter || !entity[E.KIND] || !(entity[E.SOLID] || entity[E.HEALTH] || entity[E.KIND] === 5)) continue;
		const distance = bulletRange * entityShotFraction(entity, origin, direction);
		if (distance < bulletRange && (distance < closest || (distance === closest && entity[E.SOLID]))) {
			closest = distance;
			target = entity[E.HEALTH] ? entity : undefined;
		}
	}
	range = closest;

	const traceX = forwardX * closest;
	const traceZ = forwardZ * closest;
	const traceY = forwardY * closest;
	const hitX = muzzleX + traceX;
	const hitZ = muzzleZ + traceZ;
	if (traceX * forwardX + traceZ * forwardZ > 0.05) {
		const tracer = spawn(7);
		const distance = closest; // Pellet directions are unit vectors.
		const length = Math.min(0.25, distance);
		tracer.set(
			[
				muzzleX + (forwardX * length) / 2,
				muzzleY + (forwardY * length) / 2,
				muzzleZ + (forwardZ * length) / 2,
			],
			E.POS,
		);
		tracer[E.PARENT] = shooter[E.PARENT];
		tracer.set([0.035, 0.035, length], E.SCALE);
		tracer[E.ROT_Y] = Math.atan2(-traceX, traceZ);
		tracer[E.ROT_X] = -Math.asin(forwardY);
		tracer[E.MAT_OVERRIDE] = 254; // Emissive yellow, above the bloom threshold.
		tracer[E.SPOTLIGHT] = 2;
		tracer[E.LIGHT_ANGLE] = Math.PI / 2;
		tracer.set([forwardX * 45, forwardY * 45, forwardZ * 45, (distance - length) / 45 || -1], E.VELOCITY);
	}
	if (!target) {
		if (range && range < bulletRange) {
			particleBurst(
				[hitX - forwardX * 0.06, muzzleY + traceY - forwardY * 0.06, hitZ - forwardZ * 0.06],
				8,
				0.1,
				[242, 248],
				0.25,
				[-forwardX * 2.5, 1.5, -forwardZ * 2.5],
				[1, 2, 1],
				0,
				shooter[E.PARENT],
			);
		}
		return;
	}
	if (target === player) return hurtCooldown || hurtMarine();
	target[E.HEALTH]--;
	if (target[E.UNICORN_INTERVAL]) target[E.AGE] += 1; // Damage accelerates active spawners.
	if (!target[E.HEALTH]) target[E.UNICORN_INTERVAL] = 0;
	if (target[E.DISSOLVE_RATE]) {
		updateDamageDissolve(target, target[E.HEALTH], target[E.MAX_HEALTH]);
		if (!target[E.HEALTH]) {
			target[E.SOLID] = 0;
			if (target[E.KIND] === 12) flash(--portals ? portals + " PORTALS REMAIN" : "YOU WIN! " + clockDigits(gameTime / 60) + ":" + clockDigits(gameTime % 60));
			if (target[E.KIND] === 16) {
				if (++cratesBroken === 1) {
					ownedWeapons.push(1);
					flash("Rifle: Q to switch");
				} else if (target[E.CONTENTS] === 2) {
					ownedWeapons[0] = 2;
					selectMarineWeapon(3);
				} else if (target[E.CONTENTS] === 1) {
					player[E.HEALTH] = Math.min(7, player[E.HEALTH] + 1);
					updateDamageDissolve(player, player[E.HEALTH], 7);
					flash("+1 HP");
				} else flash("Empty");
			}
		}
		return;
	}
	particleBurst(
		target.subarray(E.POS, E.POS + 3),
		28,
		0.06,
		[249],
		0.9,
		[0, 0.7, 0],
		[2, 0.8, 2],
		0.5,
		target[E.PARENT],
	);
	if (target[E.HEALTH]) updateDamageDissolve(target, target[E.HEALTH], 4);
	if (target[E.HEALTH] <= 0) {
		// Roll onto the side, keeping the head-to-tail axis level.
		target[E.ROT_X] = 0;
		target[E.TTL] = 5;
		target[E.AGE] = 0;
		target[E.ROT_Z] = Math.PI / 2;
		target[E.POS_Y] = -20 / 64;
	}
}

export function setMarineTrigger(held) {
	triggerHeld = held && player[E.HEALTH];
	if (!held) {
		emptyClickPlayed = false;
		triggerConsumed = false;
	}
}

export function reloadMarineGun() {
	if (
		!player[E.HEALTH] ||
		isSprinting() ||
		reloadCooldown > 0 ||
		weapon[4] === weapon[0] ||
		(DEBUG && player[E.KIND] === 0)
	)
		return;
	reloadCooldown = weapon[1];
	shotgunPumpPending = false;
	sound.reload(weapon[1]);
}

export function aimMarineAtCursor(index, x, z) {
	if (player[E.HEALTH] && z !== undefined && EArray[index][E.KIND] >> 2 != 2)
		marineBody[E.ROT_Y] = lookAtYaw(x - player[E.POS_X], z - player[E.POS_Z]);
}

// FPS aiming has no cursor hit when the reticle points into open space.
export function aimMarineAtYaw(yaw) {
	if (player[E.HEALTH]) marineBody[E.ROT_Y] = yaw + Math.PI;
}

export function debugUnlockElevator() {
	if (DEBUG) portals = 0;
}

export function activateConsole(entity) {
	if (entity[E.CONTROLLER] !== sections[0].id) {
		entity[E.MODEL_VARIANT] ^= 1;
		return;
	}
	// The lift opens after both Cargo portals are cleared.
	if (!entity[E.MODEL_VARIANT] && !sections[0][E.POS_Y] && portals > 3) {
		flash(`LOCKED: PORTALS NEARBY`);
		return;
	}
	if (!entity[E.MODEL_VARIANT] && !sections[0][E.POS_Y]) {
		// The ride is a self-contained encounter; remove defenders left elsewhere.
		for (const target of EArray) if (target[E.KIND] === 2 || target[E.KIND] === 18) target.fill(0);
		elevatorSide = elevatorFinished = 0;
	}
	entity[E.MODEL_VARIANT] ^= 1;
}

function spawnElevatorWave(count) {
	let spawned = false;
	for (let lane = 0; lane < count; lane++) {
		// Alternate the two open ends of the deck; extra members use the next lane.
		const side = elevatorSide++ & 1;
		const x = -19 + 1.5 * ((lane / 2) | 0);
		const outsideZ = side ? 14 : 26;
		const landingZ = side ? 18 : 22;
		if (spawnUnicorn(x, outsideZ, 4)) {
			lastSpawnedUnicorn[E.TARGET_POSITION_Z] = landingZ;
			spawned = true;
		}
	}
	return spawned;
}

function hurtMarine() {
	player[E.HEALTH]--;
	// Four surviving hits ramp rainbow coverage from 0% to 30%.
	updateDamageDissolve(player, player[E.HEALTH], 7);
	hurtCooldown = 0.85;
	player[E.MAT_OVERRIDE] = player[E.HEALTH] ? 117 : 0;
	sound.hurt();
	if (!player[E.HEALTH]) {
		setTimeout(setupGame, 5000);
		sound.explode();
		triggerHeld = false;
		reloadCooldown = 0;
		marineBody[E.ROT_X] = Math.PI / 2;
		player[E.POS_Y] = 0;
	}
}

export function updateGame(deltaTime, freeCamera = false) {
	if (player[E.HEALTH] && portals) gameTime += deltaTime;
	// Arrival waves accelerate down the shaft: singles, then pairs, then a final trio.
	const rideProgress = sections[0][E.POS_Y] / 40;
	if (player[E.HEALTH] && !elevatorFinished && rideProgress > 0 && rideProgress < 1) {
		const waveSize = rideProgress >= 0.85 ? 3 : rideProgress >= 0.5 ? 2 : 1;
		const interval = 6 - 3 * rideProgress;
		if (sections[3][E.AGE] >= interval && spawnElevatorWave(waveSize)) {
			sections[3][E.AGE] = 0;
			elevatorFinished = waveSize === 3;
		}
	}
	if (muzzleFlash[E.AGE] + deltaTime >= 0.035) {
		muzzleFlash[E.TRANSPARENCY] = 1;
		muzzleFlash[E.SPOTLIGHT] = 0;
	}
	for (const entity of EArray) {
		if (player[E.HEALTH] && entity[E.UNICORN_INTERVAL] && entity[E.AGE] >= entity[E.UNICORN_INTERVAL] && spawnFromEntity(entity)) entity[E.AGE] = 0;
		if (entity[E.KIND] === 12) entity[E.SPOTLIGHT] = 2.1 * (1 - entity[E.DISSOLVE]);
	}
	const sprinting = !freeCamera && isSprinting();
	hurtCooldown = Math.max(0, hurtCooldown - deltaTime);
	player[E.MAT_OVERRIDE] = hurtCooldown > 0.65 && player[E.HEALTH] ? 117 : 0;
	shotCooldown = Math.max(0, shotCooldown - deltaTime);
	if (sprinting) {
		reloadCooldown = 0;
		shotgunPumpPending = false;
	}
	if (shotgunPumpPending && shotCooldown === 0) {
		shotgunPumpPending = false;
		if (player[E.HEALTH] && weapon[4] && reloadCooldown <= 0) sound.shotgunPump();
	}
	if (reloadCooldown > 0) {
		reloadCooldown -= deltaTime;
		if (reloadCooldown <= 0) weapon[4] = weapon[0];
	}
	if (!sprinting && triggerHeld && selectedWeapon === 1) fireMarineGun();
	const moveX = heldKeys.has("d") - heldKeys.has("a");
	const moveZ = heldKeys.has("w") - heldKeys.has("s");
	let legTarget = marineBody[E.ROT_Y];
	if (!freeCamera && player[E.HEALTH] && (moveX || moveZ)) {
		const [forwardX, forwardZ] = heading(cameraRotation[1]);
		const length = Math.hypot(moveX, moveZ);
		const dx = (-forwardZ * moveX + forwardX * moveZ) / length;
		const dz = (forwardX * moveX + forwardZ * moveZ) / length;
		const x = player[E.POS_X],
			z = player[E.POS_Z];
		moveActor(player, dx * (sprinting ? 5.8 : 4.4) * deltaTime, dz * (sprinting ? 5.8 : 4.4) * deltaTime);
		const moved = Math.hypot(player[E.POS_X] - x, player[E.POS_Z] - z);
		if (moved > 0.00001) legTarget = lookAtYaw(player[E.POS_X] - x, player[E.POS_Z] - z);
	}
	if (player[E.HEALTH] && !freeCamera) {
		// Backpedal instead of turning the feet around behind the torso.
		let target = wrapAngle(legTarget - marineBody[E.ROT_Y]);
		if (Math.abs(target) > Math.PI / 2 + 0.000001) target -= Math.sign(target) * Math.PI;
		target = clampLeg(target);
		const current = clampLeg(wrapAngle(marineLegYaw - marineBody[E.ROT_Y]));
		marineLegs[E.ROT_Y] = current + (target - current) * (1 - Math.exp(-12 * deltaTime));
		marineLegYaw = marineBody[E.ROT_Y] + marineLegs[E.ROT_Y];
	}

	for (const entity of EArray) {
		if (entity[E.KIND] !== 2 || !entity[E.HEALTH] || !player[E.HEALTH]) continue;
		// A two-second leap from either open end lands one unit inside its rail.
		if (entity[E.POS_Y] > 0) {
			const t = Math.min(2, entity[E.AGE]);
			entity[E.POS_Y] = 4 + t * (6 - 4 * t);
			entity[E.POS_Z] += ((entity[E.TARGET_POSITION_Z] - entity[E.POS_Z]) * t) / 2;
			continue;
		}
		const dx = player[E.POS_X] - entity[E.POS_X];
		const dz = player[E.POS_Z] - entity[E.POS_Z];
		const distance = Math.hypot(dx, dz);
		if (distance > 1) {
			const step = Math.min(2.457 * deltaTime, distance - 0.8);
			moveActor(entity, (dx / distance) * step, (dz / distance) * step);
			entity[E.ROT_Y] = lookAtYaw(dx, dz);
		}
		if (
			hurtCooldown === 0 &&
			Math.hypot(player[E.POS_X] - entity[E.POS_X], player[E.POS_Z] - entity[E.POS_Z]) <= 1 &&
			clearShot(player[E.POS_X], player[E.POS_Z], entity[E.POS_X], entity[E.POS_Z])
		) {
			hurtMarine();
			if (player[E.HEALTH]) {
				const pushX = distance > 0.001 ? dx / distance : -Math.sin(entity[E.ROT_Y]);
				const pushZ = distance > 0.001 ? dz / distance : Math.cos(entity[E.ROT_Y]);
				moveActor(player, pushX * 0.9, pushZ * 0.9);
			}
		}
	}

	// Quick lower, hold for the reload, then quick return to the firing pose.
	const reloadPose = sprinting
		? 1
		: Math.max(0, Math.min(1, (weapon[1] - reloadCooldown) / 0.12, reloadCooldown / 0.15));
	const reloadAngle = 0.85 * reloadPose * reloadPose * (3 - 2 * reloadPose);
	marineArms[E.ROT_X] = reloadAngle;
	marineArms[E.POS_Y] = (12 / 64) * (1 - Math.cos(reloadAngle));
	marineArms[E.POS_Z] = -(12 / 64) * Math.sin(reloadAngle);
	marineLegs[E.MODEL_VARIANT] = player[E.MODEL_VARIANT];
	// Keep damage and hit flashes consistent across the articulated marine.
	for (const part of marineParts) {
		for (const slot of [E.DISSOLVE, E.DISSOLVE_PALETTE, E.MAT_OVERRIDE]) part[slot] = player[slot];
	}
}

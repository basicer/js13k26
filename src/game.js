import * as E from "./entities-const.js";
import { heldKeys, cameraFov } from "./globals.js";
import { cameraEntity, cameraPosition, cameraRotation, spawn, EArray, setupEntities } from "./entities.js";
import * as sound from "./sfx.js";
import { canStand, moveActor, clearShot, shotFraction, entityShotFraction, setupLevel } from "./level.js";

// Wall centers and yaw; keep the camera-side (-X) wall free of portals.
const portalLocations = [
	[3, -15, 0],
	[15, 4, Math.PI / 2],
	[6, 15, Math.PI],
	[-7, -15, 0],
	[7.5, 0, Math.PI / 2], // Camera-facing side of the interior pillar at (9, 0).
];

function spawnUnicorn(x, z) {
	if (!canStand(x, z)) return false;
	const unicorn = spawn(2);
	if (!unicorn) return;
	unicorn[E.POS_X] = x;

	unicorn[E.POS_Z] = z;
	unicorn[E.DISSOLVE_PALETTE] = 249;
	unicorn[E.HEALTH] = 4;
	unicorn[E.WALK_STRIDE] = .35;
	unicorn[E.HIT_RADIUS] = .3;
	unicorn[E.HIT_CENTER_Y] = 10.5 / 64;
	sound.wobble();
	return true;
}

// Start with a herd; each surviving gate then spawns on its own age timer.
function spawnFromPortal(entity) {
	// Leave enough room for the unicorn's collision radius in front of the wall.
	return spawnUnicorn(entity[E.POS_X] - Math.sin(entity[E.ROT_Y]), entity[E.POS_Z] + Math.cos(entity[E.ROT_Y]));
}

// Capacity, reload seconds, shot interval, pellet count.
const weapons = [
	[12, 1.15, 0, 1],
	[30, 2.5875, 0.08, 1],
	[8, 2.3, 0.7, 12],
];
let player, marineParts, marineLegs, marineBody, marineArms, marineGun, muzzleFlash;
let selectedWeapon, weapon, triggerConsumed, shotgunPumpPending, shotCooldown, triggerHeld, emptyClickPlayed;
let reloadCooldown, marineLegYaw, marineHealth, hurtCooldown;

export function setupGame() {
	setupEntities();
	setupLevel();
	heldKeys.clear();
	player = spawn(1);
	// Translation-only root: body aiming and death poses must not rotate the camera.
	player[E.POS_X] = -2;
	player[E.WALK_STRIDE] = .65;
	cameraEntity[E.PARENT] = player.id;

	// Startup is paused, so the splash's lifetime begins with the first input.
	const logo = spawn(13);
	// Large, slightly reclined floor sculpture, matching the startup composition.
	logo.set([-0.7, 0.894, 0], E.POS);
	logo.set([-0.32, cameraRotation[1], 0], E.ROT);
	logo.set([5.25, 5.25, 1.3], E.SCALE);
	logo[E.TILE_X] = logo[E.TILE_Y] = logo[E.TILE_Z] = 0;
	logo[E.TTL] = 0.1;
	const logoLight = spawn(1);
	logoLight.set([-5, 2, 1], E.POS);
	logoLight[E.SPOTLIGHT] = 8;
	logoLight[E.TTL] = 0.1;

	player[E.DISSOLVE_PALETTE] = 255; // Dissolve into the procedural rainbow material.

	// Parts share the original centered model frame; body carries the overall pose.
	marineParts = [8, 9, 10, 11].map((kind) => spawn(kind));
	[marineLegs, marineBody, marineArms, marineGun] = marineParts;
	marineBody[E.PARENT] = player.id;
	marineLegs[E.PARENT] = marineBody.id;
	marineArms[E.PARENT] = marineBody.id;
	marineGun[E.PARENT] = marineArms.id;
	marineGun[E.POS_X] = 0.0475;
	marineGun[E.POS_Y] = 0.1328125;
	marineGun[E.POS_Z] = 0.22375;
	marineGun[E.SCALE_X] = 0.17;
	marineGun[E.SCALE_Y] = 0.25;
	marineGun[E.SCALE_Z] = 0.56;
	marineGun[E.SPOTLIGHT] = 8.4;
	marineGun[E.LIGHT_ANGLE] = Math.PI / 6; // 30-degree flashlight cone along the gun's +Z.

	for (const part of marineParts) {
		part[E.DISSOLVE_PALETTE] = 255;
		part[E.TILE_X] = part[E.TILE_Y] = part[E.TILE_Z] = 0;
	}
	marineGun[E.TILE_X] = marineGun[E.TILE_Y] = marineGun[E.TILE_Z] = 1;
	// Permanent flash follows the arms through aiming, movement, and reload poses.
	muzzleFlash = spawn(6);
	muzzleFlash[E.PARENT] = marineArms.id;
	muzzleFlash.set([1 / 64, 10.5 / 64, 30 / 64], E.POS);
	muzzleFlash[E.SCALE_X] = muzzleFlash[E.SCALE_Y] = muzzleFlash[E.SCALE_Z] = .14;
	muzzleFlash[E.TILE_X] = muzzleFlash[E.TILE_Y] = muzzleFlash[E.TILE_Z] = 0;
	muzzleFlash[E.MAT_OVERRIDE] = 246;
	muzzleFlash[E.TRANSPARENCY] = 1;


	for (const [x, z, yaw] of portalLocations) {
		const portal = spawn(12);
		// Local +Z points out of the arch, toward its spawn area.
		portal[E.SPOTLIGHT] = 2.1;
		portal[E.LIGHT_ANGLE] = 2.772;
		portal.set([x, 0.1875, z], E.POS);
		portal[E.ROT_Y] = yaw;
		portal.set([3.6, 3, 0.45], E.SCALE);
		portal[E.TILE_X] = portal[E.TILE_Y] = portal[E.TILE_Z] = 0;
		portal[E.HEALTH] = portal[E.MAX_HEALTH] = 50;
		portal[E.DISSOLVE_RATE] = .5;
		portal[E.HIT_RADIUS] = 24.5 / 64;
	}

	for (const entity of EArray) if (entity[E.KIND] === 12) spawnFromPortal(entity);
	selectedWeapon = 1; // Start with the existing rifle; number keys select 1-3.
	for (const entry of weapons) entry[4] = entry[0];
	weapon = weapons[selectedWeapon];
	triggerConsumed = false;
	shotgunPumpPending = false;
	shotCooldown = 0;
	triggerHeld = false;
	emptyClickPlayed = false;

	reloadCooldown = 0;
	marineLegYaw = 0;
	marineHealth = 5;
	hurtCooldown = 0;
}
setupGame();

const random = (minimum = 0, range = 1) => minimum + Math.random() * range;
const isSprinting = () =>
	marineHealth > 0 &&
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
function particleBurst(position, count, scale, materials, lifetime, velocity, spread, transparency = 0) {
	for (let i = 0; i < count; i++) {
		const entity = spawn(transparency > 0 ? 134 : 6);
		if (!entity) return;
		entity.set(position, E.POS);
		entity[E.TRANSPARENCY] = transparency;
		entity[E.SCALE_X] = entity[E.SCALE_Y] = entity[E.SCALE_Z] = random(scale, scale * .6);
		entity[E.TILE_X] = entity[E.TILE_Y] = entity[E.TILE_Z] = 0;
		entity[E.MAT_OVERRIDE] = materials[i % materials.length];
		entity[E.DISSOLVE] = .5;
		entity[E.TTL] = random(lifetime, lifetime * .5);
		entity[E.DISSOLVE_RATE] = .5 / entity[E.TTL];
		entity[E.DISSOLVE_TARGET] = 1;
		entity[E.GRAVITY] = 9;
		entity.set(velocity.map((value, axis) => value + random(-spread[axis] / 2, spread[axis])), E.VELOCITY);
	}
}

export function toggleMarineFlashlight() {
	marineGun[E.SPOTLIGHT] = marineGun[E.SPOTLIGHT] ? 0 : 8.4;
	sound.emptyClick();
}

export function selectMarineWeapon(number) {
	const next = number - 1;
	if (!marineHealth || !weapons[next] || next === selectedWeapon) return;

	selectedWeapon = next;
	shotgunPumpPending = false;
	weapon = weapons[next];
	reloadCooldown = 0;
	setMarineTrigger(false);
	marineArms[E.ROT_X] = marineArms[E.POS_Y] = marineArms[E.POS_Z] = 0;
}

// Colored damage reaches 30% before death; eroding props reserve their final
// collapse for death. All health-driven dissolve uses this one calculation.
function updateDamageDissolve(entity, health, maximum) {
	const goal = health > 0
		? (maximum - health) * .3 / (maximum - (entity[E.DISSOLVE_PALETTE] > 0))
		: 1;
	entity[entity[E.DISSOLVE_RATE] ? E.DISSOLVE_TARGET : E.DISSOLVE] = goal;
}

export function fireMarineGun() {
	if (selectedWeapon !== 1 && triggerConsumed) return;
	if (!marineHealth || isSprinting() || reloadCooldown > 0 || (DEBUG && player[E.KIND] === 0)) return;
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
	const muzzleX = player[E.POS_X] + (forwardX * 30 + forwardZ) * player[E.SCALE_X] / 64;
	const muzzleY = player[E.POS_Y] + (10.5 / 64) * player[E.SCALE_Y];
	const muzzleZ = player[E.POS_Z] + (forwardZ * 30 - forwardX) * player[E.SCALE_Z] / 64;
	// Reuse the attached flash for every weapon, including a whole shotgun volley.
	muzzleFlash[E.AGE] = 0;
	muzzleFlash[E.TRANSPARENCY] = 0;
	muzzleFlash[E.SPOTLIGHT] = 12;

	for (let pellet = 0; pellet < weapon[3]; pellet++) {
		// Uniform solid-angle sampling in an eight-degree cone around the bore.
		const cosine = weapon[3] === 1 ? 1 : 1 - random() * (1 - Math.cos(0.14));
		const radial = Math.sqrt(1 - cosine * cosine);
		const angle = weapon[3] === 1 ? 0 : random(0, Math.PI * 2);
		const side = radial * Math.cos(angle),
			vertical = radial * Math.sin(angle);
		firePellet(
			muzzleX,
			muzzleY,
			muzzleZ,
			forwardX * cosine - forwardZ * side,
			forwardZ * cosine + forwardX * side,
			vertical,
		);
	}
}

function firePellet(muzzleX, muzzleY, muzzleZ, forwardX, forwardZ, forwardY = 0) {
	let target;
	let range = shotFraction(player[E.POS_X], player[E.POS_Z], muzzleX, muzzleZ, muzzleY) < 1 ? 0 : 18;
	let closest = range;
	const origin = [muzzleX, muzzleY, muzzleZ];
	const direction = [forwardX * 18, forwardY * 18, forwardZ * 18];
	for (const entity of EArray) {
		if (!entity[E.KIND] || !(entity[E.SOLID] || entity[E.HEALTH] > 0 || entity[E.KIND] === 5)) continue;
		const distance = 18 * entityShotFraction(entity, origin, direction);
		if (distance < closest || (distance === closest && entity[E.SOLID])) {
			closest = distance;
			target = entity[E.HEALTH] > 0 ? entity : undefined;
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
		if (tracer) {
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
			tracer.set([0.035, 0.035, length], E.SCALE);
			tracer[E.ROT_Y] = Math.atan2(-traceX, traceZ);
			tracer[E.ROT_X] = -Math.asin(forwardY);
			tracer[E.MAT_OVERRIDE] = 242;
			tracer.set([forwardX * 45, forwardY * 45, forwardZ * 45, (distance - length) / 45 || -1], E.VELOCITY);
		}
	}
	if (!target) {
		if (range > 0 && range < 18) {
			particleBurst(
				[hitX - forwardX * .06, muzzleY + traceY - forwardY * .06, hitZ - forwardZ * .06],
				8, .1, [242, 248], .25,
				[-forwardX * 2.5, 1.5, -forwardZ * 2.5], [1, 2, 1],
			);
		}
		return;
	}
	target[E.HEALTH]--;
	if (target[E.DISSOLVE_RATE]) {
		updateDamageDissolve(target, target[E.HEALTH], target[E.MAX_HEALTH]);
		if (!target[E.HEALTH]) {
			target[E.SOLID] = 0;
			if (target[E.KIND] === 16) {
				const gun = spawn(11);
				if (gun) {
					gun.set([target[E.POS_X], target[E.POS_Y] - Math.abs(target[E.SCALE_Y]) / 2 + .085, target[E.POS_Z]], E.POS);
					gun.set([.17, .25, .56], E.SCALE);
					gun[E.ROT_Z] = Math.PI / 2;
					gun[E.TILE_X] = gun[E.TILE_Y] = gun[E.TILE_Z] = 1;
				}
			}
		}
		return;
	}
	particleBurst(target.subarray(E.POS, E.POS + 3), 28, .06, [249], .9, [0, .7, 0], [2, .8, 2], .5);
	if (target[E.HEALTH] > 0) updateDamageDissolve(target, target[E.HEALTH], 4);
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
	triggerHeld = held && marineHealth > 0;
	if (!held) {
		emptyClickPlayed = false;
		triggerConsumed = false;
	}
}

export function reloadMarineGun() {
	if (!marineHealth || isSprinting() || reloadCooldown > 0 || weapon[4] === weapon[0] || (DEBUG && player[E.KIND] === 0))
		return;
	reloadCooldown = weapon[1];
	shotgunPumpPending = false;
	sound.reload(weapon[1]);
}

export function aimMarineAtCursor(x, y, width, height) {
	if (!marineHealth) return;
	const [pitch, yaw] = cameraRotation;
	const sinYaw = Math.sin(yaw),
		cosYaw = Math.cos(yaw);
	const sinPitch = Math.sin(pitch),
		cosPitch = Math.cos(pitch);
	const fovScale = Math.tan((cameraFov * Math.PI) / 360);
	const viewX = ((2 * x - width) / height) * fovScale;
	const viewY = (1 - (2 * y) / height) * fovScale;
	// Expand the camera basis directly; its right vector has no Y component.
	const forward = cosPitch - sinPitch * viewY;
	const rayX = sinYaw * forward + cosYaw * viewX;
	const rayY = sinPitch + cosPitch * viewY;
	const rayZ = -cosYaw * forward + sinYaw * viewX;
	if (rayY >= -0.001) return;
	const distance = ((10.5 / 64 - cameraPosition[1]) * player[E.SCALE_Y]) / rayY;
	if (distance <= 0) return;
	marineBody[E.ROT_Y] = lookAtYaw(
		cameraPosition[0] * player[E.SCALE_X] + rayX * distance,
		cameraPosition[2] * player[E.SCALE_Z] + rayZ * distance,
	);
}

export function updateGame(deltaTime, freeCamera = false) {
	if (muzzleFlash[E.AGE] + deltaTime >= .035) {
		muzzleFlash[E.TRANSPARENCY] = 1;
		muzzleFlash[E.SPOTLIGHT] = 0;
	}
	for (const entity of EArray) {
		if (entity[E.KIND] !== 12) continue;
		if (marineHealth && entity[E.HEALTH] && entity[E.AGE] > 25 && spawnFromPortal(entity)) entity[E.AGE] = 0;
		entity[E.SPOTLIGHT] = 2.1 * (1 - entity[E.DISSOLVE]);
	}
	const sprinting = !freeCamera && isSprinting();
	hurtCooldown = Math.max(0, hurtCooldown - deltaTime);
	player[E.MAT_OVERRIDE] = hurtCooldown > 0.65 && marineHealth > 0 ? 117 : 0;
	shotCooldown = Math.max(0, shotCooldown - deltaTime);
	if (sprinting) {
		reloadCooldown = 0;
		shotgunPumpPending = false;
	}
	if (shotgunPumpPending && shotCooldown === 0) {
		shotgunPumpPending = false;
		if (marineHealth > 0 && weapon[4] > 0 && reloadCooldown <= 0) sound.shotgunPump();
	}
	if (reloadCooldown > 0) {
		reloadCooldown -= deltaTime;
		if (reloadCooldown <= 0) weapon[4] = weapon[0];
	}
	if (!sprinting && triggerHeld && selectedWeapon === 1) fireMarineGun();
	const moveX = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const moveZ = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	let legTarget = marineBody[E.ROT_Y];
	if (!freeCamera && marineHealth > 0 && (moveX || moveZ)) {
		const [forwardX, forwardZ] = heading(cameraRotation[1]);
		const rightX = Math.cos(cameraRotation[1]);
		const rightZ = Math.sin(cameraRotation[1]);
		const length = Math.hypot(moveX, moveZ);
		const dx = (rightX * moveX + forwardX * moveZ) / length;
		const dz = (rightZ * moveX + forwardZ * moveZ) / length;
		const x = player[E.POS_X],
			z = player[E.POS_Z];
		moveActor(player, dx * (sprinting ? 5.8 : 4.4) * deltaTime, dz * (sprinting ? 5.8 : 4.4) * deltaTime);
		const moved = Math.hypot(player[E.POS_X] - x, player[E.POS_Z] - z);
		if (moved > 0.00001) legTarget = lookAtYaw(player[E.POS_X] - x, player[E.POS_Z] - z);
	}
	if (marineHealth > 0 && !freeCamera) {
		// Backpedal instead of turning the feet around behind the torso.
		let target = wrapAngle(legTarget - marineBody[E.ROT_Y]);
		if (Math.abs(target) > Math.PI / 2 + 0.000001) target -= Math.sign(target) * Math.PI;
		target = clampLeg(target);
		const current = clampLeg(wrapAngle(marineLegYaw - marineBody[E.ROT_Y]));
		marineLegs[E.ROT_Y] = current + (target - current) * (1 - Math.exp(-12 * deltaTime));
		marineLegYaw = marineBody[E.ROT_Y] + marineLegs[E.ROT_Y];
	}

	for (const entity of EArray) {
		if (entity[E.KIND] !== 2 || !entity[E.HEALTH] || !marineHealth) continue;
		const dx = player[E.POS_X] - entity[E.POS_X];
		const dz = player[E.POS_Z] - entity[E.POS_Z];
		const distance = Math.hypot(dx, dz);
		if (distance > 1) {
			const step = Math.min(1.755 * deltaTime, distance - 0.8);
			moveActor(entity, (dx / distance) * step, (dz / distance) * step);
			entity[E.ROT_Y] = lookAtYaw(dx, dz);
		}
		if (
			hurtCooldown === 0 &&
			Math.hypot(player[E.POS_X] - entity[E.POS_X], player[E.POS_Z] - entity[E.POS_Z]) <= 1 &&
			clearShot(player[E.POS_X], player[E.POS_Z], entity[E.POS_X], entity[E.POS_Z])
		) {
			marineHealth--;
			// Four surviving hits ramp rainbow coverage from 0% to 30%.
			updateDamageDissolve(player, marineHealth, 5);
			hurtCooldown = 0.85;
			player[E.MAT_OVERRIDE] = 117;
			sound.hurt();
			if (!marineHealth) {
				setTimeout(setupGame, 5000);
				sound.explode();
				triggerHeld = false;
				reloadCooldown = 0;
				player[E.MAT_OVERRIDE] = 0;
				marineBody[E.ROT_X] = Math.PI / 2;
				player[E.POS_Y] = 0;
			} else {
				// Surviving hits push the marine away, respecting walls and cover.
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

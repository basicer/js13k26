import { heldKeys, cameraFov } from "./globals.js";
import { cameraPosition, cameraRotation, spawn } from "./entities.js";
import * as sound from "./sfx.js";
import { canStand, moveActor, clearShot, shotFraction } from "./level.js";

const unicorns = [];

const player = spawn(1);
player[4] = -2;

player[11] = 255; // Dissolve into the procedural rainbow material.

// Parts share the original centered model frame; parent links supply the pose.
const marineParts = [8, 9, 10, 11].map((kind) => spawn(kind));
const [marineLegs, marineBody, marineArms, marineGun] = marineParts;
marineLegs[2] = marineBody[2] = player.id;
marineArms[2] = marineBody.id;
marineGun[2] = marineArms.id;
marineGun[1] = 8.4;
marineGun[24] = Math.PI / 6; // 30-degree flashlight cone along the gun's +Z.

for (const part of marineParts) {
	part[11] = 255;
	part[16] = part[17] = part[18] = 0;
}

function spawnUnicorn(x, z) {
	if (!canStand(x, z)) return false;
	const unicorn = spawn(2);
	if (!unicorn) return;
	unicorn[4] = x;

	unicorn[6] = z;
	unicorn[11] = 249;
	unicorns.push({ entity: unicorn, health: 4, walk: 0 });
	return true;
}

// Start with a herd, then replace enemies as they are eliminated.
for (const [x, z] of [
	[4, -1],
	[7, 3],
	[3, 6],
	[-5, 5],
	[-8, -3],
	[1, -7],
]) {
	spawnUnicorn(x, z);
}

// Capacity, reload seconds, shot interval, pellet count.
const weapons = [
	[12, 1.15, 0, 1],
	[30, 2.5875, 0.08, 1],
	[8, 2.3, 0.7, 12],
];
let selectedWeapon = 1; // Start with the existing rifle; number keys select 1-3.
for (const entry of weapons) entry[4] = entry[0];
let weapon = weapons[selectedWeapon];
let triggerConsumed = false;
let shotgunPumpPending = false;
let shotCooldown = 0;
let spawnCooldown = 1.5;
let triggerHeld = false;
let emptyClickPlayed = false;

let reloadCooldown = 0;
let marineWalk = 0;
let marineLegYaw = 0;
let marineHealth = 5;
let hurtCooldown = 0;

const random = (minimum = 0, range = 1) => minimum + Math.random() * range;
const heading = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
// Voxel characters and their weapons are authored facing local +Z, while the
// engine's transform forward points down local -Z.
const lookAtYaw = (dx, dz) => Math.atan2(dx, -dz) + Math.PI;
const clampLeg = (angle) =>
	Math.max(-Math.PI / 2, Math.min(Math.PI / 2, angle));
const wrapAngle = (angle) => Math.atan2(Math.sin(angle), Math.cos(angle));
const marineFacing = (yaw) => [-Math.sin(yaw), Math.cos(yaw)];

function temporarySphere(
	x,
	y,
	z,
	scale,
	material,
	light,
	lifetime,
	velocity,
	transparency = 0,
) {
	const entity = spawn(transparency > 0 ? 134 : 6);
	if (!entity) return;
	entity.set([x, y, z], 4);
	entity[7] = transparency;
	entity[12] = entity[13] = entity[14] = scale;
	// Small particles need the whole sphere, not a tiled slice of its empty corner.
	entity[16] = entity[17] = entity[18] = 0;
	entity[19] = material;
	entity[1] = light;
	entity[23] = lifetime;
	if (velocity) entity.set(velocity, 20);
}

export function toggleMarineFlashlight() {
	marineGun[1] = marineGun[1] ? 0 : 8.4;
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
	marineArms[8] = marineArms[5] = marineArms[6] = 0;
}

export function fireMarineGun() {
	if (selectedWeapon !== 1 && triggerConsumed) return;
	if (!marineHealth || reloadCooldown > 0 || (DEBUG && player[0] === 255))
		return;
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

	const [forwardX, forwardZ] = marineFacing(player[9]);
	// Bore exit in marine-gun.vp: (33, 42.5, 62) in the centered 64-voxel model.
	const muzzleX =
		player[4] + (forwardX * 30 * player[14] + forwardZ * player[12]) / 64;
	const muzzleY = player[5] + (10.5 / 64) * player[13];
	const muzzleZ =
		player[6] + (forwardZ * 30 * player[14] - forwardX * player[12]) / 64;
	// A very short-lived emissive sphere doubles as the muzzle flash and a point light.
	temporarySphere(muzzleX, muzzleY, muzzleZ, 0.14, 246, 12, 0.035);

	for (let pellet = 0; pellet < weapon[3]; pellet++) {
		// Uniform solid-angle sampling in an eight-degree cone around the bore.
		const cosine =
			weapon[3] === 1 ? 1 : 1 - random() * (1 - Math.cos(0.14));
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
			weapon[3] === 1,
			vertical,
		);
	}
}

function firePellet(
	muzzleX,
	muzzleY,
	muzzleZ,
	forwardX,
	forwardZ,
	assist,
	forwardY = 0,
) {
	let target;
	let range =
		18 *
		shotFraction(
			muzzleX,
			muzzleZ,
			muzzleX + forwardX * 18,
			muzzleZ + forwardZ * 18,
			assist ? 1.25 : muzzleY,
			assist ? 1.25 : muzzleY + forwardY * 18,
		);
	if (forwardY < 0)
		range = Math.min(range, Math.max(0, (-30 / 64 - muzzleY) / forwardY));
	if (!clearShot(player[4], player[6], muzzleX, muzzleZ)) range = 0;
	let closest = range,
		targetDirect = false;
	for (const unicorn of unicorns) {
		const entity = unicorn.entity;
		if (!unicorn.health) continue;
		const dx = entity[4] - muzzleX;
		const dz = entity[6] - muzzleZ;
		// Two degrees of edge forgiveness, capped at 0.18 extra world units.
		// Actual body intersections always take priority over assisted hits.
		const dy = assist ? 0 : entity[5] + (10.5 / 64) * entity[13] - muzzleY;
		const along = dx * forwardX + dy * forwardY + dz * forwardZ;
		const acrossSquared = Math.max(
			0,
			dx * dx + dy * dy + dz * dz - along * along,
		);
		const direct = acrossSquared <= 0.09;
		const radius =
			0.3 + (direct || !assist ? 0 : Math.min(0.18, along * 0.035));
		if (along < 0 || along > 18 || acrossSquared > radius * radius)
			continue;
		const distance = Math.max(
			0,
			along - Math.sqrt(radius * radius - acrossSquared),
		);
		if (
			distance < range &&
			(!assist || clearShot(muzzleX, muzzleZ, entity[4], entity[6])) &&
			(direct > targetDirect ||
				(direct === targetDirect && distance < closest))
		) {
			target = unicorn;
			closest = distance;
			targetDirect = direct;
		}
	}
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
				4,
			);
			tracer.set([0.035, 0.035, length], 12);
			tracer[9] = Math.atan2(-traceX, traceZ);
			tracer[8] = -Math.asin(forwardY);
			tracer[19] = 242;
			tracer.set(
				[
					forwardX * 45,
					forwardY * 45,
					forwardZ * 45,
					(distance - length) / 45,
				],
				20,
			);
		}
	}
	if (!target) {
		if (range > 0 && range < 18) {
			// Keep the burst just outside the wall and throw hot fragments back.
			for (let i = 0; i < 8; i++) {
				const speed = random(1.5, 2);
				temporarySphere(
					hitX - forwardX * 0.06,
					muzzleY + traceY - forwardY * 0.06,
					hitZ - forwardZ * 0.06,
					random(0.1, 0.06),
					i % 2 ? 248 : 242,
					0,
					random(0.25, 0.2),
					[
						-forwardX * speed + random(-0.5),
						random(0.5, 2),
						-forwardZ * speed + random(-0.5),
					],
				);
			}
		}
		return;
	}
	for (let i = 0; i < 28; i++) {
		const angle = random(0, Math.PI * 2);
		const spread = random(0.35, 1.15);
		temporarySphere(
			target.entity[4],
			target.entity[5],
			target.entity[6],
			random(0.06, 0.04),
			249,
			0,
			random(0.9, 0.45),
			[
				Math.cos(angle) * spread,
				random(0.3, 0.8),
				Math.sin(angle) * spread,
			],
			0.5,
		);
	}
	target.health--;
	// Surviving hits stain 10%, 20%, then 30%; death preserves those stains.
	if (target.health > 0) target.entity[3] = (4 - target.health) * 0.1;
	if (target.health <= 0) {
		// Roll onto the side, keeping the head-to-tail axis level.
		target.entity[8] = 0;
		target.entity[23] = 5;
		target.entity[10] = Math.PI / 2;
		target.entity[5] = -20 / 64;
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
	if (
		!marineHealth ||
		reloadCooldown > 0 ||
		weapon[4] === weapon[0] ||
		(DEBUG && player[0] === 255)
	)
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
	const distance =
		(player[5] + (10.5 / 64) * player[13] - cameraPosition[1]) / rayY;
	if (distance <= 0) return;
	player[9] = lookAtYaw(
		cameraPosition[0] + rayX * distance - player[4],
		cameraPosition[2] + rayZ * distance - player[6],
	);
}

export function updateGame(deltaTime, freeCamera = false) {
	hurtCooldown = Math.max(0, hurtCooldown - deltaTime);
	player[19] = hurtCooldown > 0.65 && marineHealth > 0 ? 117 : 0;
	shotCooldown = Math.max(0, shotCooldown - deltaTime);
	if (shotgunPumpPending && shotCooldown === 0) {
		shotgunPumpPending = false;
		if (marineHealth > 0 && weapon[4] > 0 && reloadCooldown <= 0)
			sound.shotgunPump();
	}
	if (reloadCooldown > 0) {
		reloadCooldown -= deltaTime;
		if (reloadCooldown <= 0) weapon[4] = weapon[0];
	}
	if (triggerHeld && selectedWeapon === 1) fireMarineGun();
	spawnCooldown -= deltaTime;
	const livingUnicorns = unicorns.filter((unicorn) => unicorn.health).length;
	if (marineHealth > 0 && spawnCooldown <= 0 && livingUnicorns < 6) {
		for (let attempt = 0; attempt < 16; attempt++) {
			const angle = random(0, Math.PI * 2);
			const distance = random(9, 4);
			if (
				spawnUnicorn(
					player[4] + Math.cos(angle) * distance,
					player[6] + Math.sin(angle) * distance,
				)
			)
				break;
		}
		spawnCooldown = 1.25;
	}
	const moveX = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const moveZ = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	let legTarget = player[9];
	if (!freeCamera && marineHealth > 0 && (moveX || moveZ)) {
		const [forwardX, forwardZ] = heading(cameraRotation[1]);
		const rightX = Math.cos(cameraRotation[1]);
		const rightZ = Math.sin(cameraRotation[1]);
		const length = Math.hypot(moveX, moveZ);
		const dx = (rightX * moveX + forwardX * moveZ) / length;
		const dz = (rightZ * moveX + forwardZ * moveZ) / length;
		const x = player[4],
			z = player[6];
		moveActor(player, dx * 4.6 * deltaTime, dz * 4.6 * deltaTime);
		const moved = Math.hypot(player[4] - x, player[6] - z);
		if (moved > 0.00001)
			legTarget = lookAtYaw(player[4] - x, player[6] - z);
		marineWalk = (marineWalk + moved / 0.65) % 2;
		marineLegs[15] = marineWalk | 0;
	}
	if (marineHealth > 0 && !freeCamera) {
		// Backpedal instead of turning the feet around behind the torso.
		let target = wrapAngle(legTarget - player[9]);
		if (Math.abs(target) > Math.PI / 2 + 0.000001)
			target -= Math.sign(target) * Math.PI;
		target = clampLeg(target);
		const current = clampLeg(wrapAngle(marineLegYaw - player[9]));
		marineLegs[9] =
			current + (target - current) * (1 - Math.exp(-12 * deltaTime));
		marineLegYaw = player[9] + marineLegs[9];
	}

	for (const unicorn of unicorns) {
		const entity = unicorn.entity;
		if (!unicorn.health || !marineHealth) continue;
		const dx = player[4] - entity[4];
		const dz = player[6] - entity[6];
		const distance = Math.hypot(dx, dz);
		if (distance > 1.4) {
			const step = Math.min(1.35 * deltaTime, distance - 1.2);
			const x = entity[4],
				z = entity[6];
			moveActor(entity, (dx / distance) * step, (dz / distance) * step);
			// Alternate hooves every 0.35 world units actually walked.
			unicorn.walk =
				(unicorn.walk +
					Math.hypot(entity[4] - x, entity[6] - z) / 0.35) %
				2;
			entity[15] = unicorn.walk | 0;
			entity[9] = lookAtYaw(dx, dz);
		}
		if (
			hurtCooldown === 0 &&
			Math.hypot(player[4] - entity[4], player[6] - entity[6]) <= 1.4 &&
			clearShot(player[4], player[6], entity[4], entity[6])
		) {
			marineHealth--;
			// Four surviving hits ramp rainbow coverage from 0% to 30%.
			player[3] = marineHealth > 0 ? (5 - marineHealth) * 0.075 : 1;
			hurtCooldown = 0.85;
			player[19] = 117;
			if (marineHealth) sound.hurt();
			// Push the marine away from the attacker, respecting walls and cover.
			const pushX =
				distance > 0.001 ? dx / distance : -Math.sin(entity[9]);
			const pushZ =
				distance > 0.001 ? dz / distance : Math.cos(entity[9]);
			moveActor(player, pushX * 0.9, pushZ * 0.9);
			if (!marineHealth) {
				sound.spaceholder1();
				triggerHeld = false;
				reloadCooldown = 0;
				player[19] = 0;
				player[8] = Math.PI / 2;
				player[5] = 0;
			}
		}
	}

	// Quick lower, hold for the reload, then quick return to the firing pose.
	const reloadPose = Math.max(
		0,
		Math.min(1, (weapon[1] - reloadCooldown) / 0.12, reloadCooldown / 0.15),
	);
	const reloadAngle = 0.85 * reloadPose * reloadPose * (3 - 2 * reloadPose);
	marineArms[8] = reloadAngle;
	marineArms[5] = (12 / 64) * (1 - Math.cos(reloadAngle));
	marineArms[6] = -(12 / 64) * Math.sin(reloadAngle);
	// Keep damage and hit flashes consistent across the articulated marine.
	for (const part of marineParts) {
		for (const slot of [3, 11, 19]) part[slot] = player[slot];
	}
	// Holding right mouse in debug mode temporarily owns the camera.
	if (freeCamera) return;
	const [forwardX, forwardZ] = heading(cameraRotation[1]);
	cameraPosition[0] = player[4] - forwardX * 8;
	cameraPosition[1] = player[5] + 4.7;
	cameraPosition[2] = player[6] - forwardZ * 8;
}

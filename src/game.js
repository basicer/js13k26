import { heldKeys, cameraFov } from "./globals.js";
import { cameraPosition, cameraRotation, spawn } from "./entities.js";
import * as sound from "./sfx.js";
import { canStand, moveActor, clearShot, shotFraction } from "./level.js";

const marines = [];
const unicorns = [];
const temporary = [];

const player = spawn(1);
player[4] = -2;
player[5] = 0;
player[6] = 0;
player[11] = 255; // Dissolve into the blood material instead of empty chunks.
marines.push(player);

function spawnUnicorn(x, z) {
	if (!canStand(x, z)) return false;
	const unicorn = spawn(2);
	if (!unicorn) return;
	unicorn[4] = x;
	unicorn[5] = 0;
	unicorn[6] = z;
	unicorn[11] = 255;
	unicorns.push({ entity: unicorn, health: 4, dead: false });
	return true;
}

// Start with a herd, then replace enemies as they are eliminated.
for (const [x, z] of [[4, -1], [7, 3], [3, 6], [-5, 5], [-8, -3], [1, -7]]) {
	spawnUnicorn(x, z);
}

let shotCooldown = 0;
let spawnCooldown = 1.5;
let triggerHeld = false;
let emptyClickPlayed = false;
let bulletsInMagazine = 30;
let reloadCooldown = 0;
let marineHealth = 5;
let hurtCooldown = 0;

const heading = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
// Voxel characters and their weapons are authored facing local +Z, while the
// engine's transform forward points down local -Z.
const lookAtYaw = (dx, dz) => Math.atan2(dx, -dz) + Math.PI;
const marineFacing = (yaw) => {
	const [x, z] = heading(yaw);
	return [-x, -z];
};

function temporarySphere(x, y, z, scale, material, light, lifetime, velocity, transparency = 0) {
	const entity = spawn(6);
	if (!entity) return;
	entity[4] = x;
	entity[5] = y;
	entity[6] = z;
	entity[7] = transparency;
	entity[12] = entity[13] = entity[14] = scale;
	// Small particles need the whole sphere, not a tiled slice of its empty corner.
	entity[16] = entity[17] = entity[18] = 0;
	entity[19] = material;
	entity[1] = light;
	temporary.push({ entity, lifetime, velocity });
}

export function fireMarineGun() {
	if (!marineHealth || reloadCooldown > 0 || player[0] === 255) return;
	if (bulletsInMagazine === 0) {
		if (!emptyClickPlayed) sound.emptyClick();
		emptyClickPlayed = true;
		return;
	}
	if (shotCooldown > 0) return;
	shotCooldown = 0.08;
	sound.gunshot();
	bulletsInMagazine--;

	const [forwardX, forwardZ] = marineFacing(player[9]);
	// Bore exit in marine.vp: (33, 42.5, 62) in the centered 64-voxel model.
	const muzzleX = player[4] + (forwardX * 30 * player[14] + forwardZ * player[12]) / 64;
	const muzzleY = player[5] + 10.5 / 64 * player[13];
	const muzzleZ = player[6] + (forwardZ * 30 * player[14] - forwardX * player[12]) / 64;
	// A very short-lived emissive sphere doubles as the muzzle flash and a point light.
	temporarySphere(muzzleX, muzzleY, muzzleZ, 0.14, 246, 12, 0.035);

	let target;
	let range = 18 * shotFraction(muzzleX, muzzleZ, muzzleX + forwardX * 18, muzzleZ + forwardZ * 18);
	if (!clearShot(player[4], player[6], muzzleX, muzzleZ)) range = 0;
	let closest = range, targetDirect = false;
	for (const unicorn of unicorns) {
		if (unicorn.dead) continue;
		const dx = unicorn.entity[4] - muzzleX;
		const dz = unicorn.entity[6] - muzzleZ;
		// Two degrees of edge forgiveness, capped at 0.18 extra world units.
		// Actual body intersections always take priority over assisted hits.
		const along = dx * forwardX + dz * forwardZ;
		const across = dx * forwardZ - dz * forwardX;
		const direct = across * across <= 0.09;
		const radius = 0.3 + (direct ? 0 : Math.min(0.18, along * 0.035));
		if (along < 0 || along > 18 || across * across > radius * radius) continue;
		const distance = Math.max(0, along - Math.sqrt(radius * radius - across * across));
		if (distance < range && clearShot(muzzleX, muzzleZ, unicorn.entity[4], unicorn.entity[6])
			&& ((direct && !targetDirect) || (direct === targetDirect && distance < closest))) {
			target = unicorn;
			closest = distance;
			targetDirect = direct;
		}
	}
	const traceX = forwardX * closest;
	const traceZ = forwardZ * closest;
	const hitX = muzzleX + traceX;
	const hitZ = muzzleZ + traceZ;
	if (traceX * forwardX + traceZ * forwardZ > 0.05) {
		const tracer = spawn(7);
		if (tracer) {
			const distance = Math.hypot(traceX, traceZ);
			const length = Math.min(0.25, distance);
			tracer.set([muzzleX + traceX / distance * length / 2, muzzleY, muzzleZ + traceZ / distance * length / 2], 4);
			tracer.set([0.035, 0.035, length], 12);
			tracer[9] = Math.atan2(-traceX, traceZ);
			tracer[19] = 242;
			temporary.push({ entity: tracer, lifetime: (distance - length) / 45,
				velocity: [traceX / distance * 45, 0, traceZ / distance * 45] });
		}
	}
	if (!target) {
		if (range > 0 && range < 18) {
			// Keep the burst just outside the wall and throw hot fragments back.
			for (let i = 0; i < 8; i++) {
				const speed = 1.5 + Math.random() * 2;
				temporarySphere(
					hitX - forwardX * 0.06, muzzleY, hitZ - forwardZ * 0.06,
					0.1 + Math.random() * 0.06, i % 2 ? 248 : 242,
					0, 0.25 + Math.random() * 0.2,
					[-forwardX * speed + (Math.random() - 0.5),
						0.5 + Math.random() * 2, -forwardZ * speed + (Math.random() - 0.5)],
				);
			}
		}
		return;
	}
	for (let i = 0; i < 28; i++) {
		const angle = Math.random() * Math.PI * 2;
		const spread = 0.35 + Math.random() * 1.15;
		temporarySphere(
			target.entity[4],
			target.entity[5],
			target.entity[6],
			0.06 + Math.random() * 0.04,
			255,
			0,
			0.9 + Math.random() * 0.45,
			[Math.cos(angle) * spread, 0.3 + Math.random() * 0.8, Math.sin(angle) * spread],
			0.5,
		);
	}
	target.health--;
	// Surviving hits stain 10%, 20%, then 30%; the lethal hit stains the rest.
	target.entity[3] = target.health > 0 ? Math.max(0, (4 - target.health) * 0.1) : 1;
	if (target.health <= 0) {
		target.dead = true;
		// Retain the defeated pose, now fully covered in the dissolve material.
		target.entity[8] = Math.PI / 2;
		target.entity[10] = (Math.random() - 0.5) * 0.45;
		target.entity[5] = 0.2;
	}
}

export function setMarineTrigger(held) {
	triggerHeld = held && marineHealth > 0;
	if (!held) emptyClickPlayed = false;
}

export function reloadMarineGun() {
	if (!marineHealth || reloadCooldown > 0 || bulletsInMagazine === 30 || player[0] === 255) return;
	reloadCooldown = 1.15;
	sound.reload();
}

export function aimMarineAtCursor(x, y, width, height) {
	if (!marineHealth) return;
	const pitch = cameraRotation[0];
	const yaw = cameraRotation[1];
	const cosPitch = Math.cos(pitch);
	const forward = [Math.sin(yaw) * cosPitch, Math.sin(pitch), -Math.cos(yaw) * cosPitch];
	const right = [Math.cos(yaw), 0, Math.sin(yaw)];
	const up = [
		right[1] * forward[2] - right[2] * forward[1],
		right[2] * forward[0] - right[0] * forward[2],
		right[0] * forward[1] - right[1] * forward[0],
	];
	const fovScale = Math.tan((cameraFov * Math.PI) / 360);
	const viewX = ((x / width) * 2 - 1) * fovScale * (width / height);
	const viewY = (1 - (y / height) * 2) * fovScale;
	const rayX = forward[0] + right[0] * viewX + up[0] * viewY;
	const rayY = forward[1] + right[1] * viewX + up[1] * viewY;
	const rayZ = forward[2] + right[2] * viewX + up[2] * viewY;
	if (rayY >= -0.001) return;
	const distance = (player[5] + 10.5 / 64 * player[13] - cameraPosition[1]) / rayY;
	if (distance <= 0) return;
	player[9] = lookAtYaw(
		cameraPosition[0] + rayX * distance - player[4],
		cameraPosition[2] + rayZ * distance - player[6],
	);
}

export function updateGame(deltaTime) {
	hurtCooldown = Math.max(0, hurtCooldown - deltaTime);
	player[19] = hurtCooldown > 0.65 && marineHealth > 0 ? 117 : 0;
	shotCooldown = Math.max(0, shotCooldown - deltaTime);
	if (reloadCooldown > 0) {
		reloadCooldown -= deltaTime;
		if (reloadCooldown <= 0) bulletsInMagazine = 30;
	}
	if (triggerHeld) fireMarineGun();
	spawnCooldown -= deltaTime;
	const livingUnicorns = unicorns.reduce(
		(count, unicorn) => count + Number(!unicorn.dead),
		0,
	);
	if (marineHealth > 0 && spawnCooldown <= 0 && livingUnicorns < 6) {
		for (let attempt = 0; attempt < 16; attempt++) {
			const angle = Math.random() * Math.PI * 2;
			const distance = 9 + Math.random() * 4;
			if (spawnUnicorn(
				player[4] + Math.cos(angle) * distance,
				player[6] + Math.sin(angle) * distance,
			)) break;
		}
		spawnCooldown = 1.25;
	}
	const moveX = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const moveZ = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	if (marineHealth > 0 && (moveX || moveZ)) {
		const [forwardX, forwardZ] = heading(cameraRotation[1]);
		const rightX = Math.cos(cameraRotation[1]);
		const rightZ = Math.sin(cameraRotation[1]);
		const length = Math.hypot(moveX, moveZ);
		const dx = (rightX * moveX + forwardX * moveZ) / length;
		const dz = (rightZ * moveX + forwardZ * moveZ) / length;
		moveActor(player, dx * 4.6 * deltaTime, dz * 4.6 * deltaTime);
	}

	for (const unicorn of unicorns) {
		if (unicorn.dead || !marineHealth) continue;
		const dx = player[4] - unicorn.entity[4];
		const dz = player[6] - unicorn.entity[6];
		const distance = Math.hypot(dx, dz);
		if (distance > 1.4) {
			const step = Math.min(1.35 * deltaTime, distance - 1.2);
			moveActor(unicorn.entity, (dx / distance) * step, (dz / distance) * step);
			unicorn.entity[9] = lookAtYaw(dx, dz);
		}
		if (hurtCooldown === 0
			&& Math.hypot(player[4] - unicorn.entity[4], player[6] - unicorn.entity[6]) <= 1.4
			&& clearShot(player[4], player[6], unicorn.entity[4], unicorn.entity[6])) {
			marineHealth--;
			// Four surviving hits ramp blood coverage from 0% to 30%.
			player[3] = marineHealth > 0 ? (5 - marineHealth) * 0.075 : 1;
			hurtCooldown = 0.85;
			player[19] = 117;
			if (marineHealth) sound.hurt();
			// Push the attacker back through the same collision checks as walking.
			const pushX = distance > 0.001 ? -dx / distance : Math.sin(unicorn.entity[9]);
			const pushZ = distance > 0.001 ? -dz / distance : Math.cos(unicorn.entity[9]);
			moveActor(unicorn.entity, pushX * 1.8, pushZ * 1.8);
			if (!marineHealth) {
				sound.spaceholder1();
				triggerHeld = false;
				reloadCooldown = 0;
				player[19] = 0;
				player[8] = Math.PI / 2;
				player[5] = 0.2;
			}
		}
	}

	for (let i = temporary.length; i--;) {
		const effect = temporary[i];
		const step = Math.min(deltaTime, effect.lifetime);
		effect.lifetime -= deltaTime;
		if (effect.velocity) {
			effect.entity[4] += effect.velocity[0] * step;
			effect.entity[5] += effect.velocity[1] * step;
			effect.entity[6] += effect.velocity[2] * step;
			if (effect.entity[0] !== 7) {
				effect.velocity[1] -= (effect.entity[19] === 255 ? 11 : 7) * step;
				const floor = -30 / 64 + effect.entity[13] * 0.38;
				if (effect.entity[5] <= floor + 0.000001) {
					effect.entity[5] = floor;
					effect.velocity[1] = 0;
				}
			}
		}
		if (effect.lifetime > 0) continue;
		effect.entity[0] = 255;
		temporary.splice(i, 1);
	}

	// Third-person follow camera. It stays behind the marine while retaining
	// the debug-adjustable pitch/yaw, so aiming and movement remain predictable.
	const [forwardX, forwardZ] = heading(cameraRotation[1]);
	cameraPosition[0] = player[4] - forwardX * 8;
	cameraPosition[1] = player[5] + 4.7;
	cameraPosition[2] = player[6] - forwardZ * 8;
}

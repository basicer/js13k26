import { heldKeys } from "./globals.js";
import { cameraPosition, cameraRotation, spawn } from "./entities.js";
import * as sound from "./sfx.js";
import { canStand, moveActor, clearShot } from "./level.js";

const marines = [];
const unicorns = [];
const temporary = [];

const player = spawn(1);
player[4] = -2;
player[5] = 0;
player[6] = 0;
marines.push(player);

function spawnUnicorn(x, z) {
	if (!canStand(x, z)) return false;
	const unicorn = spawn(2);
	if (!unicorn) return;
	unicorn[4] = x;
	unicorn[5] = 0;
	unicorn[6] = z;
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

const heading = (yaw) => [Math.sin(yaw), -Math.cos(yaw)];
// Voxel characters and their weapons are authored facing local +Z, while the
// engine's transform forward points down local -Z.
const lookAtYaw = (dx, dz) => Math.atan2(dx, -dz) + Math.PI;
const marineFacing = (yaw) => {
	const [x, z] = heading(yaw);
	return [-x, -z];
};

function temporarySphere(x, y, z, scale, material, light, lifetime, velocity) {
	const entity = spawn(6);
	if (!entity) return;
	entity[4] = x;
	entity[5] = y;
	entity[6] = z;
	entity[12] = entity[13] = entity[14] = scale;
	entity[19] = material;
	entity[1] = light;
	temporary.push({ entity, lifetime, velocity });
}

export function fireMarineGun() {
	if (reloadCooldown > 0 || player[0] === 255) return;
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
	const muzzleX = player[4] + forwardX * 1.15;
	const muzzleZ = player[6] + forwardZ * 1.15;
	// A very short-lived emissive sphere doubles as the muzzle flash and a point light.
	temporarySphere(muzzleX, 1.25, muzzleZ, 0.14, 246, 12, 0.035);

	let target;
	let closest = Infinity;
	for (const unicorn of unicorns) {
		if (unicorn.dead) continue;
		const dx = unicorn.entity[4] - player[4];
		const dz = unicorn.entity[6] - player[6];
		const distance = Math.hypot(dx, dz);
		if (distance > 18 || distance < 0.001) continue;
		const aim = (dx * forwardX + dz * forwardZ) / distance;
		if (aim > 0.82 && distance < closest && clearShot(player[4], player[6], unicorn.entity[4], unicorn.entity[6])) {
			target = unicorn;
			closest = distance;
		}
	}
	if (!target) return;

	const hitX = target.entity[4] - forwardX * 0.35;
	const hitZ = target.entity[6] - forwardZ * 0.35;
	for (let i = 0; i < 28; i++) {
		const angle = Math.random() * Math.PI * 2;
		const spread = 0.35 + Math.random() * 1.15;
		temporarySphere(
			hitX,
			0.35 + Math.random() * 0.45,
			hitZ,
			0.16 + Math.random() * 0.14,
			255,
			0,
			0.9 + Math.random() * 0.45,
			[Math.cos(angle) * spread, 0.3 + Math.random() * 0.8, Math.sin(angle) * spread],
		);
	}
	target.health--;
	if (target.health <= 0) {
		target.dead = true;
		// Roll the body to the ground and leave it there as a visible corpse.
		target.entity[8] = Math.PI / 2;
		target.entity[10] = (Math.random() - 0.5) * 0.45;
		target.entity[5] = 0.2;
	}
}

export function setMarineTrigger(held) {
	triggerHeld = held;
	if (!held) emptyClickPlayed = false;
}

export function reloadMarineGun() {
	if (reloadCooldown > 0 || bulletsInMagazine === 30 || player[0] === 255) return;
	reloadCooldown = 1.15;
	sound.reload();
}

export function aimMarineAtCursor(x, y, width, height) {
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
	const fovScale = Math.tan((60 * Math.PI) / 360);
	const viewX = ((x / width) * 2 - 1) * fovScale * (width / height);
	const viewY = (1 - (y / height) * 2) * fovScale;
	const rayX = forward[0] + right[0] * viewX + up[0] * viewY;
	const rayY = forward[1] + right[1] * viewX + up[1] * viewY;
	const rayZ = forward[2] + right[2] * viewX + up[2] * viewY;
	if (rayY >= -0.001) return;
	const distance = (0.85 - cameraPosition[1]) / rayY;
	if (distance <= 0) return;
	player[9] = lookAtYaw(
		cameraPosition[0] + rayX * distance - player[4],
		cameraPosition[2] + rayZ * distance - player[6],
	);
}

export function updateGame(deltaTime) {
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
	if (spawnCooldown <= 0 && livingUnicorns < 6) {
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
	if (moveX || moveZ) {
		const [forwardX, forwardZ] = heading(cameraRotation[1]);
		const rightX = Math.cos(cameraRotation[1]);
		const rightZ = Math.sin(cameraRotation[1]);
		const length = Math.hypot(moveX, moveZ);
		const dx = (rightX * moveX + forwardX * moveZ) / length;
		const dz = (rightZ * moveX + forwardZ * moveZ) / length;
		moveActor(player, dx * 4.6 * deltaTime, dz * 4.6 * deltaTime);
	}

	for (const unicorn of unicorns) {
		if (unicorn.dead) continue;
		const dx = player[4] - unicorn.entity[4];
		const dz = player[6] - unicorn.entity[6];
		const distance = Math.hypot(dx, dz);
		if (distance > 1.4) {
			moveActor(unicorn.entity, (dx / distance) * 1.35 * deltaTime, (dz / distance) * 1.35 * deltaTime);
			unicorn.entity[9] = lookAtYaw(dx, dz);
		}
	}

	for (let i = temporary.length; i--;) {
		const effect = temporary[i];
		effect.lifetime -= deltaTime;
		if (effect.velocity) {
			effect.entity[4] += effect.velocity[0] * deltaTime;
			effect.entity[5] += effect.velocity[1] * deltaTime;
			effect.entity[6] += effect.velocity[2] * deltaTime;
			effect.velocity[1] -= 7 * deltaTime;
			if (effect.entity[5] < 0.08) {
				effect.entity[5] = 0.08;
				effect.velocity[1] = 0;
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

import * as E from "../entities-const.js";
import { entityOverrides, entityVersion } from "../entities.js";
import { sections } from "../level.js";

let ride;

export const warpLocations = [
	["Start room", -11, -11, 0],
	["Hallway", 2, -2, 0],
	["Cargo", -6, 14, 0],
	["Cargo landing", -13, 20, 0],
	["Elevator", -17.5, 20, 0],
	["Boss landing", -37.5, 15, 40],
	["Boss room", -45.5, 3, 40],
];

export function warpPlayer(player, [, x, z, height]) {
	ride = null;
	entityOverrides.delete(player.id);
	entityOverrides.delete(sections[0].id);
	player.set([x + height / 2, 0, z], E.POS);
	player.fill(0, E.VELOCITY, E.VELOCITY + 3);
	player[E.LERP_SPEED] = 0;
	sections[0][E.POS_Y] = height;
	sections[0][E.POS_X] = height / 2;
	sections[0].fill(0, E.VELOCITY, E.VELOCITY + 3);
	sections[0][E.VELOCITY_Y] = sections[0][E.LERP_SPEED] = 0;
}

export function startElevatorTest(player) {
	const section = sections[0];
	ride = { section, elapsed: 0, version: entityVersion };
}

export function updateElevatorTest(dt) {
	if (!ride) return;
	if (ride.version !== entityVersion) { ride = null; return; }
	ride.elapsed = Math.min(10, ride.elapsed + dt);
	ride.section[E.POS_Y] = ride.elapsed * 4;
	ride.section[E.POS_X] = ride.elapsed * 2;
	if (ride.elapsed === 10) ride = null;
}

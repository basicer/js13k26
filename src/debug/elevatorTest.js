import * as E from "../entities-const.js";
import { entityOverrides, EArray } from "../entities.js";
import { sections } from "../level.js";

const liftPanel = () => EArray.find(e => e[E.KIND] === 15 && e[E.CONTROLLER] === sections[0].id);

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
	liftPanel()[E.MODEL_VARIANT] = 0;
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
	sections[0].fill(0, E.POS, E.POS + 3);
	liftPanel()[E.MODEL_VARIANT] = 1;
}

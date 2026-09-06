import { zzfx, zzfxP, zzfxM } from "../vendor/zzfx.js";
import reloadTrack from "../music/reload.zzfxm";
import hurtTrack from "../music/hurt.zzfxm";
import shotgunPumpTrack from "../music/shotgun-pump.zzfxm";

let hurtSamples;
export let hurt = () => {
	if (!hurtSamples) hurtSamples = zzfxM(...hurtTrack);
	return zzfxP(...hurtSamples);
};

const reloadSamples = {};
export let reload = (seconds = 1.15) => {
	if (!reloadSamples[seconds]) {
		const instruments = reloadTrack[0].map((instrument) => [...instrument]);
		// Stretch magazine friction, while clacks retain their pitch and snap.
		for (const index of [1, 4]) {
			instruments[index][4] *= seconds / 1.15;
			instruments[index][5] *= seconds / 1.15;
		}
		const steps = reloadTrack[1][0][0].length - 2;
		reloadSamples[seconds] = zzfxM(instruments, reloadTrack[1], reloadTrack[2], (15 * steps) / seconds);
	}
	return zzfxP(...reloadSamples[seconds]);
};

let shotgunPumpSamples;
export let shotgunPump = () => {
	if (!shotgunPumpSamples) shotgunPumpSamples = zzfxM(...shotgunPumpTrack);
	return zzfxP(...shotgunPumpSamples);
};

export let magic = zzfx([, , 539, 0, 0.04, 0.29, 1, 1.92, , , 567, 0.02, 0.02, , , , 0.04]),
	emptyClick = zzfx([0.65, 0, 180, 0, 0.003, 0.028, 4, 1, , , , , , 0.2, , , , , , , 1200]),
	gunshot = zzfx([2.5, , 454, 0.02, 0.05, 0.18, 3, 3.2, , , , , , 2, , 0.1, 0.08, 0.71, 0.01, , -1605]),
	wobble = zzfx([0.7, 0.05, 280, 0.03, 0.12, 0.42, 0, 1.4, 1.7, -1.1, , , , 0.04, 7]),
	explode = zzfx([, , 71, 0.16, 0.26, , 4, 2, , , , , , , 4.2, 0.3, , 0.59, 0.35]),
	spaceholder2 = zzfx([0.7, , 384, , 0.26, 0.002, 2, 2.8, -41, 89, , , 0.02, , , , 0.01, 0.75, , 0.41, -842]),
	spaceholder3 = zzfx([0.3, , 591, 0.08, 0.08, 0.07, 3, 0.7, , 88, -21, 0.11, , 0.9, 6.1, , , 0.92, 0.37, , 964]),
	spaceholder4 = zzfx([2, , 267, , 0.04, 0.04, 1, 0.4, , , , , , , , , 0.2, 0.68, 0.09]),
	spaceholder5 = zzfx([1.1, , 262, 0.01, 0.02, 0.07, 3, 1.8, , , , , , 0.2, , , 0.38, 0.8, 0.03, 0.43, -739]),
	spaceholder6 = zzfx([, , 240, 0.01, 0.35, 0.05, 1, 2.2, -35, , , , , , , 0.1, , 0.74, 0.06, 0.33]),
	spaceholder7 = zzfx([0.4, , 161, 0.36, , 0.21, 3, 2.7, , 23, , , , , , , , 0.8, 0.01, , 998]);

import music1_js from "../music/Main Title.zzfxm";
// This song was authored with the tracker's older, phase-based modulation.
export let music1 = () => zzfxP(...zzfxM(...music1_js.slice(0, 4), true));

/*
import ambident1_js from "./music/Ambient1.zzfxm";
export let ambient1 = () => zzfxP(...zzfxM(...ambident1_js));

import music2_js from "./music/Boss fight.zzfxm";
import ambident2_js from "./music/Ambient2.zzfxm";

export let music2 = () => zzfxP(...zzfxM(...music2_js));
export let ambient2 = () => zzfxP(...zzfxM(...ambident2_js));

*/

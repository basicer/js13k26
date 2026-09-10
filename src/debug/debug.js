import * as E from "../entities-const.js";
import { ImGui, ImGuiImplWeb, ImVec2, ImVec4 } from "@mori2003/jsimgui";
import { d, c, heldKeys } from "../globals.js";
import { cameraEntity, cameraPosition, cameraRotation } from "../entities.js";
import { startElevatorTest, warpLocations, warpPlayer } from "./elevatorTest.js";
import { detachCamera, attachCamera, freeCamera } from "./camera.js";
import { setMarineTrigger, debugUnlockElevator } from "../game.js";
import { palette } from "../palette.js";
import { entityInspector, selectEntity as setSelectedEntity } from "./entityInspector.js";
import { voxelEditor, voxelEditorOpen } from "./voxelEditor.js";
import { EArray, spawn } from "../entities.js";
import {
	debugPanel,
	saveDebugPanels,
	loadDebugLayout,
	saveDebugLayout,
} from "./settings.js";

// Kind 3 is the development-only DDS projector; kind 6 is the procedural sphere.
const voxelKinds = [2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 19, 125];

export const selectEntity = (index) => {
	setSelectedEntity(index);
	entityInspectorShown[0] = true;
};
import Stats from "stats-gl";

export let stats = new Stats({ trackGPU: true });
document.body.appendChild(stats.dom);
stats.dom.style.position = "absolute";
stats.dom.style.top = "29px";
stats.dom.style.left = "";
stats.dom.style.right = "0px";
stats.dom.style.width = "360px";
stats.init(d);

// Debug controls move independently of the marine and scene collisions.
let paused = false;
let fpsMode = false;
let fpsLooking = false;
const thirdPersonCamera = new Float32Array(3);
export const isPaused = () => paused;
export const isFpsMode = () => fpsMode;
const pause = () => {
	paused = true;
	setMarineTrigger(false);
};
const play = () => {
	stopLooking();
	attachCamera();
	heldKeys.clear();
	paused = false;
};
export function updateCamera(deltaTime) {

	if (!isFlying() || wantsKeyboard()) return;
	detachCamera();
	if (["w", "a", "s", "d", "r", "f", "q", "e", "arrowleft", "arrowright", "arrowup", "arrowdown"].some(key => heldKeys.has(key))) pause();
	const turnSpeed = 1.5;
	if (heldKeys.has("arrowleft")) cameraRotation[1] -= turnSpeed * deltaTime;
	if (heldKeys.has("arrowright")) cameraRotation[1] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowup")) cameraRotation[0] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowdown")) cameraRotation[0] -= turnSpeed * deltaTime;
	if (heldKeys.has("q")) cameraRotation[2] += turnSpeed * deltaTime;
	if (heldKeys.has("e")) cameraRotation[2] -= turnSpeed * deltaTime;
	cameraRotation[0] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraRotation[0]));
	const forward = Number(heldKeys.has("w")) - Number(heldKeys.has("s"));
	const right = Number(heldKeys.has("d")) - Number(heldKeys.has("a"));
	const up = Number(heldKeys.has("r")) - Number(heldKeys.has("f"));
	const distance = (heldKeys.has("shift") ? 15 : 5) * deltaTime /
		Math.max(1, Math.hypot(forward, right, up));
	const [pitch, yaw] = cameraRotation;
	cameraPosition[0] += (Math.sin(yaw) * Math.cos(pitch) * forward + Math.cos(yaw) * right) * distance;
	cameraPosition[1] += (Math.sin(pitch) * forward + up) * distance;
	cameraPosition[2] += (-Math.cos(yaw) * Math.cos(pitch) * forward + Math.sin(yaw) * right) * distance;
}

let initialization = false;
let initializationStarted = false;

const paletteShown = debugPanel("palette");
const entityInspectorShown = debugPanel("entities");
const soundsShown = debugPanel("sounds");

ImGuiImplWeb.SetLoadIniSettingsFn(loadDebugLayout);
ImGuiImplWeb.SetSaveIniSettingsFn(saveDebugLayout);
const saveSettings = () => {
	saveDebugPanels();
	if (initialization) saveDebugLayout(ImGui.SaveIniSettingsToMemory());
};
const restartGame = () => {
	saveSettings();
	window.location.reload();
};

const toggleFpsMode = () => {
	if (!fpsMode) {
		// The game camera follows the marine's movement root, so this sits just
		// ahead of the helmet without inheriting the animated body pose.
		if (!cameraEntity[E.PARENT]) return;
		thirdPersonCamera.set(cameraPosition);
		cameraPosition.set([0, 0.88, 0.66]);
	} else {
		if (document.pointerLockElement === c) document.exitPointerLock();
		cameraPosition.set(thirdPersonCamera);
	}
	fpsMode = !fpsMode;
};

const zooMarine = (x, z) => {
	const root = spawn(1);
	const [legs, body, arms, gun] = [8, 9, 10, 11].map((kind) => spawn(kind));
	root.set([x, 0, z], E.POS);
	body[E.PARENT] = root.id;
	legs[E.PARENT] = body.id;
	arms[E.PARENT] = body.id;
	gun[E.PARENT] = arms.id;
	gun.set([0.0475, 0.1328125, 0.22375], E.POS);
	gun.set([0.17, 0.25, 0.56], E.SCALE);
	gun[E.SPOTLIGHT] = 8.4;
	gun[E.LIGHT_ANGLE] = Math.PI / 6;
	for (const part of [legs, body, arms, gun]) part.fill(0, E.TILE, E.TILE + 3);
	gun.fill(1, E.TILE, E.TILE + 3);
};

const zooUnicorn = (x, z) => {
	const body = spawn(2), head = spawn(18);
	body.set([x, 0, z], E.POS);
	body[E.DISSOLVE_PALETTE] = 249;
	head[E.PARENT] = body.id;
	head.fill(0, E.TILE, E.TILE + 3);
};

const zooPortal = (x, z) => {
	const portal = spawn(12);
	portal[E.SPOTLIGHT] = 2.1;
	portal[E.LIGHT_ANGLE] = 2.772;
	portal.set([x, 0.1875, z], E.POS);
	portal[E.ROT_Y] = Math.PI / 2;
	portal.set([3.6, 3, 0.45], E.SCALE);
	portal.fill(0, E.TILE, E.TILE + 3);
};

const zooPosition = (i) => [(i % 5) * 3, Math.floor(i / 5) * 3];

const zooFloor = () => {
	const floor = spawn(5);
	floor.set([6, -0.5, 4.5], E.POS);
	floor.set([18, 4 / 64, 15], E.SCALE);
	floor.fill(-2, E.TILE, E.TILE + 3);
};

const zooLights = () => {
	for (const [x, y, z, intensity] of [[0, 5, -2, 8], [12, 5, -2, 8], [6, 6, 11, 6]]) {
		const light = spawn(1);
		light.set([x, y, z], E.POS);
		light[E.SPOTLIGHT] = intensity;
	}
};

const aimCameraAt = (x, y, z) => {
	const dx = x - cameraPosition[0], dy = y - cameraPosition[1], dz = z - cameraPosition[2];
	cameraRotation.set([Math.atan2(dy, Math.hypot(dx, dz)), Math.atan2(dx, -dz), 0]);
};

const loadZoo = () => {
	pause();
	freeCamera();
	fpsMode = false;
	if (document.pointerLockElement === c) document.exitPointerLock();
	EArray.map((entity, id) => {
		if (id > 1) entity[E.KIND] = 0;
	});
	for (const [i, kind] of voxelKinds.entries()) {
		const [x, z] = zooPosition(i);
		if (kind === 8) zooMarine(x, z);
		else if (kind === 2) zooUnicorn(x, z);
		else if (kind === 12) zooPortal(x, z);
		else if (kind === 5) zooFloor();
		else if (![9, 10, 11, 18].includes(kind)) {
			const entity = spawn(kind);
			if (!entity) break;
			entity.set([x, 0, z], E.POS);
		}
	}
	zooLights();
	// Frame the complete five-column display and target its center precisely.
	cameraPosition.set([6, 8, -14]);
	aimCameraAt(6, 1.2, 4.5);
};
window.addEventListener("pagehide", saveSettings);
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState === "hidden") saveSettings();
});

let sounds = await import("../sfx.js");

export const wantsMouse = () =>
	initialization && ImGui.GetIO().WantCaptureMouse;
export const wantsKeyboard = () =>
	initialization && ImGui.GetIO().WantCaptureKeyboard;

let lookPointer = null;
export const isFlying = () => lookPointer !== null;
let lookX = 0;
let lookY = 0;
const stopLooking = () => {
	const pointer = lookPointer;
	lookPointer = null;
	if (!paused) attachCamera();
	if (pointer !== null && c.hasPointerCapture(pointer)) c.releasePointerCapture(pointer);
};
c.addEventListener("contextmenu", (event) => event.preventDefault());
c.addEventListener("pointerdown", (event) => {
	if (event.button !== 2 || wantsMouse() || fpsMode) return;
	detachCamera();
	lookPointer = event.pointerId;
	lookX = event.clientX;
	lookY = event.clientY;
	c.setPointerCapture(event.pointerId);
	event.preventDefault();
});
c.addEventListener("pointerdown", (event) => {
	if (fpsMode && !wantsMouse()) c.requestPointerLock();
});
document.addEventListener("pointerlockchange", () => {
	fpsLooking = document.pointerLockElement === c;
});
document.addEventListener("mousemove", (event) => {
	if (!fpsLooking) return;
	cameraRotation[1] += event.movementX * 0.003;
	cameraRotation[0] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
		cameraRotation[0] - event.movementY * 0.003));
});
c.addEventListener("pointermove", (event) => {
	if (event.pointerId !== lookPointer) return;
	if (!(event.buttons & 2)) return stopLooking();
	if (event.clientX !== lookX || event.clientY !== lookY) pause();
	cameraRotation[1] += (event.clientX - lookX) * 0.003;
	cameraRotation[0] = Math.max(-Math.PI / 2, Math.min(Math.PI / 2,
		cameraRotation[0] - (event.clientY - lookY) * 0.003));
	lookX = event.clientX;
	lookY = event.clientY;
});
for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
	c.addEventListener(type, (event) => {
		if (event.pointerId === lookPointer && (type !== "pointerup" || !(event.buttons & 2))) stopLooking();
	});
}
window.addEventListener("blur", stopLooking);

export function debug(passEncoder, entities, entitySize, overrides) {
	if (!initialization) {
		if (initializationStarted) return;
		initializationStarted = true;
		ImGuiImplWeb.Init({ canvas: c, device: d, backend: "webgpu" }).then(
			() => {
				ImGui.StyleColorsDark();
				ImGui.GetIO().IniSavingRate = 1;
				initialization = true;
			},
		);
		return;
	}

	ImGuiImplWeb.BeginRender();
	if (wantsKeyboard()) heldKeys.clear();
	ImGui.PushFontFloat(null, 14);
	if (ImGui.BeginMainMenuBar()) {
		if (ImGui.Button(paused ? "Play" : "Pause")) {
			if (paused) play();
			else pause();
		}
		if (ImGui.Button("Reset")) restartGame();
		if (ImGui.Button(fpsMode ? "Third person" : "FPS")) toggleFpsMode();
		if (ImGui.Button("TEST")) {
			play();
			startElevatorTest(EArray[cameraEntity[E.PARENT]]);
		}
		if (ImGui.BeginMenu("Warp")) {
			for (const location of warpLocations) if (ImGui.MenuItem(location[0])) {
				play();
				warpPlayer(EArray[cameraEntity[E.PARENT]], location);
			}
			ImGui.EndMenu();
		}
		if (ImGui.Button("NUKE")) {
			debugUnlockElevator();
			for (const entity of EArray) {
				if (![2, 12, 18].includes(entity[E.KIND] & 127)) continue;
				overrides.delete(entity.id);
				entity.fill(0);
			}
		}

		if (ImGui.BeginMenu("Scene")) {
			if (ImGui.MenuItem("Reset")) {
				restartGame();
			}
			if (ImGui.MenuItem("Zoo")) {
				loadZoo();
			}
			if (ImGui.MenuItem("Spheres")) {
				EArray.map((e, id) => {
					if (id > 1) e[E.KIND] = 0;
				});
				for (let i = 1; i < 256; i++) {
					let e = spawn(6);

					e[E.POS_X] = Math.floor(i / 16);
					e[E.POS_Y] = 0;
					e[E.POS_Z] = i % 16;
					if (i > 5) e[E.MAT_OVERRIDE] = i;
				}
			}
			ImGui.EndMenu();
		}

		if (ImGui.BeginMenu("Windows")) {
			if (
				ImGui.MenuItem("Entity Inspector", "", entityInspectorShown[0])
			) {
				entityInspectorShown[0] = !entityInspectorShown[0];
			}
			if (ImGui.MenuItem("Palette", "", paletteShown[0])) {
				paletteShown[0] = !paletteShown[0];
			}
			if (ImGui.MenuItem("Voxel programs", "", voxelEditorOpen[0])) {
				voxelEditorOpen[0] = !voxelEditorOpen[0];
			}
			if (ImGui.MenuItem("Sounds", "", soundsShown[0])) {
				soundsShown[0] = !soundsShown[0];
			}
			ImGui.EndMenu();
		}

		ImGui.EndMainMenuBar();
	}

	if (entityInspectorShown[0]) {
		entityInspector(overrides, entityInspectorShown);
	}

	voxelEditor();

	if (paletteShown[0]) {
		if (ImGui.Begin("Palette", paletteShown)) {
			let p = new Uint8Array(palette.buffer, 0, 256);
			const srgb = (x) =>
				x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055;

			for (let i = 0; i < p.length; i++) {
				let o = i * 4;
				let c = new ImVec4(
					srgb(palette[o] / 255),
					srgb(palette[o + 1] / 255),
					srgb(palette[o + 2] / 255),
					palette[o + 3] / 255,
				);

				ImGui.ColorButton(`Color ${i}`, c, 0, new ImVec2(20, 20));
				if (i % 8 !== 0) {
					ImGui.SameLine();
				}
			}
		}
		ImGui.End();
	}

	if (soundsShown[0]) {
		if (ImGui.Begin("Sounds", soundsShown)) {
			for (let [name, sound] of Object.entries(sounds)) {
				if (ImGui.Button(name)) {
					window.playing?.stop();
					window.playing = sound();
				}
			}
		}
		ImGui.End();
	}

	ImGui.PopFont();
	ImGuiImplWeb.EndRender(passEncoder);
	saveDebugPanels();
}

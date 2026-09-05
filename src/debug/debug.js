import { ImGui, ImGuiImplWeb, ImVec2, ImVec4 } from "@mori2003/jsimgui";
import { d, c, heldKeys } from "../globals.js";
import { cameraPosition, cameraRotation } from "../entities.js";
import { setMarineTrigger } from "../game.js";
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

export const selectEntity = (index) => {
	setSelectedEntity(index);
	entityInspectorShown[0] = true;
};
import Stats from "stats-gl";

export let stats = new Stats({ trackGPU: true, trackCPT: true });
document.body.appendChild(stats.dom);
stats.dom.style.position = "absolute";
stats.dom.style.top = "29px";
stats.dom.style.left = "";
stats.dom.style.right = "0px";
stats.dom.style.width = "360px";
stats.init(d);

// Debug controls move independently of the marine and scene collisions.
let paused = false;
export const isPaused = () => paused;
const pause = () => {
	paused = true;
	setMarineTrigger(false);
};
const play = () => {
	stopLooking();
	heldKeys.clear();
	paused = false;
};
export function updateCamera(deltaTime) {
	if (!isFlying() || wantsKeyboard()) return;
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
	if (pointer !== null && c.hasPointerCapture(pointer)) c.releasePointerCapture(pointer);
};
c.addEventListener("contextmenu", (event) => event.preventDefault());
c.addEventListener("pointerdown", (event) => {
	if (event.button !== 2 || wantsMouse()) return;
	lookPointer = event.pointerId;
	lookX = event.clientX;
	lookY = event.clientY;
	c.setPointerCapture(event.pointerId);
	event.preventDefault();
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

		if (ImGui.BeginMenu("Scene")) {
			if (ImGui.MenuItem("Reset")) {
				restartGame();
			}
			if (ImGui.MenuItem("Spheres")) {
				EArray.map((e, id) => {
					if (id > 1) e[0] = 255;
				});
				for (let i = 1; i < 256; i++) {
					let e = spawn(6);

					e[4] = Math.floor(i / 16);
					e[5] = 0;
					e[6] = i % 16;
					if (i > 5) e[19] = i;
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

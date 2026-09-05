import { ImGui, ImGuiImplWeb, ImVec2, ImVec4 } from "@mori2003/jsimgui";
import { d, c, heldKeys } from "../globals.js";
import { cameraRotation } from "../entities.js";
import { palette } from "../palette.js";
import { entityInspector } from "./entityInspector.js";
import { voxelEditor, voxelEditorOpen } from "./voxelEditor.js";
import { EArray, spawn } from "../entities.js";
import { debugPanel, saveDebugPanels, loadDebugLayout, saveDebugLayout } from "./settings.js";

export { selectEntity } from "./entityInspector.js";
import Stats from 'stats-gl';

export let stats = new Stats({ trackGPU: true, trackCPT: true });
document.body.appendChild(stats.dom);
stats.dom.style.position = 'absolute';
stats.dom.style.top = '29px';
stats.dom.style.left = '';
stats.dom.style.right = '0px';
stats.dom.style.width = '360px';
stats.init(d);

// Gameplay owns WASD and the follow camera. Arrow keys remain a debug-only
// way to inspect the scene's viewing angle without becoming player controls.
export function updateCamera(deltaTime) {
	const turnSpeed = 1.5;
	if (heldKeys.has("arrowleft")) cameraRotation[1] -= turnSpeed * deltaTime;
	if (heldKeys.has("arrowright")) cameraRotation[1] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowup")) cameraRotation[0] += turnSpeed * deltaTime;
	if (heldKeys.has("arrowdown")) cameraRotation[0] -= turnSpeed * deltaTime;
	if (heldKeys.has("q")) cameraRotation[2] += turnSpeed * deltaTime;
	if (heldKeys.has("e")) cameraRotation[2] -= turnSpeed * deltaTime;
	cameraRotation[0] = Math.max(-1.2, Math.min(-0.15, cameraRotation[0]));
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

export const wantsMouse = () => initialization && ImGui.GetIO().WantCaptureMouse;
export const wantsKeyboard = () => initialization && ImGui.GetIO().WantCaptureKeyboard;

export function debug(passEncoder, entities, entitySize, overrides) {
    if (!initialization) {
        if (initializationStarted) return;
        initializationStarted = true;
        ImGuiImplWeb.Init({ canvas: c, device: d, backend: "webgpu" }).then(() => {
            ImGui.StyleColorsDark();
            ImGui.GetIO().IniSavingRate = 1;
            initialization = true;
        });
        return;
    }

	ImGuiImplWeb.BeginRender();
    if (wantsKeyboard()) heldKeys.clear();
    ImGui.PushFontFloat(null, 14);
    if (ImGui.BeginMainMenuBar()) {

        if (ImGui.Button("Reset")) restartGame();

        if (ImGui.BeginMenu("Scene")) {
            if (ImGui.MenuItem("Reset")) {
                restartGame();
            }
            if (ImGui.MenuItem("Spheres")) {
                EArray.map((e, id) => { if (id > 1) e[0] = 255; });
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

            if (ImGui.MenuItem("Entity Inspector", "", entityInspectorShown[0])) {
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
            x <= 0.0031308
            ? x * 12.92
            : 1.055 * x ** (1 / 2.4) - 0.055;

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

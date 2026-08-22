import { ImGui, ImGuiImplWeb, ImVec2, ImVec4 } from "@mori2003/jsimgui";
import { d, c } from "../globals.js";
import { palette } from "../palette.js";
import { entityInspector } from "./entityInspector.js";
import { EArray } from "../entities.js";

export { selectEntity } from "./entityInspector.js";


let initialization = false;

let paletteShown = false;
let entityInspectorShown = false;
let soundsShown = false;

let sounds = await import("../sfx.js");

export const wantsMouse = () => initialization && ImGui.GetIO().WantCaptureMouse;

export function debug(passEncoder, entities, entitySize, overrides) {
    if (!initialization) {
        ImGuiImplWeb.Init({ canvas: c, device: d, backend: "webgpu" }).then(() => {
            ImGui.StyleColorsDark();
            initialization = true;
        });
        return;
    }

	ImGuiImplWeb.BeginRender();
    ImGui.PushFontFloat(null, 14);
    if (ImGui.BeginMainMenuBar()) {
        if (ImGui.MenuItem("Reset")) {
            EArray.map((e, id) => {
                if (id > 1) e[0] = 255;
            });
        }
        if (ImGui.BeginMenu("Windows")) {

            if (ImGui.MenuItem("Entity Inspector", "", entityInspectorShown)) {
                entityInspectorShown = !entityInspectorShown;
            }
            if (ImGui.MenuItem("Palette", "", paletteShown)) {
                paletteShown = !paletteShown;
            }
            if (ImGui.MenuItem("Sounds", "", soundsShown)) {
                soundsShown = !soundsShown;
            }
            ImGui.EndMenu();
        }

        ImGui.EndMainMenuBar();
    }

	if (entityInspectorShown) {
        entityInspector(overrides);
    }

    if (paletteShown) {
        ImGui.Begin("Palette");
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
                1,
            );

            ImGui.ColorButton(`Color ${i}`, c, 0, new ImVec2(20, 20));
            if (i % 21 !== 0) {
                ImGui.SameLine();
            }
        }
        ImGui.End();
    }


    if (soundsShown) {
        ImGui.Begin("Sounds");
        for (let [name, sound] of Object.entries(sounds)) {
            if (ImGui.Button(name)) {
                sound();
            }
        }
        ImGui.End();
    }
    

    ImGui.PopFont();
	ImGuiImplWeb.EndRender(passEncoder);
}

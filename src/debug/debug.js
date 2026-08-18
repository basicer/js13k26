import { ImGui, ImGuiImplWeb, ImVec2, ImVec4 } from "@mori2003/jsimgui";
import { d, c } from "../globals.js";
import { palette } from "../palette.js";
import { entityInspector } from "./entityInspector.js";

export { selectEntity } from "./entityInspector.js";


let initialization = false;

let paletteShown = false;
let entityInspectorShown = true;

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

    if (ImGui.BeginMainMenuBar()) {

        if (ImGui.BeginMenu("Windows")) {
            if (ImGui.MenuItem("Entity Inspector", "", entityInspectorShown)) {
                entityInspectorShown = !entityInspectorShown;
            }
            if (ImGui.MenuItem("Palette", "", paletteShown)) {
                paletteShown = !paletteShown;
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
        let p = new Uint32Array(palette.buffer, 0, 256);
        for (let i = 0; i < p.length; i++) {
            let c = new ImVec4((p[i] >> 16 & 0xFF) / 255, (p[i] >> 8 & 0xFF) / 255, (p[i] & 0xFF) / 255, 1);
            ImGui.ColorButton(`Color ${i}`, c, 0, new ImVec2(20, 20));
            if (i % 21 !== 0) {
                ImGui.SameLine();
            }
        }
        ImGui.End();
    }



	ImGuiImplWeb.EndRender(passEncoder);
}

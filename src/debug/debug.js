import { ImGui, ImGuiImplWeb, ImVec2, ImGuiCond, ImVec4 } from "@mori2003/jsimgui";
import { d, c } from "../globals.js";
import { palette } from "../palette.js";


let initialization = false;
export function debug(passEncoder) {
    if (!initialization) {
        ImGuiImplWeb.Init({ canvas: c, device: d, backend: "webgpu" }).then(() => {
            ImGui.StyleColorsDark();
            initialization = true;
        });
        return;
    }

        
        
	ImGuiImplWeb.BeginRender();

	ImGui.Begin("Palette");
    for (let i = 0; i < palette.length; i++) {
        let c = new ImVec4((palette[i] >> 16 & 0xFF) / 255, (palette[i] >> 8 & 0xFF) / 255, (palette[i] & 0xFF) / 255, 1);
        ImGui.ColorButton(`Color ${i}`, c, 0, new ImVec2(20, 20));
        if (i % 21 !== 0) {
            ImGui.SameLine();
        }
    }
    ImGui.End();



	ImGuiImplWeb.EndRender(passEncoder);
}

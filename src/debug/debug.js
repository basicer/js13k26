import { ImGui, ImGuiImplWeb, ImVec2, ImGuiCond } from "@mori2003/jsimgui";
import { d, c } from "../globals.js";

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

	ImGui.Begin("New Window");
	ImGui.Text("Hello, world!");
	ImGui.End();

	ImGui.SetNextWindowPos(new ImVec2(225, 50), ImGuiCond.Once);
	ImGui.SetNextWindowSize(new ImVec2(330, 200), ImGuiCond.Once);
	ImGui.Begin("jsimgui");
	ImGui.Text("Welcome to jsimgui!");
	ImGui.TextDisabled(`Using ImGui v${ImGui.GetVersion()}-docking`);
	//ImGui.Image(imgRef, new ImVec2(120, 110));
	ImGui.Text("Using WebGPU backend");
	ImGui.End();

	ImGui.ShowDemoWindow();

	ImGuiImplWeb.EndRender(passEncoder);
}

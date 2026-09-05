import {
	ImGui,
	ImGuiCond,
	ImGuiInputTextFlags,
	ImVec2,
} from "@mori2003/jsimgui";
import {
	voxelPrograms,
	voxelParameterIndices,
	queueVoxelPreview,
	resetVoxelProgram,
	storeVoxelDraft,
	saveVoxelProgram,
} from "./voxelPrograms.js";
import { debugPanel } from "./settings.js";
import { VOXEL_CONSTANTS } from "../vvm-symbols.js";

export const voxelEditorOpen = debugPanel("voxelPrograms");
let selectedSlot = 2;
const constantFilter = [""];

export function openVoxelEditor(slot) {
	selectedSlot = slot;
	voxelEditorOpen[0] = true;
}

export function voxelEditor() {
	if (!voxelEditorOpen[0]) return;
	ImGui.SetNextWindowSize(new ImVec2(780, 650), ImGuiCond.FirstUseEver);
	if (ImGui.Begin("Voxel programs", voxelEditorOpen)) {
		if (ImGui.BeginChild("Program slots", new ImVec2(175, 0), 1)) {
			for (const program of voxelPrograms.values()) {
				const dirty = program.text[0] !== program.original ? " *" : "";
				if (
					ImGui.Selectable(
						`${program.slot}: ${program.file.split("/").pop()}${dirty}`,
						selectedSlot === program.slot,
					)
				)
					selectedSlot = program.slot;
			}
		}
		ImGui.EndChild();
		ImGui.SameLine();
		if (ImGui.BeginChild("Program editor", new ImVec2(0, 0))) {
			const program = voxelPrograms.get(selectedSlot);
			if (!program)
				ImGui.TextWrapped(
					"Select a procedural voxel slot. Built-in and DDS volumes have no .vp source.",
				);
			else {
				ImGui.Text(`Slot ${program.slot}: ${program.file}`);
				if (program.text[0] !== program.original)
					ImGui.Text("Local changes");
				if (ImGui.Button("Save .vp")) saveVoxelProgram(program);
				ImGui.SameLine();
				if (ImGui.Button("Reset")) resetVoxelProgram(program);
				if (
					ImGui.SliderInt(
						"Instructions",
						program.instructionLimit,
						0,
						program.instructionEnds.length - 1,
						`%d / ${program.instructionEnds.length - 1}`,
					)
				) {
					queueVoxelPreview(program);
				}
				ImGui.TextWrapped(
					"Drafts autosave locally. Save downloads .vp; Reset restores the bundled model.",
				);
				const parameterIndices = voxelParameterIndices(program.text[0]);
				if (parameterIndices.includes(0)) ImGui.TextWrapped("P0 builds model variants 0 and 1. Select a variant in the entity inspector.");
				if (parameterIndices.some(index => index !== 0)) {
					ImGui.Separator();
					ImGui.Text("Preview parameters");
					for (const index of parameterIndices) {
						if (index === 0) continue;
						if (
							ImGui.InputFloat(
								`Parameter ${index}##parameter-${program.slot}-${index}`,
								program.parameters[index],
							)
						)
							queueVoxelPreview(program);
					}
				}
				ImGui.Separator();
				if (ImGui.CollapsingHeader("Assembler constants")) {
					ImGui.InputText("Filter##constants", constantFilter, 128);
					if (
						ImGui.BeginChild("Constant list", new ImVec2(0, 140), 1)
					) {
						for (const [name, value] of Object.entries(
							VOXEL_CONSTANTS,
						)) {
							if (name.includes(constantFilter[0].toUpperCase()))
								ImGui.Text(`${name} = ${value}`);
						}
					}
					ImGui.EndChild();
				}
				const available = ImGui.GetContentRegionAvail();
				if (
					ImGui.InputTextMultiline(
						`##source-${program.slot}`,
						program.text,
						65536,
						new ImVec2(-1, Math.max(120, available.y - 95)),
						ImGuiInputTextFlags.AllowTabInput,
					)
				) {
					storeVoxelDraft(program);
					program.message = "Draft changed; preview pending.";
					program.error = false;
					queueVoxelPreview(program, 350);
				}
				ImGui.TextWrapped(
					`${program.error ? "Error: " : ""}${program.message}`,
				);
				if (program.storageError)
					ImGui.TextWrapped(program.storageError);
				ImGui.TextWrapped(
					`Compiled program: ${program.bytes} bytes${program.text[0] !== program.applied ? " (last successful compile)" : ""}`,
				);
			}
		}
		ImGui.EndChild();
	}
	ImGui.End();
}

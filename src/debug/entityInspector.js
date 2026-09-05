import { ImGui, ImGuiListClipper, ImVec2, ImGuiCond } from "@mori2003/jsimgui";
import { EArray } from "../entities";
import { voxelPrograms } from "./voxelPrograms.js";
import { openVoxelEditor } from "./voxelEditor.js";
let selectedEntity = 0;

export const selectEntity = (index) => selectedEntity = index;

export function entityInspector(overrides, open) {
	ImGui.SetNextWindowSize(new ImVec2(620, 440), ImGuiCond.FirstUseEver);
	if (!ImGui.Begin("Entities", open)) {
		ImGui.End();
		return;
	}
	let entities = EArray.filter( x => x[0] !== 255); // Filter out empty entities

	const entityCount = entities.length;
	if (ImGui.BeginChild("Entity list", new ImVec2(190, 0), 1)) {
		const clipper = ImGuiListClipper.New();
		clipper.Begin(entityCount);
		while (clipper.Step()) {
			for (let i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
				const kind = Math.round(entities[i][0]);
				const id = entities[i].id;
				if (kind === 255) continue; // Skip empty entities
				const label = id === 0 ? `0  Camera##entity-${id}` : `${id}  Kind ${kind}##entity-${id}`;
				if (ImGui.Selectable(label, selectedEntity === id)) selectedEntity = id;
			}
		}
		clipper.Drop();
	}
	ImGui.EndChild();
	ImGui.SameLine();
	ImGui.BeginChild("Entity details", new ImVec2(0, 0), 1);
	ImGui.Text(selectedEntity === 0 ? "Entity 0 — Camera" : `Entity ${selectedEntity}`);
	ImGui.Separator();

	const entity = EArray[selectedEntity];
	const kind = [Math.round(entity[0])];
	const pointLight = [entity[1]];
	const parent = [Math.round(entity[2])];
	const position = [entity[4], entity[5], entity[6]];
	const rotation = [entity[8], entity[9], entity[10]];
	const scale = [entity[12], entity[13], entity[14]];
	const tiling = [entity[16], entity[17], entity[18]];
	const matOverride = [Math.round(entity[19])];
	let changed = false;
	if (ImGui.InputInt("Kind", kind, 1, 10)) {
		entity[0] = Math.max(0, Math.min(255, kind[0]));
		changed = true;
	}
	const program = voxelPrograms.get(Math.round(entity[0]));
	if (program) {
		ImGui.Text(program.file);
		if (ImGui.Button("Edit voxel model")) openVoxelEditor(program.slot);
	}
	if (ImGui.DragFloat("Point light", pointLight, 0.1, 0, 100)) {
		entity[1] = pointLight[0];
		changed = true;
	}
	if (ImGui.InputInt("Parent", parent, 1, 10)) {
		entity[2] = Math.max(0, Math.min(EArray.length - 1, parent[0]));
		changed = true;
	}
	if (ImGui.DragFloat3("Position", position, 0.05)) {
		entity.set(position, 4);
		changed = true;
	}
	if (ImGui.DragFloat3("Rotation (rad)", rotation, 0.01)) {
		entity.set(rotation, 8);
		changed = true;
	}
	if (ImGui.DragFloat3("Scale", scale, 0.01)) {
		entity.set(scale, 12);
		changed = true;
	}
	if (ImGui.DragFloat3("Tiling (0=1, -1=scale, -2=64/u)", tiling, 0.1, -2)) {
		entity.set(tiling, 16);
		changed = true;
	}
	if (ImGui.InputInt("Material override (0=off)", matOverride, 1, 10)) {
		entity[19] = Math.max(0, Math.min(255, matOverride[0]));
		changed = true;
	}
	if (ImGui.Button("Clone")) {
		let empty = EArray.findIndex(e => e[0] === 255);
		console.log("Cloning entity", selectedEntity, "to empty slot", empty);
		EArray[empty].set(entity);
		changed = true;
		selectedEntity = empty;
	}
	if (changed && selectedEntity !== 0) overrides.set(selectedEntity, entity.slice());
	if (selectedEntity !== 0 && overrides.has(selectedEntity)) {
		ImGui.Text("Simulation override active");
		if (ImGui.Button("Resume simulation")) overrides.delete(selectedEntity);
	}
	ImGui.EndChild();
	ImGui.End();
}

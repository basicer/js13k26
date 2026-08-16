import { ImGui, ImGuiListClipper, ImVec2, ImGuiCond } from "@mori2003/jsimgui";

let selectedEntity = 0;

export const selectEntity = (index) => selectedEntity = index;

export function entityInspector(entities, entitySize, overrides) {
	ImGui.SetNextWindowSize(new ImVec2(620, 440), ImGuiCond.FirstUseEver);
	ImGui.Begin("Entities");
	const entityCount = entities.length / entitySize;
	if (ImGui.BeginChild("Entity list", new ImVec2(190, 0), 1)) {
		const clipper = ImGuiListClipper.New();
		clipper.Begin(entityCount);
		while (clipper.Step()) {
			for (let i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
				const kind = Math.round(entities[i * entitySize]);
				const label = i === 0 ? `0  Camera##entity-${i}` : `${i}  Kind ${kind}##entity-${i}`;
				if (ImGui.Selectable(label, selectedEntity === i)) selectedEntity = i;
			}
		}
		clipper.Drop();
	}
	ImGui.EndChild();
	ImGui.SameLine();
	ImGui.BeginChild("Entity details", new ImVec2(0, 0), 1);
	ImGui.Text(selectedEntity === 0 ? "Entity 0 — Camera" : `Entity ${selectedEntity}`);
	ImGui.Separator();

	const offset = selectedEntity * entitySize;
	const entity = entities.subarray(offset, offset + entitySize);
	const kind = [Math.round(entity[0])];
	const position = [entity[4], entity[5], entity[6]];
	const rotation = [entity[8], entity[9], entity[10]];
	let changed = false;
	if (ImGui.InputInt("Kind", kind, 1, 10)) {
		entity[0] = Math.max(0, Math.min(255, kind[0]));
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
	if (changed && selectedEntity !== 0) overrides.set(selectedEntity, entity.slice());
	if (selectedEntity !== 0 && overrides.has(selectedEntity)) {
		ImGui.Text("Simulation override active");
		if (ImGui.Button("Resume simulation")) overrides.delete(selectedEntity);
	}
	ImGui.EndChild();
	ImGui.End();
}

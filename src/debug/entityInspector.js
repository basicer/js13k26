import * as E from "../entities-const.js";
import { ImGui, ImGuiListClipper, ImVec2, ImGuiCond } from "@mori2003/jsimgui";
import { EArray } from "../entities";
import { voxelPrograms } from "./voxelPrograms.js";
import { openVoxelEditor } from "./voxelEditor.js";
let selectedEntity = 0;
const marinePartNames = { 1: "Marine", 8: "Marine legs", 9: "Marine body", 10: "Marine arms", 11: "Marine gun", 15: "Computer console", 16: "Wooden crate" };

export const selectEntity = (index) => selectedEntity = index;

export function entityInspector(overrides, open) {
	ImGui.SetNextWindowSize(new ImVec2(620, 440), ImGuiCond.FirstUseEver);
	if (!ImGui.Begin("Entities", open)) {
		ImGui.End();
		return;
	}
	let entities = EArray.filter( x => x[E.KIND] !== 0); // Filter out empty entities

	const entityCount = entities.length;
	if (ImGui.BeginChild("Entity list", new ImVec2(190, 0), 1)) {
		const clipper = ImGuiListClipper.New();
		clipper.Begin(entityCount);
		while (clipper.Step()) {
			for (let i = clipper.DisplayStart; i < clipper.DisplayEnd; i++) {
				const kind = Math.round(entities[i][E.KIND]);
				const id = entities[i].id;
				if (kind === 0) continue; // Skip empty entities
				const label = id === 0 ? `0  Camera##entity-${id}` : `${id}  ${marinePartNames[kind] || `Kind ${kind}`}##entity-${id}`;
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
	const kind = [Math.round(entity[E.KIND])];
	const spotlight = [entity[E.SPOTLIGHT]];
	const lightAngle = [entity[E.LIGHT_ANGLE]];
	const parent = [Math.round(entity[E.PARENT])];
	const dissolve = [entity[E.DISSOLVE]];
	const dissolvePalette = [Math.round(entity[E.DISSOLVE_PALETTE])];
	const transparency = [entity[E.TRANSPARENCY]];
	const position = [entity[E.POS_X], entity[E.POS_Y], entity[E.POS_Z]];
	const rotation = [entity[E.ROT_X], entity[E.ROT_Y], entity[E.ROT_Z]];
	const scale = [entity[E.SCALE_X], entity[E.SCALE_Y], entity[E.SCALE_Z]];
	const tiling = [entity[E.TILE_X], entity[E.TILE_Y], entity[E.TILE_Z]];
	const matOverride = [Math.round(entity[E.MAT_OVERRIDE])];
	const modelVariant = [entity[E.MODEL_VARIANT] >= 0.5];
	const velocity = Array.from(entity.subarray(E.VELOCITY, E.VELOCITY + 3));
	const ttl = [entity[E.TTL]];
	let changed = false;
	const solid = [!!entity[E.SOLID]];
	if (ImGui.Checkbox("Solid box", solid)) {
		entity[E.SOLID] = Number(solid[0]);
		changed = true;
	}
	for (const [slot, label] of [[E.HIT_RADIUS, "Hit sphere radius (local, 0 = box)"], [E.HIT_CENTER_Y, "Hit sphere center Y (local)"]]) {
		const value = [entity[slot]];
		if (ImGui.DragFloat(label, value, 0.01)) {
			entity[slot] = slot === E.HIT_RADIUS ? Math.max(0, value[0]) : value[0];
			changed = true;
		}
	}
	if (ImGui.InputInt("Kind", kind, 1, 10)) {
		entity[E.KIND] = Math.max(0, Math.min(255, kind[0]));
		changed = true;
	}
	const program = voxelPrograms.get(Math.round(entity[E.KIND]) & 127);
	if (program) {
		ImGui.Text(program.file);
		if (ImGui.Button("Edit voxel model")) openVoxelEditor(program.slot);
	}
	if (ImGui.Checkbox("Model variant 1", modelVariant)) {
		entity[E.MODEL_VARIANT] = Number(modelVariant[0]);
		changed = true;
	}
	if (ImGui.DragFloat("Spotlight intensity", spotlight, 0.1, 0, 100)) {
		entity[E.SPOTLIGHT] = spotlight[0];
		changed = true;
	}
	if (ImGui.SliderFloat("Light cone (rad, 2PI = point)", lightAngle, 0, Math.PI * 2)) {
		entity[E.LIGHT_ANGLE] = lightAngle[0];
		changed = true;
	}
	if (ImGui.InputInt("Parent", parent, 1, 10)) {
		entity[E.PARENT] = Math.max(0, Math.min(EArray.length - 1, parent[0]));
		changed = true;
	}
	if (ImGui.SliderFloat("Dissolve", dissolve, 0, 1)) {
		entity[E.DISSOLVE] = Math.max(0, Math.min(1, dissolve[0]));
		changed = true;
	}
	if (ImGui.InputInt("Dissolve palette (0=remove)", dissolvePalette, 1, 10)) {
		entity[E.DISSOLVE_PALETTE] = Math.max(0, Math.min(255, dissolvePalette[0]));
		changed = true;
	}
	if (ImGui.SliderFloat("Transparency", transparency, 0, 1)) {
		entity[E.TRANSPARENCY] = Math.max(0, Math.min(1, transparency[0]));
		if (entity[E.KIND] > 0 && entity[E.KIND] < 254) {
			entity[E.KIND] = (entity[E.KIND] & 127) + (entity[E.TRANSPARENCY] > 0 ? 128 : 0);
		}
		changed = true;
	}
	if (ImGui.DragFloat3("Position", position, 0.05)) {
		entity.set(position, E.POS);
		changed = true;
	}
	if (ImGui.DragFloat3("Velocity", velocity, 0.05)) {
		entity.set(velocity, E.VELOCITY);
		changed = true;
	}
	if (ImGui.DragFloat("TTL (seconds, 0 = forever)", ttl, 0.05)) {
		entity[E.TTL] = ttl[0];
		entity[E.AGE] = 0;
		changed = true;
	}
	if (ImGui.DragFloat3("Rotation (rad)", rotation, 0.01)) {
		entity.set(rotation, E.ROT);
		changed = true;
	}
	if (ImGui.DragFloat3("Scale", scale, 0.01)) {
		entity.set(scale, E.SCALE);
		changed = true;
	}
	if (ImGui.DragFloat3("Tiling (0=1, -1=scale, -2=64/u)", tiling, 0.1, -2)) {
		entity.set(tiling, E.TILE);
		changed = true;
	}
	if (ImGui.InputInt("Material override (0=off)", matOverride, 1, 10)) {
		entity[E.MAT_OVERRIDE] = Math.max(0, Math.min(255, matOverride[0]));
		changed = true;
	}
	if (ImGui.Button("Clone")) {
		let empty = EArray.findIndex(e => e[E.KIND] === 0);
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

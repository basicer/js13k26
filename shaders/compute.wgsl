#import "structs.wgsl"

struct PointLight {
    position: vec3<f32>,
    intensity: f32,
};

struct PointLightCounter {
    count: atomic<u32>,
};

@group(0) @binding(0)
var<storage, read_write> entities: array<Entity>;
@group(0) @binding(1)
var<storage, read_write> point_light_counter: PointLightCounter;
@group(0) @binding(2)
var<storage, read_write> point_lights: array<PointLight>;

const MAX_POINT_LIGHTS = 32u;

fn world_transform(index: u32) -> mat4x4<f32> {
    let entity_scale = entities[index].scale;
    var transform = local_transform(entities[index], vec3<f32>(entity_scale.x, entity_scale.y, entity_scale.z));
    var parent = entities[index].parent;
    var current = index;
    for (var depth = 0u; depth < 5u && parent > 0.0f; depth++) {
        let parent_index = u32(parent);
        if (parent_index >= arrayLength(&entities) || parent_index == current) { break; }
        transform = local_transform(entities[parent_index], vec3<f32>(1.0f)) * transform;
        current = parent_index;
        parent = entities[parent_index].parent;
    }
    return transform;
}

@compute @workgroup_size(64)
fn build_point_lights(@builtin(global_invocation_id) id: vec3<u32>) {
    let entity_index = id.x;
    if (entity_index >= arrayLength(&entities)) { return; }

    let entity = entities[entity_index];
    if (entity.kind == 255.0f || entity.point_light <= 0.0f) { return; }

    let light_index = atomicAdd(&point_light_counter.count, 1u);
    if (light_index < MAX_POINT_LIGHTS) {
        point_lights[light_index] = PointLight(world_transform(entity_index)[3].xyz, entity.point_light);
    }
}

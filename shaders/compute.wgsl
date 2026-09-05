#import "structs.wgsl"

struct PointLightCounter {
    count: atomic<u32>,
};

@group(0) @binding(0)
var<storage, read_write> entities: array<Entity>;
@group(0) @binding(1)
var<storage, read_write> point_light_counter: PointLightCounter;
@group(0) @binding(2)
var<storage, read_write> point_lights: array<SpotLight>;

@group(0) @binding(3)
var<uniform> frame: vec4<f32>;

@compute @workgroup_size(64)
fn update_entities(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= arrayLength(&entities) || frame.w == 0.0f) { return; }
    var entity = entities[id.x];
    if (entity.kind == 255.0f) { return; }
    let dt = frame.w;
    if (entity.ttl != 0x7f800000u) {
        let ttl = bitcast<f32>(entity.ttl) - dt;
        if (ttl < 0.0f) {
            entities[id.x] = Entity();
            entities[id.x].kind = 255.0f;
            return;
        }
        entity.ttl = bitcast<u32>(ttl);
    }
    entity.pos += entity.velocity * dt;
    // Particle gravity and ground settling; tracers retain constant velocity.
    if ((u32(entity.kind) & 127u) == 6u && any(entity.velocity != vec3<f32>(0.0f))) {
        entity.velocity.y -= select(7.0f, 11.0f, entity.matOverride == 249.0f) * dt;
        let floor = -30.0f / 64.0f + entity.scale.y * 0.38f;
        if (entity.pos.y <= floor + 0.000001f) {
            entity.pos.y = floor;
            entity.velocity.y = 0.0f;
        }
    }
    entities[id.x] = entity;
}

const MAX_POINT_LIGHTS = 32u;

fn world_transform(index: u32) -> mat4x4<f32> {
    var transform = local_transform(entities[index], entities[index].scale);
    var parent = entities[index].parent;
    var current = index;
    for (var depth = 0u; depth < 5u && parent > 0.0f; depth++) {
        let parent_index = u32(parent);
        if (parent_index >= arrayLength(&entities) || parent_index == current) { break; }
        transform = local_transform(entities[parent_index], entities[parent_index].scale) * transform;
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
        let transform = world_transform(entity_index);
        let axis = transform[2].xyz;
        point_lights[light_index] = SpotLight(transform[3].xyz, entity.point_light,
            axis / max(length(axis), 0.000001f), cos(clamp(entity.light_angle, 0.0f, 6.283185307f) * 0.5f));
    }
}

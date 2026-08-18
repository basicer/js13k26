struct Entity {
    kind: f32,
    point_light: f32,
    _2: f32,
    _3: f32,
    pos: vec3<f32>,
    _7: f32,
    rot: vec3<f32>,
    _8: f32
};

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

@compute @workgroup_size(64)
fn build_point_lights(@builtin(global_invocation_id) id: vec3<u32>) {
    let entity_index = id.x;
    if (entity_index >= arrayLength(&entities)) { return; }

    let entity = entities[entity_index];
    if (entity.kind == 255.0f || entity.point_light <= 0.0f) { return; }

    let light_index = atomicAdd(&point_light_counter.count, 1u);
    if (light_index < MAX_POINT_LIGHTS) {
        point_lights[light_index] = PointLight(entity.pos, entity.point_light);
    }
}

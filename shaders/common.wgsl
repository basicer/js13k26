struct Entity {
    kind: f32,
    point_light: f32,
    parent: f32,
    dissolve: f32,
    pos: vec3<f32>,
    transparency: f32,
    rot: vec3<f32>,
    dissolvePalette: f32,
    scale: vec3<f32>,
    modelVariant: f32,
    tile: vec3<f32>,
    matOverride: f32,
    velocity: vec3<f32>,
    // Preserve CPU float bits; +Infinity must never enter shader arithmetic.
    ttl: u32,
    light_angle: f32,
    padding: array<f32, 3>,
};

fn rotation_matrix(rotation: vec3<f32>) -> mat3x3<f32> {
    let cos_pitch = cos(rotation.x);
    let forward = vec3<f32>(sin(rotation.y) * cos_pitch, sin(rotation.x), -cos(rotation.y) * cos_pitch);
    // Derive right from yaw: crossing with world-up degenerates at +/-90 pitch.
    let base_right = vec3<f32>(cos(rotation.y), 0.0f, sin(rotation.y));
    let base_up = cross(base_right, forward);
    let right = base_right * cos(rotation.z) + base_up * sin(rotation.z);
    let up = base_up * cos(rotation.z) - base_right * sin(rotation.z);
    return mat3x3<f32>(right, up, -forward);
}

fn local_transform(entity: Entity, entity_scale: vec3<f32>) -> mat4x4<f32> {
    let rotation = rotation_matrix(entity.rot);
    return mat4x4<f32>(
        vec4<f32>(rotation[0] * entity_scale.x, 0.0f),
        vec4<f32>(rotation[1] * entity_scale.y, 0.0f),
        vec4<f32>(rotation[2] * entity_scale.z, 0.0f),
        vec4<f32>(entity.pos, 1.0f),
    );
}

// Full cone width is stored on Entity; the collector caches its half-angle cosine.
struct SpotLight {
    position: vec3<f32>,
    intensity: f32,
    direction: vec3<f32>,
    cutoff: f32,
};


struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) @interpolate(flat) idx: u32,
    @location(1) world_position: vec3<f32>,
};

struct FragmentOutput {
    @location(0) color: vec4<f32>,
    @location(1) pick: vec2<u32>,
    @builtin(frag_depth) depth: f32,
};

struct VoxelHit {
    distance: f32,
    material: f32,
    normal: vec3<f32>,
};

struct RenderState {
    time: f32,
    aspect: f32,
    fov: f32,
    dt: f32,
};

const NEAR_PLANE = 0.1f;
const FAR_PLANE = 100.0f;

fn clip_depth(view_z: f32) -> f32 {
    return view_z * FAR_PLANE / (FAR_PLANE - NEAR_PLANE) - NEAR_PLANE * FAR_PLANE / (FAR_PLANE - NEAR_PLANE);
}

@group(0) @binding(0)
var<uniform> render_state: RenderState;
@group(0) @binding(1)
var<storage, read> entities: array<Entity>;
@group(0) @binding(2)
var palette: texture_storage_2d<rgba8unorm, read>;
@group(0) @binding(3)
var<storage, read> point_lights: array<SpotLight>;

const MAX_POINT_LIGHTS = 32u;

fn world_transform(index: u32, dt: f32) -> mat4x4<f32> {
    var entity = step_entity(entities[index], dt);
    var transform = local_transform(entity, entity.scale);
    var parent = entity.parent;
    var current = index;
    for (var depth = 0u; depth < 5u && parent > 0.0f; depth++) {
        let parent_index = u32(parent);
        if (parent_index >= arrayLength(&entities) || parent_index == current) { break; }
        entity = step_entity(entities[parent_index], dt);
        transform = local_transform(entity, entity.scale) * transform;
        current = parent_index;
        parent = entity.parent;
    }
    return transform;
}


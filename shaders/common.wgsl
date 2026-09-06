struct Entity {
    kind: f32,
    spotlight: f32,
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
    // Zero lives forever; negative lifetimes expire on the next simulation step.
    ttl: f32,
    light_angle: f32,
    health: f32,
    walk: f32,
    age: f32,
    solid: f32,
    hitRadius: f32,
    hitCenterY: f32,
    // Positive rate advances to the target; reaching one releases the entity.
    dissolveRate: f32,
    // World units per animation step; zero disables walking animation.
    walkStride: f32,
    dissolveTarget: f32,
    gravity: f32,
    maxHealth: f32,
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
    position: vec3<f32>,
    cell: vec3<i32>,
};

struct RenderState {
    time: f32,
    aspect: f32,
    fov: f32,
    padding: f32,
    mouse: vec4<f32>,
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
var<storage, read> light_entities: array<u32>;

const MAX_SPOTLIGHTS = 32u;

fn world_transform(index: u32) -> mat4x4<f32> {
    var current = index;
    var transform = mat4x4<f32>(
        vec4<f32>(1.0f, 0.0f, 0.0f, 0.0f),
        vec4<f32>(0.0f, 1.0f, 0.0f, 0.0f),
        vec4<f32>(0.0f, 0.0f, 1.0f, 0.0f),
        vec4<f32>(0.0f, 0.0f, 0.0f, 1.0f),
    );
    loop {
        let entity = entities[current];
        transform = local_transform(entity, entity.scale) * transform;
        current = u32(entity.parent);
        if (current == 0u) { break; }
    }
    return transform;
}



struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) @interpolate(flat) idx: u32,
    @location(1) world_position: vec3<f32>,
};

struct FragmentOutput {
    @location(0) color: vec4<f32>,
    @builtin(frag_depth) depth: f32,
};

struct VoxelHit {
    distance: f32,
    material: f32,
    normal: vec3<f32>,
};

struct Camera {
    time: f32,
    aspect: f32,
    viewport_size: vec2<f32>,
    position: vec3<f32>,
    fov: f32,
    look_direction: vec3<f32>,
    roll: f32,
};

struct Entity {
    kind: f32,
    _0: f32,
    _1: f32,
    _2: f32,
    pos: vec3<f32>,
    _3: f32
};

const NEAR_PLANE = 0.1f;
const FAR_PLANE = 100.0f;

fn clip_depth(view_z: f32) -> f32 {
    return view_z * FAR_PLANE / (FAR_PLANE - NEAR_PLANE) - NEAR_PLANE * FAR_PLANE / (FAR_PLANE - NEAR_PLANE);
}

fn fragment_depth(view_z: f32) -> f32 {
    return clip_depth(view_z) / view_z;
}

@group(0) @binding(0)
var<uniform> camera: Camera;
@group(0) @binding(1)
var<storage> entities: array<Entity>;
@group(0) @binding(2)
var palette: texture_storage_2d<rgba8unorm, read>;

fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
    let l = clamp(hsl.z, 0.0f, 1.0f);
    let hue_rgb = clamp(
        abs(fract(fract(hsl.x) + vec3<f32>(0.0f, 2.0f / 3.0f, 1.0f / 3.0f)) * 6.0f - 3.0f) - 1.0f,
        vec3<f32>(0.0f),
        vec3<f32>(1.0f),
    );
    let chroma = (1.0f - abs(2.0f * l - 1.0f)) * clamp(hsl.y, 0.0f, 1.0f);;
    return l + (hue_rgb - vec3<f32>(0.5f)) * chroma;
}

fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0f) - f0) * pow(1.0f - cos_theta, 5.0f);
}

fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
    let a2 = roughness * roughness * roughness * roughness;
    let denominator = n_dot_h * n_dot_h * (a2 - 1.0f) + 1.0f;
    return a2 / max(3.14159265f * denominator * denominator, 0.0001f);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0f) * (roughness + 1.0f) * 0.125f;
    return n_dot_v / max(n_dot_v * (1.0f - k) + k, 0.0001f);
}

fn shade_pbr(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32) -> vec3<f32> {
    let perceptual_roughness = max(roughness, 0.045f);
    let light_direction = normalize(vec3<f32>(-0.4f, 0.8f, -0.5f));
    let half_vector = normalize(view + light_direction);
    let n_dot_l = max(dot(normal, light_direction), 0.0f);
    let n_dot_v = max(dot(normal, view), 0.0f);
    let n_dot_h = max(dot(normal, half_vector), 0.0f);
    let h_dot_v = max(dot(half_vector, view), 0.0f);
    let f0 = mix(vec3<f32>(0.04f), base_color, metalness);
    let fresnel = fresnel_schlick(h_dot_v, f0);
    let specular = distribution_ggx(n_dot_h, perceptual_roughness) *
        geometry_schlick_ggx(n_dot_v, perceptual_roughness) * geometry_schlick_ggx(n_dot_l, perceptual_roughness) * fresnel /
        max(4.0f * n_dot_v * n_dot_l, 0.0001f);
    let diffuse = (vec3<f32>(1.0f) - fresnel) * (1.0f - metalness) * base_color / 3.14159265f;
    let ambient = base_color * (0.22f + 0.18f * max(normal.y, 0.0f)) * (1.0f - metalness);
    let reflection = reflect(-view, normal);
    let sky = mix(vec3<f32>(0.06f, 0.04f, 0.03f), vec3<f32>(1.4f, 1.8f, 2.4f), reflection.y * 0.5f + 0.5f);
    let environment_specular = sky * fresnel_schlick(n_dot_v, f0) * mix(0.15f, 0.9f, metalness) * (1.0f - perceptual_roughness * 0.45f);
    return ambient + environment_specular + (diffuse + specular) * n_dot_l * vec3<f32>(4.0f);
}

@vertex
fn vs_main(
    @builtin(instance_index) idx: u32,
    @location(0) pos: vec3<f32>
) -> VertexOutput {

    var out: VertexOutput;
    out.idx = idx;

    // This draw call has one voxel texture bound. Clip instances whose kind
    // belongs to a different texture before they reach rasterization.
    if (u32(entities[idx].kind) != current_vox_kind) {
        out.clip_position = vec4<f32>(0.0f, 0.0f, 2.0f, 1.0f);
        return out;
    }

    let forward = normalize(camera.look_direction);
    let base_right = normalize(cross(forward, vec3<f32>(0.0f, 1.0f, 0.0f)));
    let base_up = cross(base_right, forward);
    let roll = camera.roll;
    let right = base_right * cos(roll) + base_up * sin(roll);
    let up = base_up * cos(roll) - base_right * sin(roll);
    let entity_center = vec3<f32>(
        f32(idx % 30u) * 1.35f - 0.5f,
        -0.5f,
        f32(idx / 30u) * 1.35f - 0.5f,
    ) + entities[idx].pos;
    // Rasterize the containment cube directly in world space. The fragment
    // shader still finds the real voxel hit, then supplies its true depth.
    let world_position = entity_center + pos * 0.6f;
    out.world_position = world_position;
    let from_camera = world_position - camera.position;
    let view_position = vec3<f32>(
        dot(from_camera, right),
        dot(from_camera, up),
        // WebGPU's clip-space depth is positive in front of this camera.
        dot(from_camera, forward),
    );

    let focal_length = 1.0f / tan(radians(camera.fov) * 0.5f);
    let aspect = camera.aspect;
    out.clip_position = vec4<f32>(
        view_position.x * focal_length / aspect,
        view_position.y * focal_length,
        clip_depth(view_position.z),
        view_position.z,
    );
    return out;
}

@group(1) @binding(0) var vox: texture_3d<f32>;
@group(1) @binding(1) var<uniform> current_vox_kind: u32;

fn voxel_search(ray_origin: vec3<f32>, ray_direction: vec3<f32>) -> VoxelHit {
    let safe_direction = select(ray_direction, vec3<f32>(0.000001f), abs(ray_direction) < vec3<f32>(0.000001f));
    let inverse_direction = 1.0f / safe_direction;
    let bounds_near = min((vec3<f32>(0.0f) - ray_origin) * inverse_direction,
        (vec3<f32>(1.0f) - ray_origin) * inverse_direction);
    let bounds_far = max((vec3<f32>(0.0f) - ray_origin) * inverse_direction,
        (vec3<f32>(1.0f) - ray_origin) * inverse_direction);
    var distance = max(max(bounds_near.x, bounds_near.y), max(bounds_near.z, 0.0f));
    let exit_distance = min(min(bounds_far.x, bounds_far.y), bounds_far.z);
    if (distance > exit_distance) { return VoxelHit(0.0f, 0.0f, vec3<f32>(0.0f)); }

    let volume_size = vec3<i32>(textureDimensions(vox));
    let point = ray_origin + ray_direction * (distance + 0.0001f);
    var cell = clamp(vec3<i32>(floor(point * vec3<f32>(volume_size))), vec3<i32>(0), volume_size - vec3<i32>(1));
    let step = select(vec3<i32>(-1), vec3<i32>(1), ray_direction >= vec3<f32>(0.0f));
    let cell_size = 1.0f / vec3<f32>(volume_size);
    let delta_distance = abs(cell_size / safe_direction);
    let boundary = (vec3<f32>(cell) + select(vec3<f32>(0.0f), vec3<f32>(1.0f), safe_direction >= vec3<f32>(0.0f))) * cell_size;
    var side_distance = distance + (boundary - point) / safe_direction;
    var normal = vec3<f32>(0.0f, 1.0f, 0.0f);
    for (var step_count = 0; step_count < 256; step_count++) {
        let material = textureLoad(vox, cell, 0).x;
        if (material > 0.0f) { return VoxelHit(distance, material, normal); }
        let smallest = side_distance < min(side_distance.yzx, side_distance.zxy);
        let mask = select(vec3<f32>(0.0f), vec3<f32>(1.0f), smallest);
        distance = length(side_distance * mask);
        cell += step * select(vec3<i32>(0), vec3<i32>(1), smallest);
        side_distance += delta_distance * mask;
        normal = -vec3<f32>(step) * mask;
        if (distance > exit_distance || any(cell < vec3<i32>(0)) || any(cell >= volume_size)) { break; }
    }
    return VoxelHit(0.0f, 0.0f, vec3<f32>(0.0f));
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    let e = entities[in.idx];
    let scale = 0.6f;
    let entity_center = vec3<f32>(
        f32(in.idx % 30u) * 1.35f - 0.5f,
        -0.5f,
        f32(in.idx / 30u) * 1.35f - 0.5f,
    ) + e.pos;

    let world_ray = normalize(in.world_position - camera.position);
    let ray_origin = (camera.position - entity_center) / scale + vec3<f32>(0.5f);
    let ray_direction = world_ray / scale;
    let hit = voxel_search(ray_origin, ray_direction);
    if (hit.material == 0.0f) { discard; }
    let color = textureLoad(palette, vec2<u32>(u32(hit.material), 0));
    let surface = textureLoad(palette, vec2<u32>(u32(hit.material), 1));
    let hit_world = camera.position + world_ray * hit.distance;
    let view_depth = dot(hit_world - camera.position, normalize(camera.look_direction));
    let depth = fragment_depth(view_depth);
    let view = normalize(camera.position - hit_world);
    return FragmentOutput(vec4<f32>(shade_pbr(color.rgb, hit.normal, view, surface.r, surface.g), color.a), depth);
}

#import "structs.wgsl"

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) @interpolate(flat) idx: u32,
    @location(1) world_position: vec3<f32>,
    @location(2) scale: vec3<f32>,
};

struct FragmentOutput {
    @location(0) color: vec4<f32>,
    @location(1) entity_index: u32,
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
};

struct PointLight {
    position: vec3<f32>,
    intensity: f32,
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
var<storage, read> point_lights: array<PointLight>;

const MAX_POINT_LIGHTS = 32u;

fn look_direction(rotation: vec3<f32>) -> vec3<f32> {
    let cos_pitch = cos(rotation.x);
    return vec3<f32>(
        sin(rotation.y) * cos_pitch,
        sin(rotation.x),
        -cos(rotation.y) * cos_pitch,
    );
}

fn rotation_matrix(rotation: vec3<f32>) -> mat3x3<f32> {
    let forward = look_direction(rotation);
    let base_right = normalize(cross(forward, vec3<f32>(0.0f, 1.0f, 0.0f)));
    let base_up = cross(base_right, forward);
    let right = base_right * cos(rotation.z) + base_up * sin(rotation.z);
    let up = base_up * cos(rotation.z) - base_right * sin(rotation.z);
    return mat3x3<f32>(right, up, -forward);
}

fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0f) - f0) * pow(1.0f - cos_theta, 5.0f);
}

fn distribution_ggx(n_dot_h: f32, roughness: f32) -> f32 {
    let a2 = pow(roughness, 4.0f);
    let denominator = n_dot_h * n_dot_h * (a2 - 1.0f) + 1.0f;
    return a2 / max(3.14159265f * denominator * denominator, 0.0001f);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0f) * (roughness + 1.0f) * 0.125f;
    return n_dot_v / max(n_dot_v * (1.0f - k) + k, 0.0001f);
}

fn shade_pbr(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, world_position: vec3<f32>, ao: f32) -> vec3<f32> {
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
    let ambient = base_color * (0.22f + 0.18f * max(normal.y, 0.0f)) * (1.0f - metalness) * ao;
    let reflection = reflect(-view, normal);
    let sky = mix(vec3<f32>(0.06f, 0.04f, 0.03f), vec3<f32>(1.4f, 1.8f, 2.4f), reflection.y * 0.5f + 0.5f);
    let environment_specular = sky * fresnel_schlick(n_dot_v, f0) * mix(0.15f, 0.9f, metalness) * (1.0f - perceptual_roughness * 0.45f);
    var point_lighting = vec3<f32>(0.0f);
    for (var i = 0u; i < MAX_POINT_LIGHTS; i++) {
        let light = point_lights[i];
        if (light.intensity <= 0.0f) { continue; }
        let to_light = light.position - world_position;
        let distance_squared = max(dot(to_light, to_light), 0.001f);
        let light_direction = to_light * inverseSqrt(distance_squared);
        let irradiance = max(dot(normal, light_direction), 0.0f) * light.intensity / (1.0f + distance_squared);
        point_lighting += base_color * irradiance;
    }
    return ambient + environment_specular + (diffuse + specular) * n_dot_l * vec3<f32>(4.0f) + point_lighting;
}

@vertex
fn vs_main(
    @builtin(instance_index) idx: u32,
    @location(0) pos: vec3<f32>
) -> VertexOutput {
    let entity_index = idx & 65535u;
    let current_vox_kind = idx >> 16u;
    var out: VertexOutput;
    out.idx = entity_index;

    // This draw call has one voxel texture bound. Clip instances whose kind
    // belongs to a different texture before they reach rasterization.
    if (u32(entities[entity_index].kind) != current_vox_kind) {
        out.clip_position = vec4<f32>(0.0f, 0.0f, 2.0f, 1.0f);
        return out;
    }

    let camera_entity = entities[0];
    let camera_rotation = rotation_matrix(camera_entity.rot);
    let forward = -camera_rotation[2];
    let right = camera_rotation[0];
    let up = camera_rotation[1];
    let entity = entities[entity_index];
    let entity_center = entity.pos;
    out.scale = vec3<f32>(1.0f);
    // Rasterize the containment cube directly in world space. The fragment
    // shader still finds the real voxel hit, then supplies its true depth.
    let world_position = entity_center + rotation_matrix(entity.rot) * (pos * out.scale);
    out.world_position = world_position;
    let from_camera = world_position - camera_entity.pos;
    let view_position = vec3<f32>(
        dot(from_camera, right),
        dot(from_camera, up),
        // WebGPU's clip-space depth is positive in front of this camera.
        dot(from_camera, forward),
    );

    let focal_length = 1.0f / tan(radians(render_state.fov) * 0.5f);
    let aspect = render_state.aspect;
    out.clip_position = vec4<f32>(
        view_position.x * focal_length / aspect,
        view_position.y * focal_length,
        clip_depth(view_position.z),
        view_position.z,
    );
    return out;
}

@group(1) @binding(0) var vox: texture_3d<f32>;

fn voxel_search(ray_origin: vec3<f32>, ray_direction: vec3<f32>) -> VoxelHit {
    let safe_direction = select(ray_direction, vec3<f32>(0.000001f), abs(ray_direction) < vec3<f32>(0.000001f));
    let inverse_direction = 1.0f / safe_direction;
    let first_bounds = -ray_origin * inverse_direction;
    let second_bounds = (vec3<f32>(1.0f) - ray_origin) * inverse_direction;
    let bounds_near = min(first_bounds, second_bounds);
    let bounds_far = max(first_bounds, second_bounds);
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
        distance = dot(side_distance, mask);
        cell += step * vec3<i32>(mask);
        side_distance += delta_distance * mask;
        normal = -vec3<f32>(step) * mask;
        if (distance > exit_distance || any(cell < vec3<i32>(0)) || any(cell >= volume_size)) { break; }
    }
    return VoxelHit(0.0f, 0.0f, vec3<f32>(0.0f));
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    let e = entities[in.idx];
    let camera_entity = entities[0];
    let camera_position = camera_entity.pos;
    let camera_direction = look_direction(camera_entity.rot);
    let scale = in.scale;
    let entity_center = e.pos;
    let entity_rotation = rotation_matrix(e.rot);
    let inverse_entity_rotation = transpose(entity_rotation);

    let world_ray = normalize(in.world_position - camera_position);
    // Storage-buffer vec3 members become packed_float3 in Metal. Build an
    // ordinary vector from their scalar components before matrix arithmetic.
    let camera_offset = vec3<f32>(
        camera_position.x - entity_center.x,
        camera_position.y - entity_center.y,
        camera_position.z - entity_center.z,
    );
    let ray_origin = inverse_entity_rotation * camera_offset / scale + vec3<f32>(0.5f);
    let ray_direction = inverse_entity_rotation * world_ray / scale;
    let hit = voxel_search(ray_origin, ray_direction);
    if (hit.material == 0.0f) { discard; }
    let volume_size = vec3<i32>(textureDimensions(vox));
    let voxel_position = (ray_origin + ray_direction * (hit.distance + 0.0001f)) * vec3<f32>(volume_size);
    let cell = clamp(vec3<i32>(floor(voxel_position)), vec3<i32>(0), volume_size - vec3<i32>(1));
    let normal = vec3<i32>(hit.normal);
    let tangent = select(vec3<i32>(1, 0, 0), vec3<i32>(0, 1, 0), normal.x != 0);
    let bitangent = select(vec3<i32>(0, 1, 0), vec3<i32>(0, 0, 1), normal.z == 0);
    let corner = select(vec3<i32>(-1), vec3<i32>(1), fract(voxel_position) > vec3<f32>(0.5f));
    let side_a = tangent * corner;
    let side_b = bitangent * corner;
    let outside = cell + normal;
    var ao = 1.0f - 0.18f * (
        min(textureLoad(vox, outside + side_a, 0).x, 1.0f) +
        min(textureLoad(vox, outside + side_b, 0).x, 1.0f) +
        min(textureLoad(vox, outside + side_a + side_b, 0).x, 1.0f)
    );
    

    let color = textureLoad(palette, vec2<u32>(u32(hit.material), 0));
    let surface = textureLoad(palette, vec2<u32>(u32(hit.material), 1));
    let view_depth = hit.distance * dot(world_ray, camera_direction);
    let depth = clip_depth(view_depth) / view_depth;
    let world_normal = entity_rotation * hit.normal;
    return FragmentOutput(
        vec4<f32>(shade_pbr(color.rgb, world_normal, -world_ray, surface.g, surface.r, hit.distance * world_ray + camera_position, ao), color.a),
        in.idx,
        depth,
    );
}

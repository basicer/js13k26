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

fn inverse_matrix(matrix: mat3x3<f32>) -> mat3x3<f32> {
    let inverse_determinant = 1.0f / dot(matrix[0], cross(matrix[1], matrix[2]));
    let row_0 = cross(matrix[1], matrix[2]) * inverse_determinant;
    let row_1 = cross(matrix[2], matrix[0]) * inverse_determinant;
    let row_2 = cross(matrix[0], matrix[1]) * inverse_determinant;
    return mat3x3<f32>(
        vec3<f32>(row_0.x, row_1.x, row_2.x),
        vec3<f32>(row_0.y, row_1.y, row_2.y),
        vec3<f32>(row_0.z, row_1.z, row_2.z),
    );
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
    let entity_kind = u32(entities[entity_index].kind);
    if (entity_index == 0u || entity_kind == 255u || entity_kind != current_vox_kind) {
        out.clip_position = vec4<f32>(0.0f, 0.0f, 2.0f, 1.0f);
        return out;
    }

    let camera_transform = world_transform(0u);
    let forward = -normalize(camera_transform[2].xyz);
    let right = normalize(camera_transform[0].xyz);
    let up = normalize(camera_transform[1].xyz);
    let entity_transform = world_transform(entity_index);
    out.scale = vec3<f32>(
        length(entity_transform[0].xyz),
        length(entity_transform[1].xyz),
        length(entity_transform[2].xyz),
    );
    // Rasterize the containment cube directly in world space. The fragment
    // shader still finds the real voxel hit, then supplies its true depth.
    let world_position = (entity_transform * vec4<f32>(pos, 1.0f)).xyz;
    out.world_position = world_position;
    let from_camera = world_position - camera_transform[3].xyz;
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

fn voxel_at(cell: vec3<i32>, volume_size: vec3<i32>, grid_size: vec3<f32>) -> f32 {
    if (any(cell < vec3<i32>(0)) || any(vec3<f32>(cell) >= grid_size)) { return 0.0f; }
    return textureLoad(vox, cell % volume_size, 0).x;
}

fn voxel_search(ray_origin: vec3<f32>, ray_direction: vec3<f32>, repeats: vec3<f32>) -> VoxelHit {
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
    let grid_size = vec3<f32>(volume_size) * repeats;
    let point = ray_origin + ray_direction * (distance + 0.0001f);
    var cell = clamp(vec3<i32>(floor(point * grid_size)), vec3<i32>(0), vec3<i32>(ceil(grid_size)) - vec3<i32>(1));
    let step = select(vec3<i32>(-1), vec3<i32>(1), ray_direction >= vec3<f32>(0.0f));
    let cell_size = 1.0f / grid_size;
    let delta_distance = abs(cell_size / safe_direction);
    let boundary = (vec3<f32>(cell) + select(vec3<f32>(0.0f), vec3<f32>(1.0f), safe_direction >= vec3<f32>(0.0f))) * cell_size;
    var side_distance = distance + (boundary - point) / safe_direction;
    var normal = vec3<f32>(0.0f, 1.0f, 0.0f);
    let max_steps = u32(ceil(grid_size.x) + ceil(grid_size.y) + ceil(grid_size.z));
    for (var step_count = 0u; step_count < max_steps; step_count++) {
        let material = voxel_at(cell, volume_size, grid_size);
        if (material > 0.0f) { return VoxelHit(distance, material, normal); }
        let smallest = side_distance < min(side_distance.yzx, side_distance.zxy);
        let mask = select(vec3<f32>(0.0f), vec3<f32>(1.0f), smallest);
        distance = dot(side_distance, mask);
        cell += step * vec3<i32>(mask);
        side_distance += delta_distance * mask;
        normal = -vec3<f32>(step) * mask;
        if (distance > exit_distance || any(cell < vec3<i32>(0)) || any(vec3<f32>(cell) >= grid_size)) { break; }
    }
    return VoxelHit(0.0f, 0.0f, vec3<f32>(0.0f));
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    let e = entities[in.idx];
    let camera_transform = world_transform(0u);
    let camera_position = camera_transform[3].xyz;
    let camera_direction = -normalize(camera_transform[2].xyz);
    let scale = in.scale;
    let volume_size = vec3<i32>(textureDimensions(vox));
    let repeats = select(
        select(
            select(vec3<f32>(1.0f), e.tile, e.tile > vec3<f32>(0.0f)),
            scale,
            e.tile == vec3<f32>(-1.0f),
        ),
        scale * 64.0f / vec3<f32>(volume_size),
        e.tile == vec3<f32>(-2.0f),
    );
    let entity_transform = world_transform(in.idx);
    let linear_transform = mat3x3<f32>(entity_transform[0].xyz, entity_transform[1].xyz, entity_transform[2].xyz);
    let inverse_entity_transform = inverse_matrix(linear_transform);

    let world_ray = normalize(in.world_position - camera_position);
    let ray_origin = inverse_entity_transform * (camera_position - entity_transform[3].xyz) + vec3<f32>(0.5f);
    let ray_direction = inverse_entity_transform * world_ray;
    let hit = voxel_search(ray_origin, ray_direction, repeats);
    if (hit.material == 0.0f) { discard; }
    let grid_size = vec3<f32>(volume_size) * repeats;
    let voxel_position = (ray_origin + ray_direction * (hit.distance + 0.0001f)) * grid_size;
    let cell = clamp(vec3<i32>(floor(voxel_position)), vec3<i32>(0), vec3<i32>(ceil(grid_size)) - vec3<i32>(1));
    let normal = vec3<i32>(hit.normal);
    let tangent = select(vec3<i32>(1, 0, 0), vec3<i32>(0, 1, 0), normal.x != 0);
    let bitangent = select(vec3<i32>(0, 1, 0), vec3<i32>(0, 0, 1), normal.z == 0);
    let corner = select(vec3<i32>(-1), vec3<i32>(1), fract(voxel_position) > vec3<f32>(0.5f));
    let side_a = tangent * corner;
    let side_b = bitangent * corner;
    let outside = cell + normal;
    var ao = 1.0f - 0.18f * (
        min(voxel_at(outside + side_a, volume_size, grid_size), 1.0f) +
        min(voxel_at(outside + side_b, volume_size, grid_size), 1.0f) +
        min(voxel_at(outside + side_a + side_b, volume_size, grid_size), 1.0f)
    );
    

    let material = select(hit.material, e.matOverride, e.matOverride > 0.0f);
    let color = textureLoad(palette, vec2<u32>(u32(material), 0));
    let surface = textureLoad(palette, vec2<u32>(u32(material), 1));
    let view_depth = hit.distance * dot(world_ray, camera_direction);
    let depth = clip_depth(view_depth) / view_depth;
    let world_normal = normalize(transpose(inverse_entity_transform) * hit.normal);
    return FragmentOutput(
        vec4<f32>(shade_pbr(color.rgb, world_normal, -world_ray, surface.g, surface.r, hit.distance * world_ray + camera_position, ao), color.a),
        in.idx,
        depth,
    );
}

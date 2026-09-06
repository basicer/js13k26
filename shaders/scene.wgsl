@vertex
fn vs_main(
    @builtin(instance_index) idx: u32,
    @location(0) pos: vec3<f32>
) -> VertexOutput {
    let entity_index = idx & 65535u;
    var out: VertexOutput;
    out.idx = entity_index;

    // This draw call has a pair of voxel textures bound. Clip instances whose kind
    // belongs to a different texture before they reach rasterization.
    let entity_kind = u32(entities[entity_index].kind);
    let transparency = entities[entity_index].transparency;
    if (entity_index == 0u || entity_kind >= 254u || (entity_kind & 127u) != (idx >> 16u) || transparency >= 1.0f) {
        out.clip_position = vec4<f32>(0.0f, 0.0f, 2.0f, 1.0f);
        return out;
    }

    let camera_transform = world_transform(0u);
    let forward = -normalize(camera_transform[2].xyz);
    let right = normalize(camera_transform[0].xyz);
    let up = normalize(camera_transform[1].xyz);
    let entity_transform = world_transform(entity_index);
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
@group(1) @binding(1) var vox1: texture_3d<f32>;

fn voxel_at(cell: vec3<i32>, volume_size: vec3<i32>, grid_size: vec3<f32>, variant: bool) -> f32 {
    if (any(cell < vec3<i32>(0)) || any(vec3<f32>(cell) >= grid_size)) { return 0.0f; }
    if (variant) { return textureLoad(vox1, cell % volume_size, 0).x; }
    return textureLoad(vox, cell % volume_size, 0).x;
}

fn voxel_cell(position: vec3<f32>, grid_size: vec3<f32>) -> vec3<i32> {
    return clamp(vec3<i32>(floor(position)), vec3<i32>(0), vec3<i32>(ceil(grid_size)) - vec3<i32>(1));
}

fn voxel_search(ray_origin: vec3<f32>, ray_direction: vec3<f32>, volume_size: vec3<i32>, grid_size: vec3<f32>, variant: bool) -> VoxelHit {
    let safe_direction = select(ray_direction, vec3<f32>(0.000001f), abs(ray_direction) < vec3<f32>(0.000001f));
    let inverse_direction = 1.0f / safe_direction;
    let first_bounds = -ray_origin * inverse_direction;
    let second_bounds = (vec3<f32>(1.0f) - ray_origin) * inverse_direction;
    let bounds_near = min(first_bounds, second_bounds);
    let bounds_far = max(first_bounds, second_bounds);
    var distance = max(max(bounds_near.x, bounds_near.y), max(bounds_near.z, 0.0f));
    let exit_distance = min(min(bounds_far.x, bounds_far.y), bounds_far.z);
    if (distance > exit_distance) { return VoxelHit(); }

    let point = ray_origin + ray_direction * (distance + 0.0001f);
    var cell = voxel_cell(point * grid_size, grid_size);
    let step = select(vec3<i32>(-1), vec3<i32>(1), ray_direction >= vec3<f32>(0.0f));
    let cell_size = 1.0f / grid_size;
    let delta_distance = abs(cell_size / safe_direction);
    var side_distance = distance + ((vec3<f32>(cell) + select(vec3<f32>(0.0f), vec3<f32>(1.0f), safe_direction >= vec3<f32>(0.0f))) * cell_size - point) / safe_direction;
    // A solid boundary voxel is hit before DDA advances: use the box entry face.
    let entry_axis = select(select(2u, 1u, bounds_near.y >= bounds_near.z), 0u,
        bounds_near.x >= max(bounds_near.y, bounds_near.z));
    var normal = vec3<f32>(0.0f);
    normal[entry_axis] = -f32(step[entry_axis]);
    for (var step_count = 0u; step_count < u32(ceil(grid_size.x) + ceil(grid_size.y) + ceil(grid_size.z)); step_count++) {
        let material = voxel_at(cell, volume_size, grid_size, variant);
        if (material > 0.0f) {
            // Preserve the original hit-position epsilon and cell rounding for AO/dissolve.
            let position = (ray_origin + ray_direction * (distance + 0.0001f)) * grid_size;
            return VoxelHit(distance, material, normal, position, voxel_cell(position, grid_size));
        }
        let mask = select(vec3<f32>(0.0f), vec3<f32>(1.0f), side_distance < min(side_distance.yzx, side_distance.zxy));
        distance = dot(side_distance, mask);
        cell += step * vec3<i32>(mask);
        side_distance += delta_distance * mask;
        normal = -vec3<f32>(step) * mask;
        if (distance > exit_distance || any(cell < vec3<i32>(0)) || any(vec3<f32>(cell) >= grid_size)) { break; }
    }
    return VoxelHit();
}

// Stable model-space chunks, with a different mask for each entity ID.
fn dissolve_noise(chunk: vec3<u32>, entity_id: u32) -> f32 {
    var seed = (chunk.x * 1973u) ^ (chunk.y * 9277u) ^ (chunk.z * 104729u) ^ (entity_id * 26699u);
    seed = (seed ^ (seed >> 16u)) * 0x7feb352du;
    seed = (seed ^ (seed >> 15u)) * 0x846ca68bu;
    seed = seed ^ (seed >> 16u);
    // Exactly representable values in [0, 1): endpoints preserve all/remove all.
    return f32(seed & 16777215u) / 16777216.0f;
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    let e = entities[in.idx];
    let variant = e.modelVariant >= 0.5f;
    if (e.dissolve >= 1.0f && e.dissolvePalette <= 0.0f) { discard; }
    let camera_transform = world_transform(0u);
    let camera_position = camera_transform[3].xyz;
    let camera_direction = -normalize(camera_transform[2].xyz);
    let scale = abs(e.scale);
    let volume_size = vec3<i32>(textureDimensions(vox));
    let entity_transform = world_transform(in.idx);
    let linear_transform = mat3x3<f32>(entity_transform[0].xyz, entity_transform[1].xyz, entity_transform[2].xyz);
    let cofactor = cross(linear_transform[1], linear_transform[2]);
    let inverse_entity_transform = transpose(mat3x3<f32>(
        cofactor,
        cross(linear_transform[2], linear_transform[0]),
        cross(linear_transform[0], linear_transform[1]),
    )) * (1.0f / dot(linear_transform[0], cofactor));

    let world_ray = normalize(in.world_position - camera_position);
    let grid_size = vec3<f32>(volume_size) * select(
        select(
            select(vec3<f32>(1.0f), e.tile, e.tile > vec3<f32>(0.0f)),
            scale,
            e.tile == vec3<f32>(-1.0f),
        ),
        scale * 64.0f / vec3<f32>(volume_size),
        e.tile == vec3<f32>(-2.0f),
    );
    let hit = voxel_search(inverse_entity_transform * (camera_position - entity_transform[3].xyz) + vec3<f32>(0.5f), inverse_entity_transform * world_ray, volume_size, grid_size, variant);
    if (hit.material == 0.0f) { discard; }
    let voxel_position = hit.position;
    let cell = hit.cell;
    // The same 4x4x4 mask either removes chunks or replaces their material.
    let dissolved = e.dissolve > 0.0f && dissolve_noise(vec3<u32>(cell) / vec3<u32>(4u), in.idx) < clamp(e.dissolve, 0.0f, 1.0f);
    if (dissolved && e.dissolvePalette <= 0.0f) { discard; }
    let normal = vec3<i32>(hit.normal);
    let corner = select(vec3<i32>(-1), vec3<i32>(1), fract(voxel_position) > vec3<f32>(0.5f));
    let side_a = select(vec3<i32>(1, 0, 0), vec3<i32>(0, 1, 0), normal.x != 0) * corner;
    let side_b = select(vec3<i32>(0, 1, 0), vec3<i32>(0, 0, 1), normal.z == 0) * corner;
    let outside = cell + normal;
    var ao = 1.0f - 0.18f * (
        min(voxel_at(outside + side_a, volume_size, grid_size, variant), 1.0f) +
        min(voxel_at(outside + side_b, volume_size, grid_size, variant), 1.0f) +
        min(voxel_at(outside + side_a + side_b, volume_size, grid_size, variant), 1.0f)
    );
    

    let material = select(select(hit.material, e.matOverride, e.matOverride > 0.0f), clamp(e.dissolvePalette, 0.0f, 255.0f), dissolved);
    var color = textureLoad(palette, vec2<u32>(u32(material), 0));
    if (material == 255.0f) {
        // Warp model-space bands into flowing marble; simulation time pauses with the game.
        var p = voxel_position * 0.08f + vec3<f32>(render_state.time * 0.1f, 0.0f, 0.0f);
        p += 1.2f * sin(p.yzx + sin(p.zxy));
        let hue = fract(p.x + p.y * 0.7f + p.z * 0.5f + dissolve_noise(vec3<u32>(0u), in.idx));
        let rainbow = clamp(abs(fract(vec3<f32>(hue) + vec3<f32>(0.0f, 0.6666667f, 0.3333333f)) * 6.0f - 3.0f) - 1.0f, vec3<f32>(0.0f), vec3<f32>(1.0f));
        color = vec4<f32>(rainbow * rainbow, color.a);
    }
    let surface = textureLoad(palette, vec2<u32>(u32(material), 1));
    let hit_position = hit.distance * world_ray + camera_position;
    let view_depth = hit.distance * dot(world_ray, camera_direction);
    return FragmentOutput(
        vec4<f32>(shade_surface(color.rgb, normalize(transpose(inverse_entity_transform) * hit.normal), -world_ray, surface.g, surface.r, hit_position, ao) + color.rgb * surface.b * 4.0f, select(1.0f, color.a * (1.0f - clamp(e.transparency, 0.0f, 1.0f)), e.kind >= 128.0f)),
        vec2<u32>(in.idx, u32(clamp((hit_position.x + 32.0f) * 1024.0f, 0.0f, 65535.0f)) + u32(clamp((hit_position.z + 32.0f) * 1024.0f, 0.0f, 65535.0f)) * 65536u),
        clip_depth(view_depth) / view_depth,
    );
}

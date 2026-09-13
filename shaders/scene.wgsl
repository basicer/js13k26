@vertex
fn vs_main(
    @builtin(instance_index) idx: u32,
    @builtin(vertex_index) vertex: u32
) -> VertexOutput {
    // The original inward-wound cube, ten three-bit indices per word.
    let corner = (array<u32, 4>(668020936u, 447748655u, 639176151u, 127977u)[vertex / 10u] >> ((vertex % 10u) * 3u)) & 7u;
    let entity_index = idx & 65535u;
    var out: VertexOutput;
    out.idx = entity_index;

    // This draw call has both voxel poses bound. Clip instances whose kind
    // belongs to a different texture before they reach rasterization.
    // Reserved kinds 254/255 map to models 126/127, which are never submitted.
    if ((u32(entities[entity_index].kind) & 127u) != (idx >> 16u) || entities[entity_index].transparency >= 1.0f) {
        out.clip_position = vec4<f32>(0.0f, 0.0f, 2.0f, 1.0f);
        return out;
    }

    let camera_transform = world_transform(0u);
    // Rasterize the containment cube directly in world space. The fragment
    // shader still finds the real voxel hit, then supplies its true depth.
    let world_position = (world_transform(entity_index) * vec4<f32>(vec3<f32>((vec3<u32>(corner) >> vec3<u32>(0u, 1u, 2u)) & vec3<u32>(1u)) * 2.0f - vec3<f32>(1.0f), 1.0f)).xyz;
    out.world_position = world_position;
    let from_camera = world_position - camera_transform[3].xyz;
    let view_position = vec3<f32>(
        dot(from_camera, normalize(camera_transform[0].xyz)),
        dot(from_camera, normalize(camera_transform[1].xyz)),
        // WebGPU's clip-space depth is positive in front of this camera.
        dot(from_camera, -normalize(camera_transform[2].xyz)),
    );

    let focal_length = 1.0f / tan(radians(render_state.fov) * 0.5f);
    out.clip_position = vec4<f32>(
        view_position.x * focal_length / render_state.aspect,
        view_position.y * focal_length,
        clip_depth(view_position.z),
        view_position.z,
    );
    return out;
}

// The two poses share the R/G channels of one integer material texture.
@group(1) @binding(0) var vox: texture_3d<u32>;

// Dissolved-to-air cells are empty for both traversal and ambient occlusion.
// The ray keeps walking until it reaches a surviving interior face.
fn voxel_at(cell: vec3<i32>, volume_size: vec3<i32>, grid_size: vec3<f32>, entity_id: u32) -> f32 {
    if (any(cell < vec3<i32>(0)) || any(vec3<f32>(cell) >= grid_size)) { return 0.0f; }
    let e = entities[entity_id];
    let material = f32(textureLoad(vox, cell % volume_size, 0)[u32(e.modelVariant >= 0.5f)]);
    if (material == 0.0f) { return 0.0f; }
    // Stable 4x4x4 chunks either become air or take the replacement palette.
    if (dissolve_noise(vec3<u32>(cell) / vec3<u32>(4u), entity_id) < e.dissolve) {
        // Gameplay and the inspector already constrain palette IDs to 0..255.
        return e.dissolvePalette;
    }
    return select(material, e.matOverride, e.matOverride > 0.0f);
}

// Stable model-space chunks, with a different mask for each entity ID.
fn dissolve_noise(chunk: vec3<u32>, entity_id: u32) -> f32 {
    var seed = (chunk.x * 1973u) ^ (chunk.y * 9277u) ^ (chunk.z * 104729u) ^ (entity_id * 26699u);
    seed = (seed ^ (seed >> 16u)) * 1664525u;
    seed = seed ^ (seed >> 15u);
    // Exactly representable values in [0, 1): endpoints preserve all/remove all.
    return f32(seed & 16777215u) / 16777216.0f;
}

@fragment
fn fs_main(in: VertexOutput) -> FragmentOutput {
    let e = entities[in.idx];
    let camera_transform = world_transform(0u);
    let camera_position = camera_transform[3].xyz;
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
    let ray_origin = inverse_entity_transform * (camera_position - entity_transform[3].xyz) + vec3<f32>(0.5f);
    let ray_direction = inverse_entity_transform * world_ray;
    // Inline the single-use traversal; retain the original DDA order and ties.
    let safe_direction = select(ray_direction, vec3<f32>(0.000001f), abs(ray_direction) < vec3<f32>(0.000001f));
    let inverse_direction = 1.0f / safe_direction;
    let first_bounds = -ray_origin * inverse_direction;
    let second_bounds = (vec3<f32>(1.0f) - ray_origin) * inverse_direction;
    let bounds_near = min(first_bounds, second_bounds);
    let bounds_far = max(first_bounds, second_bounds);
    var distance = max(max(bounds_near.x, bounds_near.y), max(bounds_near.z, 0.0f));
    let exit_distance = min(min(bounds_far.x, bounds_far.y), bounds_far.z);

    var cell = clamp(vec3<i32>(floor((ray_origin + ray_direction * (distance + 0.0001f)) * grid_size)), vec3<i32>(0), vec3<i32>(ceil(grid_size)) - vec3<i32>(1));
    let step = select(vec3<i32>(-1), vec3<i32>(1), ray_direction >= vec3<f32>(0.0f));
    let grid_direction = safe_direction * grid_size;
    let delta_distance = abs(1.0f / grid_direction);
    var side_distance = (vec3<f32>(cell) + max(vec3<f32>(step), vec3<f32>(0.0f)) - ray_origin * grid_size) / grid_direction;
    // A solid boundary voxel is hit before DDA advances: use the box entry face.
    let entry_axis = select(select(2u, 1u, bounds_near.y >= bounds_near.z), 0u,
        bounds_near.x >= max(bounds_near.y, bounds_near.z));
    var hit_normal = vec3<f32>(0.0f);
    hit_normal[entry_axis] = -f32(step[entry_axis]);
    // Each iteration advances one axis, including exact edge/corner ties.
    // Fractional grids can leave the box before crossing the last cell boundary.
    // Box exit bounds traversal; voxel_at also rejects any rounded boundary cell.
    var hit_material = 0.0f;
    while (distance <= exit_distance) {
        hit_material = voxel_at(cell, volume_size, grid_size, in.idx);
        if (hit_material > 0.0f) {
            break;
        }
        let axis = select(select(2u, 1u, side_distance.y <= side_distance.z), 0u,
            side_distance.x <= min(side_distance.y, side_distance.z));
        distance = side_distance[axis];
        cell[axis] += step[axis];
        side_distance[axis] += delta_distance[axis];
        hit_normal = vec3<f32>(0.0f);
        hit_normal[axis] = -f32(step[axis]);
    }
    if (hit_material == 0.0f) { discard; }
    let voxel_position = (ray_origin + ray_direction * (distance + 0.0001f)) * grid_size;
    let normal = vec3<i32>(hit_normal);
    let corner = select(vec3<i32>(-1), vec3<i32>(1), fract(voxel_position) > vec3<f32>(0.5f));
    let outside = cell + normal;
    

    let material = u32(hit_material);
    var color = textureLoad(palette, vec2<u32>(material, 0));
    if (material == 255u) {
        // Warp model-space bands into flowing marble; simulation time pauses with the game.
        var p = voxel_position * 0.08f + vec3<f32>(render_state.time * 0.1f, 0.0f, 0.0f);
        p += 1.2f * sin(p.yzx + sin(p.zxy));
        let rainbow = clamp(abs(fract(vec3<f32>(fract(p.x + p.y * 0.7f + p.z * 0.5f + dissolve_noise(vec3<u32>(0u), in.idx))) + vec3<f32>(0.0f, 0.6666667f, 0.3333333f)) * 6.0f - 3.0f) - 1.0f, vec3<f32>(0.0f), vec3<f32>(1.0f));
        color = vec4<f32>(rainbow * rainbow, color.a);
    }
    let surface = textureLoad(palette, vec2<u32>(material, 1));
    let hit_position = distance * world_ray + camera_position;
    let view_depth = distance * dot(world_ray, -normalize(camera_transform[2].xyz));
    return FragmentOutput(
        vec4<f32>(shade_surface(color.rgb, normalize(transpose(inverse_entity_transform) * hit_normal), -world_ray, surface.g, surface.r, hit_position, 1.0f - 0.25f * (
            min(voxel_at(outside + select(vec3<i32>(1, 0, 0), vec3<i32>(0, 1, 0), normal.x != 0) * corner, volume_size, grid_size, in.idx), 1.0f) +
            min(voxel_at(outside + select(vec3<i32>(0, 1, 0), vec3<i32>(0, 0, 1), normal.z == 0) * corner, volume_size, grid_size, in.idx), 1.0f)
        )) + color.rgb * surface.b * 4.0f, select(1.0f, color.a * (1.0f - e.transparency), e.kind >= 128.0f)),
        // 128-unit centered cursor range at 1/256 precision; high bit of each lane is unused.
        vec2<u32>(in.idx, u32(clamp((hit_position.x + 64.0f) * 256.0f, 0.0f, 32767.0f)) + u32(clamp((hit_position.z + 64.0f) * 256.0f, 0.0f, 32767.0f)) * 65536u),
        clip_depth(view_depth) / view_depth,
    );
}

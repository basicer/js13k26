// Compact diffuse + Blinn-Phong lighting. Roughness widens and softens highlights;
// metals tint the highlight while suppressing the diffuse response.
fn direct_lighting(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, light_direction: vec3<f32>) -> vec3<f32> {
    let halfway = view + light_direction;
    return (base_color * (1.0f - metalness) * 0.318f + mix(vec3<f32>(0.04f), base_color * 3.0f, metalness) * pow(max(dot(normal, halfway * inverseSqrt(max(dot(halfway, halfway), 0.0001f))), 0.0f), mix(64.0f, 4.0f, roughness))) * max(dot(normal, light_direction), 0.0f);
}

fn shade_surface(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, world_position: vec3<f32>, ao: f32) -> vec3<f32> {
    var color = base_color * 0.011f * (1.0f + max(normal.y, 0.0f)) * ao;
    for (var i = 0u; i < 32u; i++) {
        let index = render_state.light_entities[i >> 2u][i & 3u];
        if (index == 0xffffffffu) { break; }
        let light = entities[index];
        let transform = world_transform(index);
        let axis = transform[2].xyz;
        // Spawn and the inspector already constrain cone angles to 0..2PI.
        let cutoff = cos(light.light_angle * 0.5f);
        let to_light = transform[3].xyz - world_position;
        let distance_squared = max(dot(to_light, to_light), 0.000001f);
        let light_direction = to_light * inverseSqrt(distance_squared);
        if (dot(-light_direction, axis / max(length(axis), 0.000001f)) < cutoff) { continue; }
        color += direct_lighting(base_color, normal, view, roughness, metalness, light_direction) * light.spotlight / (1.0f + distance_squared);
    }
    return color + direct_lighting(base_color, normal, view, roughness, metalness, normalize(vec3<f32>(-0.4f, 0.8f, -0.5f))) * 0.25f;
}

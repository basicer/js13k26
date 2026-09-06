// Compact diffuse + Blinn-Phong lighting. Roughness widens and softens highlights;
// metals tint the highlight while suppressing the diffuse response.
fn direct_lighting(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, light_direction: vec3<f32>) -> vec3<f32> {
    let halfway = view + light_direction;
    let highlight = pow(max(dot(normal, halfway * inverseSqrt(max(dot(halfway, halfway), 0.0001f))), 0.0f), mix(64.0f, 4.0f, roughness));
    let specular = mix(vec3<f32>(0.04f), base_color * 3.0f, metalness) * highlight;
    return (base_color * (1.0f - metalness) * 0.318f + specular) * max(dot(normal, light_direction), 0.0f);
}

fn shade_surface(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, world_position: vec3<f32>, ao: f32) -> vec3<f32> {
    var color = base_color * (0.01f + 0.01f * max(normal.y, 0.0f)) * ao;
    for (var i = 0u; i < MAX_SPOTLIGHTS; i++) {
        let index = light_entities[i];
        if (index == 0xffffffffu) { break; }
        let light = entities[index];
        let transform = world_transform(index);
        let axis = transform[2].xyz;
        let direction = axis / max(length(axis), 0.000001f);
        let cutoff = cos(clamp(light.light_angle, 0.0f, 6.283185307f) * 0.5f);
        let to_light = transform[3].xyz - world_position;
        let distance_squared = dot(to_light, to_light);
        if (distance_squared <= 0.000001f) { continue; }
        let light_direction = to_light * inverseSqrt(distance_squared);
        if (cutoff > -1.0f && dot(-light_direction, direction) <= cutoff) { continue; }
        color += direct_lighting(base_color, normal, view, roughness, metalness, light_direction) * light.spotlight / (1.0f + distance_squared);
    }
    return color + direct_lighting(base_color, normal, view, roughness, metalness, normalize(vec3<f32>(-0.4f, 0.8f, -0.5f))) * 0.25f;
}

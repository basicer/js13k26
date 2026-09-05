fn fresnel_schlick(cos_theta: f32, f0: vec3<f32>) -> vec3<f32> {
    return f0 + (vec3<f32>(1.0f) - f0) * pow(1.0f - cos_theta, 5.0f);
}

fn geometry_schlick_ggx(n_dot_v: f32, roughness: f32) -> f32 {
    let k = (roughness + 1.0f) * (roughness + 1.0f) * 0.125f;
    return n_dot_v / max(n_dot_v * (1.0f - k) + k, 0.0001f);
}

// Shared BRDF for directional and point lights, including the incident cosine.
fn direct_lighting(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, light_direction: vec3<f32>) -> vec3<f32> {
    let perceptual_roughness = max(roughness, 0.045f);
    let n_dot_l = max(dot(normal, light_direction), 0.0f);
    let n_dot_v = max(dot(normal, view), 0.0f);
    if (n_dot_l <= 0.0f || n_dot_v <= 0.0f) { return vec3<f32>(0.0f); }
    let half_vector = normalize(view + light_direction);
    let n_dot_h = max(dot(normal, half_vector), 0.0f);
    let h_dot_v = max(dot(half_vector, view), 0.0f);
    let f0 = mix(vec3<f32>(0.04f), base_color, metalness);
    let fresnel = fresnel_schlick(h_dot_v, f0);
    let a2 = pow(perceptual_roughness, 4.0f);
    let denominator = n_dot_h * n_dot_h * (a2 - 1.0f) + 1.0f;
    let specular = a2 / max(3.14159265f * denominator * denominator, 0.0001f) *
        geometry_schlick_ggx(n_dot_v, perceptual_roughness) * geometry_schlick_ggx(n_dot_l, perceptual_roughness) * fresnel /
        max(4.0f * n_dot_v * n_dot_l, 0.0001f);
    let diffuse = (vec3<f32>(1.0f) - fresnel) * (1.0f - metalness) * base_color / 3.14159265f;
    return (diffuse + specular) * n_dot_l;
}

fn shade_pbr(base_color: vec3<f32>, normal: vec3<f32>, view: vec3<f32>, roughness: f32, metalness: f32, world_position: vec3<f32>, ao: f32) -> vec3<f32> {
    let perceptual_roughness = max(roughness, 0.045f);
    let n_dot_v = max(dot(normal, view), 0.0f);
    let f0 = mix(vec3<f32>(0.04f), base_color, metalness);
    let ambient = base_color * (0.015f + 0.015f * max(normal.y, 0.0f)) * (1.0f - metalness) * ao;
    let reflection = reflect(-view, normal);
    let sky = mix(vec3<f32>(0.005f, 0.003f, 0.002f), vec3<f32>(0.12f, 0.16f, 0.22f), reflection.y * 0.5f + 0.5f);
    let environment_specular = sky * fresnel_schlick(n_dot_v, f0) * mix(0.04f, 0.25f, metalness) * (1.0f - perceptual_roughness * 0.45f);
    var point_lighting = vec3<f32>(0.0f);
    for (var i = 0u; i < MAX_POINT_LIGHTS; i++) {
        let light = point_lights[i];
        if (light.intensity <= 0.0f) { continue; }
        let to_light = light.position - world_position;
        let distance_squared = dot(to_light, to_light);
        if (distance_squared <= 0.000001f) { continue; }
        let light_direction = to_light * inverseSqrt(distance_squared);
        // Light direction points out along local +Z; to_light points back at the source.
        if (light.cutoff > -1.0f && dot(-light_direction, light.direction) <= light.cutoff) { continue; }
        let radiance = light.intensity / (1.0f + distance_squared);
        point_lighting += direct_lighting(base_color, normal, view, roughness, metalness, light_direction) * radiance;
    }
    let directional_lighting = direct_lighting(base_color, normal, view, roughness, metalness, normalize(vec3<f32>(-0.4f, 0.8f, -0.5f))) * 0.25f;
    return ambient + environment_specular + directional_lighting + point_lighting;
}


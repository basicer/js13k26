struct Entity {
    kind: f32,
    point_light: f32,
    parent: f32,
    _3: f32,
    pos: vec3<f32>,
    _7: f32,
    rot: vec3<f32>,
    _11: f32,
    scale: vec3<f32>,
    _15: f32,
    tile: vec3<f32>,
    matOverride: f32,
};

fn rotation_matrix(rotation: vec3<f32>) -> mat3x3<f32> {
    let cos_pitch = cos(rotation.x);
    let forward = vec3<f32>(sin(rotation.y) * cos_pitch, sin(rotation.x), -cos(rotation.y) * cos_pitch);
    let base_right = normalize(cross(forward, vec3<f32>(0.0f, 1.0f, 0.0f)));
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

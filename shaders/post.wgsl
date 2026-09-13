// Postprocess reads exact texel centers; no filtering sampler is needed.
@vertex
fn vs_post(@builtin(vertex_index) vertex_index: u32) -> @builtin(position) vec4<f32> {
    return vec4<f32>(
        f32((vertex_index << 1u) & 2u) * 2.0f - 1.0f,
        f32(vertex_index & 2u) * 2.0f - 1.0f,
    0.0f, 1.0f);
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;

@fragment
fn fs_post(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    // Adjacent Gaussian taps avoid a grid of ghost images around small emitters.
    var glow = vec3<f32>(0.0f);
    var color = vec3<f32>(0.0f);
    for (var i = 0; i < 25; i++) {
        let offset = vec2<f32>(f32(i % 5 - 2), f32(i / 5 - 2));
        let sample = textureLoad(scene_texture, clamp(vec2<i32>(position.xy) + vec2<i32>(offset), vec2<i32>(0), vec2<i32>(textureDimensions(scene_texture)) - vec2<i32>(1)), 0).rgb;
        let radius = dot(offset, offset);
        glow += max(sample - vec3<f32>(1.0f), vec3<f32>(0.0f)) * exp(-radius * 0.5f);
        color += sample * max(0.0f, 4.0f - 3.0f * radius);
    }
    let exposed = (color * 0.125f + glow * 0.1f) * 1.1f;
    // The unorm canvas attachment clamps the final nonnegative result.
    return vec4<f32>(
        (exposed * (2.51f * exposed + vec3<f32>(0.03f))) /
        (exposed * (2.43f * exposed + vec3<f32>(0.59f)) + vec3<f32>(0.14f)), 1.0f);
}

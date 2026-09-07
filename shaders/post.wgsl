// Postprocess: 0=scene texture, 1=sampler.
struct PostOutput {
    @builtin(position) clip_position: vec4<f32>,
};

@vertex
fn vs_post(@builtin(vertex_index) vertex_index: u32) -> PostOutput {
    let position = vec2<f32>(
        f32((vertex_index << 1u) & 2u) * 2.0f - 1.0f,
        f32(vertex_index & 2u) * 2.0f - 1.0f,
    );
    var out: PostOutput;
    out.clip_position = vec4<f32>(position, 0.0f, 1.0f);
    return out;
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;

fn tone_map(color: vec3<f32>) -> vec3<f32> {
    let exposed = color * 1.1f;
    return clamp(
        (exposed * (2.51f * exposed + vec3<f32>(0.03f))) /
        (exposed * (2.43f * exposed + vec3<f32>(0.59f)) + vec3<f32>(0.14f)),
        vec3<f32>(0.0f),
        vec3<f32>(1.0f),
    );
}

fn aa(uv: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
    // Adjacent Gaussian taps avoid a grid of ghost images around small emitters.
    var glow = vec3<f32>(0.0f);
    var color = vec3<f32>(0.0f);
    for (var i = 0; i < 25; i++) {
        let offset = vec2<f32>(f32(i % 5 - 2), f32(i / 5 - 2));
        let sample = textureSample(scene_texture, scene_sampler, uv + offset * texel).rgb;
        let radius = dot(offset, offset);
        glow += max(sample - vec3<f32>(1.0f), vec3<f32>(0.0f)) * exp(-radius * 0.5f);
        color += sample * select(0.0f, select(1.0f, 4.0f, radius == 0.0f), radius <= 1.0f);
    }
    return color * 0.125f + glow * 0.1f;
}

@fragment
fn fs_post(in: PostOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(scene_texture));
    let texel = 1.0f / dimensions;
    let uv = in.clip_position.xy / dimensions;
    return vec4<f32>(tone_map(aa(uv, texel)), 1.0f);
}

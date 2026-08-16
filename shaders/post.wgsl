struct PostOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_post(@builtin(vertex_index) vertex_index: u32) -> PostOutput {
    let position = vec2<f32>(
        f32((vertex_index << 1u) & 2u) * 2.0f - 1.0f,
        f32(vertex_index & 2u) * 2.0f - 1.0f,
    );
    var out: PostOutput;
    out.clip_position = vec4<f32>(position, 0.0f, 1.0f);
    out.uv = position * vec2<f32>(0.5f, -0.5f) + vec2<f32>(0.5f);
    return out;
}

@group(0) @binding(0) var scene_texture: texture_2d<f32>;
@group(0) @binding(1) var scene_sampler: sampler;

fn tone_map(color: vec3<f32>) -> vec3<f32> {
    let exposed = color * 1.35f;
    return exposed / (exposed + vec3<f32>(1.0f));
}

@fragment
fn fs_post(in: PostOutput) -> @location(0) vec4<f32> {
    let texel = 1.0f / vec2<f32>(textureDimensions(scene_texture));
    let scene = textureSample(scene_texture, scene_sampler, in.uv).rgb;
    var glow = vec3<f32>(0.0f);
    var total_weight = 0.0f;
    for (var y = -2; y <= 2; y++) {
        for (var x = -2; x <= 2; x++) {
            if (x == 0 && y == 0) { continue; }
            let sample_color = textureSample(scene_texture, scene_sampler,
                in.uv + vec2<f32>(f32(x), f32(y)) * texel * 3.5f).rgb;
            let brightness = max(max(sample_color.r, sample_color.g), sample_color.b);
            let weight = 1.0f / f32(1 + x * x + y * y);
            glow += sample_color * max(brightness - 1.0f, 0.0f) * weight;
            total_weight += weight;
        }
    }
    return vec4<f32>(tone_map(scene + glow / total_weight * 1.2f), 1.0f);
}

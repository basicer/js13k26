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

fn fxaa(uv: vec2<f32>, texel: vec2<f32>) -> vec3<f32> {
    let nw = textureSample(scene_texture, scene_sampler, uv + vec2<f32>(-1.0f, -1.0f) * texel).rgb;
    let ne = textureSample(scene_texture, scene_sampler, uv + vec2<f32>( 1.0f, -1.0f) * texel).rgb;
    let sw = textureSample(scene_texture, scene_sampler, uv + vec2<f32>(-1.0f,  1.0f) * texel).rgb;
    let se = textureSample(scene_texture, scene_sampler, uv + vec2<f32>( 1.0f,  1.0f) * texel).rgb;
    let center = textureSample(scene_texture, scene_sampler, uv).rgb;
    let luma = vec3<f32>(0.299f, 0.587f, 0.114f);
    let luma_nw = dot(nw, luma);
    let luma_ne = dot(ne, luma);
    let luma_sw = dot(sw, luma);
    let luma_se = dot(se, luma);
    let luma_center = dot(center, luma);
    let luma_min = min(luma_center, min(min(luma_nw, luma_ne), min(luma_sw, luma_se)));
    let luma_max = max(luma_center, max(max(luma_nw, luma_ne), max(luma_sw, luma_se)));
    var direction = vec2<f32>(
        -((luma_nw + luma_ne) - (luma_sw + luma_se)),
         ((luma_nw + luma_sw) - (luma_ne + luma_se)),
    );
    let reduce = max((luma_nw + luma_ne + luma_sw + luma_se) * 0.03125f, 0.0078125f);
    direction = clamp(direction / (min(abs(direction.x), abs(direction.y)) + reduce), vec2<f32>(-8.0f), vec2<f32>(8.0f)) * texel;
    let a = 0.5f * (
        textureSample(scene_texture, scene_sampler, uv + direction * -0.166667f).rgb +
        textureSample(scene_texture, scene_sampler, uv + direction *  0.166667f).rgb
    );
    let b = a * 0.5f + 0.25f * (
        textureSample(scene_texture, scene_sampler, uv + direction * -0.5f).rgb +
        textureSample(scene_texture, scene_sampler, uv + direction *  0.5f).rgb
    );
    let luma_b = dot(b, luma);
    return select(b, a, luma_b < luma_min || luma_b > luma_max);
}

@fragment
fn fs_post(in: PostOutput) -> @location(0) vec4<f32> {
    let dimensions = vec2<f32>(textureDimensions(scene_texture));
    let texel = 1.0f / dimensions;
    let uv = in.clip_position.xy / dimensions;
    let scene = fxaa(uv, texel);
    return vec4<f32>(tone_map(scene), 1.0f);
}

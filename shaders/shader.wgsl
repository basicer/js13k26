

struct VertexOutput {
    @builtin(position) clip_position: vec4<f32>,
    @location(0) @interpolate(flat) idx_x: u32,
    @location(1) @interpolate(flat) idx_y: u32
};

struct Camera {
    time: f32,
    aspect: f32,
    time_padding: vec2<f32>,
    position: vec3<f32>,
    fov: f32,
    look_direction: vec3<f32>,
    roll: f32,
};

@group(0) @binding(0)
var<uniform> camera: Camera;

fn hsl2rgb(hsl: vec3<f32>) -> vec3<f32> {
    let l = clamp(hsl.z, 0.0f, 1.0f);
    let hue_rgb = clamp(
        abs(fract(fract(hsl.x) + vec3<f32>(0.0f, 2.0f / 3.0f, 1.0f / 3.0f)) * 6.0f - 3.0f) - 1.0f,
        vec3<f32>(0.0f),
        vec3<f32>(1.0f),
    );
    let chroma = (1.0f - abs(2.0f * l - 1.0f)) * clamp(hsl.y, 0.0f, 1.0f);;
    return l + (hue_rgb - vec3<f32>(0.5f)) * chroma;
}

@vertex
fn vs_main(
    @builtin(instance_index) idx: u32,
    @location(0) pos: vec3<f32>
) -> VertexOutput {

    var out: VertexOutput;
    out.idx_x = idx % 30;
    out.idx_y = idx / 30;

    var world_position = pos + vec3<f32>(f32(out.idx_x) * 1.35f, 0.0f, f32(out.idx_y) * 1.35f);
    world_position -= vec3<f32>(0.5, 0.5, 0.5);

    let forward = normalize(camera.look_direction);
    let base_right = normalize(cross(forward, vec3<f32>(0.0f, 1.0f, 0.0f)));
    let base_up = cross(base_right, forward);
    let roll = camera.roll;
    let right = base_right * cos(roll) + base_up * sin(roll);
    let up = base_up * cos(roll) - base_right * sin(roll);
    let from_camera = world_position - camera.position;
    let view_position = vec3<f32>(
        dot(from_camera, right),
        dot(from_camera, up),
        // WebGPU's clip-space depth is positive in front of this camera.
        dot(from_camera, forward),
    );

    let focal_length = 1.0f / tan(radians(camera.fov) * 0.5f);
    let aspect = camera.aspect;
    let near = 0.1f;
    let far = 100.0f;
    out.clip_position = vec4<f32>(
        view_position.x * focal_length / aspect,
        view_position.y * focal_length,
        view_position.z * far / (far - near) - near * far / (far - near),
        view_position.z,
    );
    return out;
}

@group(1) @binding(0) var vox: texture_3d<f32>;

@fragment
fn fs_main(
    in: VertexOutput
) -> @location(0) vec4<f32> {
    let time = camera.time;
    let hue = time * 0.8f + f32(in.idx_x) * 0.10f + f32(in.idx_y) * 0.06f;
    // rgba32float textures are unfilterable, so read an exact texel instead
    // of sampling through a filtering sampler.
    let voxel = textureLoad(vox, vec3<i32>(0, 0, 0), 0).x;
    let color = hsl2rgb(vec3<f32>(hue, 0.82f, 0.58f)) + voxel;
    return vec4<f32>(color, 1.0);
}

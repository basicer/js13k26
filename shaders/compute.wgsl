// Read a fixed input snapshot; write each result once. Parent light transforms
// predict the same step from that snapshot, independent of workgroup ordering.
@group(0) @binding(2) var<storage, read_write> mutable_entities: array<Entity>;
@group(0) @binding(3) var<storage, read_write> mutable_lights: array<SpotLight>;
@group(0) @binding(4) var<storage, read_write> light_count: atomic<u32>;

fn step_entity(input: Entity, dt: f32) -> Entity {
    var entity = input;
    if (entity.kind == 0.0f || dt == 0.0f) { return entity; }
    entity.age += dt;
    if (entity.ttl != 0.0f && entity.age >= entity.ttl) {
        return Entity();
    }
    // Unlit, short-lived spheres are blood and sparks; keep flashes and lights intact.
    if (entity.kind % 128.0f == 6.0f && entity.ttl > 0.0f && entity.spotlight == 0.0f) {
        entity.dissolve = 0.5f + 0.5f * entity.age / entity.ttl;
    }
    entity.pos += entity.velocity * dt;
    // Particle gravity and ground settling; tracers retain constant velocity.
    if ((u32(entity.kind) & 127u) == 6u && any(entity.velocity != vec3<f32>(0.0f))) {
        entity.velocity.y -= select(7.0f, 11.0f, entity.matOverride == 249.0f) * dt;
        let floor = -30.0f / 64.0f + entity.scale.y * 0.38f;
        if (entity.pos.y <= floor + 0.000001f) {
            entity.pos.y = floor;
            entity.velocity.y = 0.0f;
        }
    }
    return entity;
}

@compute @workgroup_size(64)
fn update_entities(@builtin(global_invocation_id) id: vec3<u32>) {
    if (id.x >= arrayLength(&entities)) { return; }
    let entity = step_entity(entities[id.x], render_state.dt);
    mutable_entities[id.x] = entity;
    if (entity.kind == 0.0f || entity.spotlight <= 0.0f) { return; }
    let index = atomicAdd(&light_count, 1u);
    if (index < MAX_SPOTLIGHTS) {
        let transform = world_transform(id.x, render_state.dt);
        let axis = transform[2].xyz;
        mutable_lights[index] = SpotLight(transform[3].xyz, entity.spotlight,
            axis / max(length(axis), 0.000001f), cos(clamp(entity.light_angle, 0.0f, 6.283185307f) * 0.5f));
    }
}

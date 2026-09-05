export let vec3 = (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
	vec3_add = (a, b) => vec3(a[0] + b[0], a[1] + b[1], a[2] + b[2]),
	vec3_muls = (a, s) => vec3(a[0] * s, a[1] * s, a[2] * s),
	vec3_cross = (a, b) => vec3(a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]),
	vec3_dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
	vec3_length = (a) => Math.sqrt(vec3_dot(a, a)),
	vec3_dist = (a, b) => Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2),
	vec3_midpoint = (a, b) => vec3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);

export let dist_point_to_line_segment = (p, a, b) => {
	let ab = vec3_add(b, vec3_muls(a, -1)),
		ap = vec3_add(p, vec3_muls(a, -1)),
		t = Math.max(0, Math.min(1, vec3_dot(ap, ab) / vec3_dot(ab, ab))),
		proj = vec3_add(a, vec3_muls(ab, t));
	return Math.sqrt(vec3_dot(vec3_add(p, vec3_muls(proj, -1)), vec3_add(p, vec3_muls(proj, -1))));
};

export let point_in_aabb = (p, a, b) => {
	let max = vec3(...a.map((v, i) => Math.max(v, b[i]))),
		min = vec3(...a.map((v, i) => Math.min(v, b[i])));
	return p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
};

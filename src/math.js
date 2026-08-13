export let vec3 = (x = 0, y = 0, z = 0) => new Float32Array([x, y, z]),
	vec3_add = (a, b) => vec3(a[0] + b[0], a[1] + b[1], a[2] + b[2]),
	vec3_muls = (a, s) => vec3(a[0] * s, a[1] * s, a[2] * s),
	vec3_cross = (a, b) =>
		vec3(
			a[1] * b[2] - a[2] * b[1],
			a[2] * b[0] - a[0] * b[2],
			a[0] * b[1] - a[1] * b[0],
		),
	vec3_dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

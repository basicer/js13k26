// Two palette texels per material: RGBA, then metal/rough/emissive/reserved.
export const palette = new Uint8Array(2048);

let utility = [
	0x80dfff, 0xffff00, 0xff4040, 0x40ff40, 0x4080ff, 0xff8800, 0x00ff99, 0xffcc00, 0xff0000, 0xff00ff, 0x00ffff,
	0x00ff40, 0, 0xffffff, 0xffffff,
];

for (let i = 1; i < 256; i++) {
	let x,
		y,
		t,
		a = 255,
		m = 0,
		q = 180,
		e = 0;
	if (i < 5) ((x = 0xfffdf7), (y = 0xc9d9e8), (t = (i - 1) / 3));
	else if (i < 9) ((x = 0x05060b), (y = 0x3b3547), (t = (i - 5) / 3));
	else if (i < 49) ((x = -1), (t = i * 1.7), (q = 110));
	else if (i < 73) ((x = 0x172318), (y = 0x769b80), (t = (i - 49) / 23), (q = 225));
	else if (i < 89) ((x = 0xffddc7), (y = 0x301c18), (t = (i - 73) / 15), (q = 220));
	else if (i < 101) ((x = 0x111913), (y = 0x70462f), (t = (i - 89) / 11), (q = 225));
	else if (i < 105) ((x = 0x1a2021), (y = 0x566267), (t = (i - 101) / 3), (q = 200));
	else if (i < 125) ((x = 0x210006), (y = 0xff3652), (t = (i - 105) / 19), (a = 235), (q = 65));
	else if (i < 145) ((x = 0x03162d), (y = 0xa5f6ff), (t = (i - 125) / 19), (a = 205), (q = 30));
	else if (i < 157) ((x = 0x18304d), (y = 0xe8fcff), (t = (i - 145) / 11), (a = 45), (q = 20));
	else if (i < 177) ((x = 0x1d2020), (y = 0x68705c), (t = (i - 157) / 19), (q = 230));
	else if (i < 189) ((x = 0x20262d), (y = 0xb9cad3), (t = (i - 177) / 11), (m = 210), (q = 30));
	else if (i < 201) ((x = 0x003d4c), (y = 0x46ffff), (t = (i - 189) / 11), (q = 20), (e = 240));
	else if (i < 217) ((x = 0), (y = 0xffffff), (t = (i - 201) / 15));
	else if (i < 241) ((x = -2), (t = i * 2.4), (q = 60), (e = 160));
	else ((x = y = utility[i - 241]), (t = 0), (a = i == 241 ? 32 : 255), (q = 50), (e = i > 249 ? 220 : 0));

	let o = i * 4;
	for (let c = 0; c < 3; c++)
		palette[o + c] =
			x < 0
				? (x == -1 ? 190 : 127) + (x == -1 ? 65 : 128) * Math.sin(t + c * 2)
				: ((x >> (16 - c * 8)) & 255) * (1 - t) + ((y >> (16 - c * 8)) & 255) * t;
	palette[o + 3] = a;
	palette.set([m, q, e, 255], 1024 + o);
}

// Warm emissive sign gold, using the unused final gray slot.
palette.set([255, 200, 70, 255], 864);
palette[1890] = 240;

// Cheap sRGB-ish conversion; gamma 2 is close enough for this palette.
for (let i = 0; i < 1024; i++) if ((i & 3) < 3) palette[i] = palette[i] ** 2 / 255;

// Two palette texels per material: RGBA, then metal/rough/emissive/reserved.
export const palette = new Uint8Array(2048);

let utility = [
	0x80dfff, 0xffff00, 0xff4040, 0x40ff40, 0x4080ff, 0xff8800, 0x00ff99, 0xffcc00, 0xff0000, 0xff00ff, 0x00ffff,
	0x00ff40, 0, 0xffff00, 0xffffff,
];

for (let i = 1; i < 256; i++) {
	let x,
		y,
		t,
		a = 255,
		m = 0,
		q = 180,
		e = 0;

	if (i < 241) {
		const ranges = [
			[5,0xfffdf7,0xc9d9e8,180], [9,0x05060b,0x3b3547,180],
			[49,-1,0,110], [73,0x172318,0x769b80,225],
			[89,0xffddc7,0x301c18,220], [101,0x111913,0x70462f,225],
			[105,0x1a2021,0x566267,200], [125,0x210006,0xff3652,65,235],
			[145,0x03162d,0xa5f6ff,30,205], [157,0x18304d,0xe8fcff,20,45],
			[177,0x1d2020,0x68705c,230], [189,0x20262d,0xb9cad3,30,255,210],
			[201,0x003d4c,0x46ffff,20,255,0,240], [217,0,0xffffff,180],
			[241,-2,0,60,255,0,160]
		];
		let low = 1;
		for (const [high, first, last, rough, alpha = 255, metal = 0, emissive = 0] of ranges) {
			if (i < high) {
				x = first; y = last; q = rough; a = alpha; m = metal; e = emissive;
				t = x < 0 ? i * (x == -1 ? 1.7 : 2.4) : (i - low) / (high - low - 1);
				break;
			}
			low = high;
		}
	} else ((x = y = utility[i - 241]), (t = 0), (a = i == 241 ? 32 : 255), (q = 50), (e = i > 249 ? 220 : 0));

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

// The terminal's red/green screen materials glow in both model variants.
palette[1024 + 243 * 4 + 2] = palette[1024 + 244 * 4 + 2] = 220;

// Cheap sRGB-ish conversion; gamma 2 is close enough for this palette.
for (let i = 0; i < 1024; i++) if ((i & 3) < 3) palette[i] = palette[i] ** 2 / 255;

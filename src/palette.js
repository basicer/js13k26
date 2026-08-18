// Procedural fallback. Index 0 is reserved (transparent/empty).
export let palette = new Uint8Array(256 * 2 * 4);

const GOLDEN_RATIO = 0.618033988749895;

// Golfed HSL-to-RGB: hue, saturation, lightness are all in the 0–1 range.
const hslToRgb = (h, s, l, a = s * Math.min(l, 1 - l)) =>
	[0, 8, 4].map(
		(n) =>
			255 *
			(l -
				a *
					Math.max(
						-1,
						Math.min(
							((n + h * 12) % 12) - 3,
							9 - ((n + h * 12) % 12),
							1,
						),
					)),
	);

// Golden-ratio hue steps keep neighbouring entries visually distinct. The
// repeating saturation/lightness pattern keeps the full set soft and pastel.
for (let index = 1; index < 256; index++) {
	const hue = (index * GOLDEN_RATIO + 0.08) % 1;
	const saturation = 0.46 + (index % 5) * 0.06;
	const lightness = 0.68 + (Math.floor(index / 5) % 4) * 0.04;
	const [red, green, blue] = hslToRgb(hue, saturation, lightness);
	const colorOffset = index * 4;
	palette.set([red, green, blue, 255], colorOffset);
	let M = index % 2 == 0 ? 0 : 150;
	let R = index % 2 == 0 ? 200 : 0;
	palette.set([M, R, 0, 255], 1024 + colorOffset);
}

palette.set([255, 0, 0, 255], 255 * 4); // Marker for per-object color.
palette.set([255, 255, 255, 255], 254 * 4);
palette.set([0, 0, 0, 255], 253 * 4);

const decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const unzip = async (s) =>
	new Uint8Array(
		await new Response(
			new Blob([decode(s)])
				.stream()
				.pipeThrough(new DecompressionStream("gzip")),
		).arrayBuffer(),
	);

if (DEBUG && import.meta.env.DEV) {
	const next = await unzip(
		"H4sIAAAAAAAAE7WT209UVxTG1z/QN0sAqYAgF2GQiiIyDMMMjDMwzCgKAhZELuVmuSgjoDAVFEURO1AuSociBGtICQ3NiQmplyakjQ81tTaNqTHxpWnSNCZNTJ/ah189Z44XsNoH03Oysvdae639fftbe4toH29ivdU5eCusdJaZ8ZSYaClK52BBGrXurVTlpXCxs4Cx9p183ObGdyif881OBj7Ipb/BQV/dDrzuNI46U/E4ttBq20xj1iaq0hMo3RJDWupWDaPs2m/8Wl7+ErZxe5q2h7nnEl86HM/iy3f+1Mb9ZaUaTu1d+KOyku/uw+XFO3hPT/H+RbCYTRoXW3cF1iP7yGwp0vBrMhLZuzmGHGuWxjcpeh2JUWFsjFxLXEQIMeuCiX4nCLstm6HWfBwZ75KzPQlLaiKmlHjSk2NJNUST59jBSJsb/4URRn3nGDzTR1dLNp5Gs8bP5cxl7MhOzg766Dtzjp6Tp+k6foKOY17qGpvY6XJq+iUkJBAfH09sbCwbNmwgKiqKyMhIdu9y4z+2m9qOcbZlVWr2oj5FewqY6i7EWTdMbo2PHVWDZFecJav8NJn7+ijZW8jM8SIm7XYu2GyMZGfzkcXCgNnMKZOJzAwjl3uLX9nf90qLMRgMnB8eZXbqE5zmFJJjwsk9UcPP8xVUVpS91F/1vkzn5uJuGOWgd5KZ7kymjprwd2Rw0WMkOjqaiIgIwsLCCA4OJrtjnqzDn5HZdAlj/QTT09P4/X7GxsYYGhrSzpmycT3r175NQdJ6Ht2beXZ+1d9XP0xh5RlNQzVmO9mN1dvOD5UObpZY+f72t9y8fpWF+St86h9nsreG8e4DDHeWc66tlGsTeVwdtfOFL4e5AQtxcXErOJYVuiktcLLXbWePM4ddDgsuWyZ51nTs5m1sTt7EJkMi7QcMNBdvJCgoiDVr1mDY1U5C/mFqqio0Xupb6TUaMZb0an54eDhVNfV82NVBV6eHDk8rnkNNHGpqpLmxjsbaauqqD5DUACNdv/Nj/S+EhIRwvb2dxZYWTSf1m5iYgP5+WLTw96N8hv4qpu7B5yTf0JaRUHkze/z/mbL4FCdUt5XYyoIgV/9tPTBXTgiiqP5bL+Q8tRSUOUFUjAlBpgSZFeT2c1OuCLKg5yg61pIgXwlyQ1DU/HlBJvX6GX0PtW5OUGYCI2kCJgGrQKFAqc5/Ss8dXcVB5bUsKJO6v3ptIcBHGQ9guk4Jrp7AuEKfYb1uSee/oNfPBuLKoM5drRsQxLeSizKvz+8IcleQnwS5J8h9QR4ISr+e7xNI0XMX9FhoKIp3pZ7PrCegn8pZWgU5IsgxPb7aT3uSa3qih1UQ+8u+prHK82u9Z/Ph2r1Q747y+BX4r7NlQb55svct3f8PfNes4JoTXAuCSxFcS4JLPduy4Lqla/VQEFWrwRfGpz3qlIBOD5/3WuvbUoCD4hKU3YJSKij7BaVaUBoEpVlQ2la9RfWvFeSgINpazGvf7j9bAm5uAAgAAA==",
	);
	palette = next;
}

// The palette texture is unorm rather than sRGB so its albedo row is stored in
// linear light up front; the material row remains unmodified data.
for (let i = 0; i < 1024; i += 4)
	for (let c = 0; c < 3; c++) {
		let value = palette[i + c] / 255;
		palette[i + c] =
			255 *
			(value <= 0.04045
				? value / 12.92
				: ((value + 0.055) / 1.055) ** 2.4);
	}

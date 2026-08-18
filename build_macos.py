#!/usr/bin/env python3

import subprocess
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HTML_PATH = ROOT / "dist" / "index.html"


def write_embedded_source(source: Path, data: bytes) -> None:
	with source.open("w", encoding="ascii") as output:
		output.write("unsigned char dist_index_html[] = {\n")
		for offset in range(0, len(data), 12):
			chunk = data[offset : offset + 12]
			values = ", ".join(f"0x{byte:02x}" for byte in chunk)
			output.write(f"  {values}")
			if offset + len(chunk) < len(data):
				output.write(",")
			output.write("\n")
		output.write("};\n")
		output.write(f"unsigned int dist_index_html_len = {len(data)};\n")


def main() -> None:
	with tempfile.TemporaryDirectory(prefix="js13k-html-") as temp_dir:
		embedded_source = Path(temp_dir) / "index_html.c"
		html = HTML_PATH.read_bytes()
		html = html.replace(b"<html>", b"<html><body>")
		html = html.replace(b"</html>", b"</body></html>")
		write_embedded_source(embedded_source, html)
		subprocess.run(
			[
				"clang",
				"-fobjc-arc",
				"macos_webview.m",
				"-x",
				"objective-c",
				str(embedded_source),
				"-framework",
				"Cocoa",
				"-framework",
				"WebKit",
				"-o",
				"js13k-webview",
			],
			cwd=ROOT,
			check=True,
		)


if __name__ == "__main__":
	main()

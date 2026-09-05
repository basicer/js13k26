# Build analysis tools

`node scripts/size-audit.mjs <output.json>` measures non-additive section
excision costs after decoding and repacking the production build. It requires
an unchanged repack to reproduce the release ZIP exactly.

`node scripts/packing-benchmark.mjs` compares Roadroller configurations without
changing the production artifact. Both scripts use scratch files outside `dist`.

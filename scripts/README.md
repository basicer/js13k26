# Build analysis tools

`npm run generate:entities` reads `Entity` in `shaders/common.wgsl` and writes
`src/entities-const.js`. Vite also regenerates it when loading its config
for development or production. Rerun the command after editing the struct
during an existing dev session. Import the constants as `E` and use
`entity[E.HEALTH]`, `entity[E.POS_X]`, or `entity.set(position, E.POS)`.
Offsets and `STRIDE` are in 32-bit lanes, including WGSL alignment and padding.
The generator supports 32-bit scalars, vectors, and fixed-size arrays; unsupported
types or explicit layout attributes fail rather than guessing their offsets.
Run `node --test scripts/entity-constants.test.js` to check layout and freshness.

Bullet collision uses `entityShotFraction` in `src/level.js`: a segment must
occupy the entity's local box and, when `HIT_RADIUS > 0`, its local sphere at
the same segment parameter. `HIT_CENTER_Y` offsets that sphere vertically.
The fields use lanes 29 and 30; the entity stride remains 32. Rotation and
nonuniform scale are applied to the ray, so a scaled sphere becomes a world
ellipsoid. Current gameplay colliders are unparented; articulated render parts
do not participate. Solid scenery, the floor, and living damageable targets
share the intersection routine. Radius zero means box-only, not disabled.
Movement and voxel picking are independent. Single-shot aim forgiveness and
the portal-specific arch/front-face test have been removed.

`node scripts/size-audit.mjs <output.json>` measures non-additive section
excision costs after decoding and repacking the production build. It requires
an unchanged repack to reproduce the release ZIP exactly.

`node scripts/packing-benchmark.mjs` compares Roadroller configurations without
changing the production artifact. Both scripts use scratch files outside `dist`.


## Inspecting the production bundle without Roadroller

Run `npm run build:unpacked` to emit `dist-unpacked/index.html` with the Closure-optimized game directly in its inline script. Shader minification, model assembly, and production feature stripping remain enabled. ECT/advzip also produce `dist-unpacked/index.zip`; this inspection build reports its size without enforcing the 13 KiB release limit. Normal `npm run build` still uses Roadroller and enforces the limit, and its `dist` output is preserved by inspection builds.

Alternatively set `ROADROLLER=0` when invoking the production build (PowerShell: `$env:ROADROLLER="0"; npm run build`; clear it afterward with `Remove-Item Env:ROADROLLER`). This also writes to `dist-unpacked`.

Raw sizes in the inline script show how much generated code each section contributes. They are not additive contributions to the compressed ZIP: shared dictionaries and Roadroller change the cost of each section.

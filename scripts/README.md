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
ellipsoid. Gameplay colliders ignore visual section offsets;
articulated render parts do not participate. Solid scenery, the floor, and living damageable targets
share the intersection routine. Radius zero means box-only, not disabled.
Movement and voxel picking are independent. Single-shot aim forgiveness and
the portal-specific arch/front-face test have been removed.

`node scripts/size-audit.mjs <output.json>` measures non-additive section
excision costs after decoding and repacking the production build. It requires
an unchanged repack to reproduce the release ZIP exactly.

`node scripts/packing-benchmark.mjs` compares Roadroller configurations without
changing the production artifact. Both scripts use scratch files outside `dist`.

`npm run layout:preview` decodes the typed `plan` in `src/level.js` and writes
`reports/level-layout.svg`: a top-down guide showing bulkheads, set dressing,
and the intended route. Run it before changing level records to visually check
the layout without launching the game.

The route is Start (-12,-12) → dogleg hallway (2,-2) → Cargo (-6,15) →
Elevator (-22,20) → Boss Room (-30,6). The footprint spans roughly 48×42 units.
The route turns east, north, west, then south, curling back toward the starting
area through the reactor arena. All four room transitions remain mandatory.
The starter lounge keeps the G&G logo and no portal. A long windowed corridor
leads into a 24×18 cargo hold with staggered storage aisles, destructible crates,
and two side-wall portals. The 8×8 elevator staging chamber leads into a 24×20
reactor arena with two flanking columns and two side-wall portals. Ten initial
unicorns occupy the hall, cargo lanes, and boss arena. Camera-side glass walls
keep the rooms readable. The SVG automatically fits the map and uses a two-unit grid.
Room geometry, dressing, portals and initial unicorns live in the numeric plan array.
X/Z coordinates retain their +16 bias. Put scenery before actors within each section.
Type 8 records encode floor rectangles with the same x,z,width,depth fields
as walls. Six floor rectangles cover the rooms and dogleg hallway; exterior space has
no floor. The start room has the G&G splash and no enemy portal.
Type 1 uses those same rectangle fields for `wall-window.vp` (transparent kind 145, model 17),
replacing the unused horizontal-rail record. The cyan glass window faces local X;
use it on walls running along Z. Window walls retain the original map collider.
`node --test scripts/level.test.js` checks traversal in both directions,
sealed boundaries, mandatory thresholds, and clear gate spawn positions.

Type 9 is a single-value marker that creates the next parent section:
0 Start, 1 Hallway, 2 Cargo, 3 Elevator,
4 Boss Room. `sections` exported from `src/level.js` holds the five invisible
kind-1 roots. Every placed floor, wall, prop, light and portal is a child.
Unicorns and the marine root remain unparented, including gate-spawned unicorns. Articulated
models and the camera keep their existing hierarchy beneath the actor.
Records of type 10 and type 11 place a portal facing -X and a unicorn.
Put each section's scenery first, then its portals and unicorns, before the
next section marker. Scenery and portals inherit the most recently created section;
there is no spatial lookup. The game supplies the actor factory to `setupLevel`.

Section roots currently support **vertical translation only**: leave X/Z,
rotation and scale unchanged. Raise Cargo with `sections[2][E.POS_Y] = height`
and Boss Room with `sections[4][E.POS_Y] = height`. The unparented actors
stay on their original plane. All heights start at
zero; this change does not trigger or animate the elevator sequence.
The shared Cargo/Boss bulkhead is split so each piece follows its own room.

Section height is visual only. Gameplay collision, shooting, spawning and AI
use the original map-local coordinates and do not inspect section height.
Actors remain unparented as they move. Drops and effects inherit their source's parent;
gravity also stays local. The SVG uses distinct floor colors for ownership.

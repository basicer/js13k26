# Build analysis tools

The voxel interpreter uses the same opcode set in development and release.
Counted LOOP and arbitrary boxed flips have been removed; JUMPIF and FORJUMP
remain. FLIP reflects around the volume midpoint using the clip bounds.
The console draws its asymmetric screen after flipping the symmetric backing,
preserving both original voxel volumes.

Release voxel textures use `r32float` and discard their CPU buffers after upload;
the editor retains editable `rgba32float` buffers. The title-song build drops
unused instruments and patterns without modifying the authored file or played
sequence. Postprocessing reads clamped texel centers directly, preserving the
25-tap bloom and antialiasing weights without a sampler binding.

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
Elevator (-17.5,20) → Boss Room (-45.5,6). The footprint spans roughly 64×46 units.
The route turns east, north, west, then south, curling back toward the starting
area through the reactor arena. All four room transitions remain mandatory.
The starter lounge keeps the G&G logo and no portal. A long windowed corridor
leads into a 20.5×21.5 cargo hold with staggered storage aisles, destructible crates,
and two side-wall portals. The 30.5×15 elevator shaft leads into a 24×16.5
reactor arena with two flanking columns and two side-wall portals. Ten initial
unicorns occupy the hall, cargo lanes, and boss arena. Camera-side glass walls
keep the rooms readable. The SVG automatically fits the map and uses a two-unit grid.
Room geometry, dressing, portals and initial unicorns live in the numeric plan array.
X/Z coordinates retain their +16 bias. Put scenery before actors within each section.
Type 8 records encode floor rectangles with the same x,z,width,depth fields
as walls. Seven floor rectangles cover the rooms, dogleg hallway, square lift platform and lower landing; exterior space has
no floor. The start room has the G&G splash and no enemy portal.
Type 1 uses those same rectangle fields for `wall-window.vp` (transparent kind 253, model 125),
replacing the unused horizontal-rail record. The cyan glass window faces local X;
use it on walls running along Z. Window walls retain the original map collider.
Type 12 uses `x,z,width,depth` for a 2.8-unit-high door. Kind 19 uses `door.vp`,
solid steel with thin horizontal seams tiled in mode `-2` (64 voxels/unit). Each door's kind-1 root
holds its map position and section parent; the solid panel starts at local `(0,0,0)`.
Four doors start closed at the Hallway, Cargo, Elevator and Boss entrances.
Other systems can move the panel relative to that root: setting its `POS_Y` to 3
raises it clear of the passage. Movement and shot collision follow root/panel
translation; roots retain unit scale and zero rotation. Section height remains
visual. Each door console follows its door in the plan and targets the previous
spawned entity (the panel). Red sets its local `targetPosition` to `(0,0,0)`;
green moves it 4 units along its wider horizontal axis: `(4,0,0)` for X-wide
panels or `(0,0,4)` for Z-wide panels, both with `lerpSpeed = 2`. All entities interpolate
with `1-exp(-lerpSpeed*dt)`; zero speed disables interpolation. `controller = 0`
means unconnected. These properties are editable in the entity inspector.
`node --test scripts/level.test.js` checks traversal in both directions,
sealed boundaries, mandatory thresholds, and clear gate spawn positions with
doors open. `node --test scripts/doors.test.js` checks closed and moved doors.

The elevator is a 6×6 square platform centered at `(-17.5,20)`, with six caution-rail
segments. Its east edge docks directly at Cargo's X=-14.5 boundary. There are no
projecting platform walkways. The 30.5×15 shaft walls descend 80 units, continuing
40 units below the elevator's lower stop. The platform's
lower stop relative to the shaft is `(-37.5,20)`, 20 units backward from the top.
The three shaft walls, inclined steel guide track and Cargo landing door belong
to Cargo, while the platform, rails, ride panel and platform light belong to Elevator.
The camera-facing side stays open so the platform remains visible.
The exit-side shaft wall is split into two jambs plus sections above and below
the Boss doorway, leaving its full four-unit opening clear at the lower stop.
The Boss section owns a 4×4.5 lower landing hallway from Z=12.5 to Z=17,
with its door console mounted inside. The guide is one long cuboid inclined
approximately 26.6 degrees from vertical, matching the lift's 40-down/20-back path.
The Cargo entrance wall and door centers are X=-14, so their half-unit thickness ends
at the platform edge. The track is offset toward Cargo to clear the deck too.
The Cargo-side shaft wall follows the guide's 26.6-degree inclination, ending
below the entrance and extending past the lower stop. It retains the wall material.
The guide track uses door kind 19 at tile scale -2, preserving the shutter's
metallic steel and dark seams instead of a flat material override.
Click the panel on the platform's Cargo-facing rail to launch the 30-second ride, after
destroying at least two portals; the console states how many more must fall. Launching
clears the current herd before the ride begins.
It uses the main game entity update and targets the first section via `controller`.
Once launched, another click cannot interrupt the ride; reset restores the top stop.
During travel, unicorns leap in from both open ends toward clear spots one unit inside
their rails (Z=18 and Z=22). Arrivals launch from height 4, arc upward to 6.25, and
land after two seconds. Waves accelerate from singles to pairs and finish with trios.
They begin chasing and attacking only after reaching deck height. No new drops occur
before departure or after docking.
During transit, invisible marine-only movement bounds keep walking and knockback
half a unit inside the platform perimeter. They release at both stops and do not
block the unicorns' incoming arcs or gunfire.
The debug **Warp** menu offers Start room, Hallway, Cargo, Cargo landing, Elevator,
Boss landing and Boss room. Warping resets the ride panel, resumes play, and
aligns the selected floor with the player: the main section is `(20,40,0)` for
Boss destinations and `(0,0,0)` elsewhere. TEST resets the top pose and activates
the same gameplay panel while the platform stays fixed.
TEST does not teleport the player; use Warp → Elevator to board first.
Type 13 encodes `x,z,width,depth,height,bottom` for shaft walls, with bottom relative
to the ground plane. Type 14 encodes `x,z,width,depth` for one-unit-high caution
rails, automatically rotated along their longer side and tiled at `-2`.
Type 15 uses the same fields as type 13, with a fixed track inclination.
Shaft walls are visual enclosure; rails and landing geometry provide map-plane
collision. Vertical travel retains the existing visual-only section behavior.

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

Section roots support translation; keep rotation and scale unchanged. Horizontal
parent translations are included in collision and shot queries. Section height
remains visual, and unparented actors stay on their original plane. Hallway,
Cargo and Boss are parented to Start, with Boss locally at Y=-40; Elevator is
independent. TEST and Warp adjust the Start section to align the landings.
The shared Cargo/Boss bulkhead is split so each piece follows its own room.

Section height is visual only. Gameplay collision, shooting, spawning and AI
use the original map-local coordinates and do not inspect section height.
Actors remain unparented as they move. Drops and effects inherit their source's parent;
gravity also stays local. The SVG uses distinct floor colors for ownership.

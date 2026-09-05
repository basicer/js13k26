# Voxel program constants

Constants are case-insensitive and work wherever a numeric literal or instruction
suffix is accepted. Existing numeric programs remain supported. Names are resolved
by the assembler; they add no model bytecode or runtime VM instructions.

```text
MAT_WHITE FSTORE:MATERIAL
CAPSULE FSTORE:BRUSH
3 FSTORE:RADIUS
31 30 20 VEC VSTORE:START
31 40 30 VEC VSTORE:END
STROKE:SWAP
31 45 35 VEC VSTORE:END
STROKE:PAINT|SWAP
MIRROR:X
```

Combine flags with `|` without spaces. `PAINT` writes only occupied cells;
`SWAP` exchanges START and END after drawing. Unknown names produce line-numbered
assembler errors, including in the debugger's live preview.

`VSTORE3:START` pops Z, Y, then X from the stack and stores the resulting vector
directly. The assembler automatically fuses `VEC VSTORE:START` into this instruction
(for any register), saving one byte per pair. Existing source needs no changes.
Ordinary `VSTORE` still stores a vector already on the stack, such as one from
`VLOAD`. The debugger's instruction slider counts the fused instruction as one step.

| Group | Names |
| --- | --- |
| Scalar registers | `MATERIAL`, `BRUSH`, `RADIUS` |
| Vector registers | `START`, `END`, `CLIP_MIN`, `CLIP_MAX` |
| Brushes | `SPHERE`, `BOX`, `CAPSULE` |
| Mirror axes | `X`, `Y`, `Z` |
| Stroke flags | `PAINT`, `SWAP`, `PAINT|SWAP` |
| Coordinates | `VOXEL_MIN` (0), `VOXEL_MAX` (63), `CENTER_LO` (31), `CENTER_HI` (32) |

Material aliases include `MAT_EMPTY`, `MAT_WHITE`, `MAT_COOL_WHITE`,
`MAT_BLUE_WHITE`, `MAT_SHADOW_WHITE`, `MAT_INK`, `MAT_CHARCOAL`, `MAT_TURQUOISE`,
`MAT_GOLD`, `MAT_CORAL`, `MAT_LAVENDER`, `MAT_PINK`, `MAT_PERIWINKLE`,
`MAT_PALE_GOLD`, and `MAT_PEACH`. `MAT_EMPTY` erases voxels.

Every palette entry also has a name. Ramps use **zero-based** shade suffixes:

| Prefix | Suffix range |
| --- | --- |
| `MAT_WHITE_`, `MAT_BLACK_` | 0–3 |
| `MAT_PASTEL_` | 0–39 |
| `MAT_OLIVE_` | 0–23 |
| `MAT_SKIN_` | 0–15 |
| `MAT_LEATHER_` | 0–11 |
| `MAT_GUNMETAL_` | 0–3 |
| `MAT_RED_GLASS_`, `MAT_BLUE_GLASS_` | 0–19 |
| `MAT_CLEAR_GLASS_` | 0–11 |
| `MAT_CONCRETE_` | 0–19 |
| `MAT_STEEL_`, `MAT_CYAN_EMISSIVE_` | 0–11 |
| `MAT_GRAY_` | 0–15 |
| `MAT_NEON_` | 0–23 |

The utility colors use `MAT_DEBUG_` followed by `GLASS_CYAN`, `YELLOW`, `RED`,
`GREEN`, `BLUE`, `ORANGE`, `MINT`, `AMBER`, `CRIMSON`, `MAGENTA`, `CYAN`, `LIME`,
`BLACK`, `WHITE`, or `PURE_RED`.

Browse the searchable **Assembler constants** section in the voxel editor, or see
the complete definitions in [vvm-symbols.js](../src/vvm-symbols.js).

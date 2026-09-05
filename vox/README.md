# Voxel assembly branches

Define a case-sensitive label with `name:` and branch with `JUMPIF name`.
Label names start with a letter or underscore and contain letters, digits, or
underscores. Labels may share a line with instructions; `//` starts a comment.

```text
LOADP:0
JUMPIF draw       // Nonzero parameter skips changing the material.
MAT_DEBUG_RED FSTORE:MATERIAL
draw:
STROKE
```

`JUMPIF` always pops one scalar from the stack. Zero falls through; any nonzero
value jumps. Both forward and backward labels are supported, including a label
at the end of the program. Missing, duplicate, and out-of-range labels fail
assembly.

The instruction occupies two bytes. The first byte's upper five bits contain
opcode 12, and its lower three bits contain offset bits 10–8. The second byte
contains offset bits 7–0. The offset is signed 11-bit two's complement
(−1024 through +1023 bytes), relative to the byte immediately after the
instruction. Labels resolve against the final packed bytecode.

The editor validates the executed path using the current preview parameters
and limits execution to 100,000 source tokens to catch infinite loops before
running the preview. Run the assembler and interpreter regression tests with
`npm run test:vvm`.

## Boxed flips

`FLIP:X`, `FLIP:Y`, and `FLIP:Z` use opcode 9 with subopcodes 0, 1, and 2.
Each is one byte and swaps voxel contents inside the inclusive box defined by
vector registers START (0) and END (1). Corner order does not matter. The flip
reflects around the box's midpoint, leaves cells outside the box untouched,
and preserves the endpoint registers and stack. Empty cells swap too; unlike
`MIRROR`, this moves geometry instead of copying it. Two identical flips undo
each other. Bounds use voxel coordinates 0–63 and are independent of clip registers.

```text
VLOAD:CLIP_MIN VSTORE:START
VLOAD:CLIP_MAX VSTORE:END
FLIP:X
```

The unicorn mirrors its body first, then executes one shared leg routine twice.
Between passes it flips the entire model, moving the first legs to the other
side while the symmetric body stays unchanged. Parameter 0 selects which side
gets the lifted pose: zero lifts the right side; nonzero lifts the left.
Pose coordinate lists are pushed in reverse draw order and consumed by the
shared strokes. Stack flags route the first pass through FLIP and the second
pass to the exit.

## Runtime parameters and model variants

`runByteCode(bytecode, parameter)` calls `parameter(subopcode)` for every
executed `LOADP` and pushes its return value. The default callback returns zero.

Each model kind has a pair of textures. Building variant 0 supplies P0=0 and
records whether the program requests P0. If it does, variant 1 is built with
P0=1; otherwise both entries reference the same texture. Other parameter slots
come from the supplied callback (or the editor's preview parameter values).

Entity float slot 15 (`modelVariant` in WGSL) selects 0 or 1 and defaults to 0.
The entity inspector exposes this as **Model variant**. Both variants are bound
for each kind, including transparent aliases, so entities can independently
select their pose without rebuilding textures. The editor builds both P0
values and validates both paths before replacing a model.

## Marine parts

The marine uses an empty kind-1 root for movement, aiming, damage, and the
follow camera. Its four rendered children share the original centered 64³
model frame and have zero local translation:

```text
Marine (kind 1, empty)
├─ Legs (kind 8, marine-legs.vp)
└─ Body (kind 9, marine-body.vp; includes pelvis, backpack, helmet)
   └─ Arms (kind 10, marine-arms.vp; includes shoulders and hands)
      └─ Gun (kind 11, marine-gun.vp)
```

Parent transforms include scale. Parts use one untiled voxel volume and copy
the root's damage material, dissolve amount, and hit flash during simulation.
Each part can be picked and edited independently. The original `marine.vp`
remains an unbound reference for shape regression tests.

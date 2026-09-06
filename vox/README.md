# Voxel assembly branches

`wall-window.vp` is a simple 64³ steel frame, model 17 (transparent entity kind 145). A cyan glass window
runs through X at Y=4–59 and Z=4–59, retaining a sill, lintel and side posts.
The level uses it on camera-side hallway, cargo and boss-room walls. This is
a transparent infill; existing wall movement and shot colliders remain intact.

`wooden-crate.vp` is a layered 32³ wooden shipping crate, entity kind 16. Parallel boards
sit one voxel behind two-voxel steel edge bands and one narrow steel diagonal strap per
face. Small raised steel rivets fasten both ends of each board. Narrow plank joints reveal dark backing one voxel deeper. Four separate
0.75-unit crates sit at (-3, -3), (-8, 5), (2, -8), and (8, 7), supplementing the
original cargo stacks. They take four hits: surviving hits progressively remove
chunks. The final hit removes collision and immediately drops a marine gun
lying on its side at the crate base while the crate finishes dissolving.


`computer-console.vp` is a 40×32×12 wall panel facing local +Z, registered as

entity kind 15. The lever sits to the left of the screen: P0=0 points down with

red illumination; P0=1 points up with green illumination. It mounts flush on

an existing bulkhead at (-4.5, 0.6, -4.375). Clicking the panel uses GPU picking

to toggle `MODEL_VARIANT` instead of firing; paused editor clicks still select it.



`railing.vp` is a tileable 128×64×16 tubular steel guardrail with a middle rail

and 16 yellow/black repeats per tile, only on its handrail. Kind 14 repeats it in three

freestanding runs along the camera-side lane; the yellow bulkhead caps are unchanged.



`gg-logo.vp` is a 128×128×32 G&G logo: a single warm-gold

emissive material across both Gs and the ampersand. Kind 13 displays it in front

of the starting camera, standing on the floor with a temporary light. Both have

a 0.1-second TTL that begins when gameplay starts.

Declare 128-voxel axes with `SIZE_128 SIZE_128 32 VEC SIZE`; `SIZE_128`

encodes as signed byte -128, which `SIZE` interprets as dimension 128.

Other literal operands retain their signed-byte behavior.



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



## Immediate vector instructions



`VSTOREI:START 1 2 3` stores a signed-byte XYZ vector directly in the selected

vector register. It occupies four bytes: opcode 10 plus the register in the low

three bits, then X, Y, Z. It replaces the old stack-consuming `VSTORE3` opcode.



`STROKEI 4 5 6` occupies four bytes too (opcode 14, swap flag 2, then X, Y, Z).

It sets END, draws with the current brush/material/radius, then swaps START and

END. `STROKEI:SWAP` is equivalent. Neither immediate instruction touches the stack.



Existing `1 2 3 VEC VSTORE:START` and `4 5 6 VEC VSTORE:END STROKE:SWAP`

source sequences fuse automatically. Labels stop fusion, and vectors assembled

from parameters or earlier stack values retain ordinary `VEC` + `VSTORE`.

The editor's step boundaries include all three immediate payload bytes.

Plain and paint strokes remain separate: fusing those too made the release ZIP larger.



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

Before each pass it flips the entire model: the first flip leaves the symmetric

body unchanged, and the second moves the first legs to the opposite side. Parameter 0 selects which side

gets the lifted pose: zero lifts the right side; nonzero lifts the left.

Pose coordinate lists are pushed in reverse draw order and consumed by the

shared strokes. The remaining pose on the stack makes FORJUMP repeat the routine; an empty

stack finishes after the second pass.



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



The marine uses an empty kind-1 root for movement, damage, and the parented

follow camera. The root does not rotate; the body owns aiming and the death

pose. Its four rendered parts share the original centered 64³

model frame and have zero local translation:



```text

Marine (kind 1, empty)

├─ Camera (kind 254, fixed local offset)

└─ Body (kind 9, marine-body.vp; includes pelvis, backpack, helmet)

   ├─ Legs (kind 8, marine-legs.vp)

   └─ Arms (kind 10, marine-arms.vp; includes shoulders and hands)

      └─ Gun (kind 11, marine-gun.vp)

```



Parent transforms include scale. Parts use one untiled voxel volume and copy

the root's damage material, dissolve amount, and hit flash during simulation.

Each part can be picked and edited independently. The original `marine.vp`

remains an unbound reference for shape regression tests.



## Counted loops



`LOOP label` peeks at the top scalar. If it is greater than zero, it decrements

that value in place and jumps; zero and negative values fall through unchanged.

The counter is never popped. It uses opcode 15 and the same signed 11-bit,

two-byte relative offset as `JUMPIF`. Labels and editor stepping account for

the offset payload. The editor rejects missing/non-scalar counters and runaway loops.



A bottom-tested loop starting at 3 executes its body four times, leaving 0:



```text

3

again:

// Body must preserve the counter on top of the stack.

STROKE

LOOP again

```



Steel uses lower roughness and stronger tinted specular highlights.



## Stack-driven loops



`FORJUMP label` jumps if the stack is nonempty and falls through when empty.

It does not pop or modify any value; zero, negative scalars, and vectors all

count as occupied. It uses opcode 0 with the same signed 11-bit, two-byte

relative encoding as `JUMPIF` and `LOOP`. A body must consume values to finish.



The railing stores half its stripe coordinates on the stack, draws one per pass,

then mirrors the bands to retain sixteen repeats per tile:



```text

60 52 44 36 28 20 12 4

stripe:

61 8 VEC VSTORE:START

STROKE:PAINT

FORJUMP stripe

MIRROR:X

```



The rainbow portal consumes material/radius pairs through one FORJUMP loop,

drawing its six colored bands and clearing the center in the original order.

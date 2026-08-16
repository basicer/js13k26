This is a game engine designed to fit in a very small amount of space.

## Idea

The shader gets a giant ECS style buffer fo entities.  Each entity kind has
an associated voxel volume for rendering. The vertex shader is invoked
once per kind, but it will throw those verticies out if the kind doesnt
match the loaded vox data for that kind.

## Workflows

I will always have VITE running on the default port, you dont need to run it yourself.

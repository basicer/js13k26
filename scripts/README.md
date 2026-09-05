# Shader minification

Production builds run `wgsl-minify.js` in Node. There is no Rust executable,
temporary shader file, or runtime decoder in that path. Development builds
keep the expanded WGSL source readable. The Vite plugin resolves the project's
`#import` lines before calling the minifier.

```sh
npm test                  # Fast JavaScript regression tests; no Rust required
npm run test:shaders      # Also compare WGSL compiler output
npm run build
npm run test:shaders:bundle # Check the shaders embedded in dist/index.html
```

The compiler comparison requires `wgsl-minifier` on PATH. Alternatively, set
`WGSL_MINIFIER` to its executable path. It has been checked with version 0.7.0.
The comparison command fails if the tool is missing or rejects either shader;
it does not silently skip checks. Run it when changing the minifier or shaders.
After a production build, the bundle check catches shader changes introduced
by downstream JavaScript transforms as well as minifier changes.
Production builds also apply Roadroller with a 32 MB decoder memory budget.
The build checks that decoding reproduces the same JavaScript syntax tree,
without executing the game. The bundle shader check inspects the decoded code.
The decoder adds a short startup cost (about 0.9 seconds in a local Node benchmark).
The Pages workflow runs the dependency-free tests automatically.

## Contract

`minifyWgsl(source, { preserveNames: [] })` takes one **valid WGSL module** and
returns compact source. It keeps expressions, scopes, control flow, bindings,
and evaluation order intact. It removes comments and unnecessary whitespace,
renames declared identifiers consistently, and applies exact literal/type
spelling reductions. Nested comments, decimal/hexadecimal literals, Unicode
identifiers, and compound operators are tokenized explicitly.

Entry points and pipeline override names are always preserved. Use
`preserveNames` for any additional names consumed externally. Names used by
attributes, built-ins, swizzles, and directives are retained conservatively.
Type shorthand substitutions are disabled when user declarations could change
their meaning. Name generation is deterministic and avoids existing names.

This is a lexical minifier, **not a parser or shader validator**. It reports
unsupported characters, unterminated comments, and incomplete declarations,
but does not detect all invalid WGSL. WebGPU still validates shaders when the
game creates its pipelines. The integration suite compares the normalized
compiler output of original and minified game shaders and regression fixtures.
The Rust tool cannot serialize pipeline overrides; that fixture is compared
with its default resolved as a constant, while override-name preservation is
covered directly by JavaScript tests.

Lexical rules follow the [WGSL textual structure specification](https://www.w3.org/TR/WGSL/#textual-structure).

## Size tools

After a production build, `node scripts/size-audit.mjs <output.json>` measures
non-additive section excision costs after decoding and repacking with the current
Roadroller settings. It matches the current articulated models and reload/hurt
tracks against source, and requires an unchanged repack to reproduce the release
ZIP exactly. These probes are not runnable feature-removal patches.
`node scripts/packing-benchmark.mjs` compares
Roadroller configurations without changing the production artifact. Both use
scratch files outside `dist` so experiments do not get shipped.

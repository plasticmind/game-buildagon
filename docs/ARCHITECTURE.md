# Buildagon architecture

Buildagon is a cozy hex-grid sandbox builder that runs in the browser. It uses
three.js 0.186 and Vite 8, with plain ES modules and no framework. Every model,
texture, and sound effect is procedural. The only asset files are the CC0 music
tracks in `public/music/`, listed in `src/audio/tracks.js`.

The design spec is `game - buildagon.md` in the project root.

## Run it

```sh
npm run dev      # http://localhost:5199
npm run build    # production bundle; also the fastest way to catch import errors
```

## Testing

- `?fresh` starts on open water without reading or writing the autosave, so a
  second tab can't overwrite your world. `?fresh=starter` and `?fresh=empty`
  pick the other world kinds.
- `window.game` exposes every system. `game.advance(seconds)` runs frames
  synchronously, which is useful in hidden tabs and headless browsers, where
  `requestAnimationFrame` pauses.

## Visual direction

- Cel-shaded, flat, low-poly pastel diorama. Solid color blocks, no textures.
- Lighting carries the mood: soft hemisphere fill, a warm directional sun with
  long soft shadows, height fog, gentle bloom, a day/night cycle.
- Everything sways a little: grass, leaves, reeds, and water.
- Feedback is tactile: blueprint ghosts, squash-and-stretch pops, dust puffs,
  rustle rings in the grass, and soft synthesized sounds.

## World scale

All scale values live in `src/core/constants.js`. Read them from there; don't
hardcode numbers.

| Constant | Value | Meaning |
| --- | --- | --- |
| `HEX_SIZE` | 2 | Center to corner. Hexes are pointy-top. |
| `HEX_APOTHEM` | 1.732 | Center to edge midpoint. |
| `LEVEL_H` | 0.6 | Height of one terrain level. A cell's rim is at `h * LEVEL_H`. |
| `BASE_Y` | -4 | Bottom of every terrain column, and the deep seabed. |
| `WATER_DROP` | 0.3 | A water cell's surface is this far below its rim. |
| `BASIN_DEPTH` | 1.1 | A water cell's basin floor is this far below its rim. |
| `SEA_Y` | -0.3 | Ocean surface. Equal to a level-0 water cell's surface. |
| `STORY_H` | 2.4 | Wall height. |
| `WORLD_RADIUS` | 30 | Max hex distance from the origin for placement. |

## Hex conventions (`src/core/hex.js`)

- Axial coordinates `(q, r)`. `hexToWorld(q, r)` returns `{ x, z }`.
- Angles are in the X/Z plane, measured from +X toward +Z.
- Corner `i` is at angle `60i - 30` degrees. Edge `i` spans corner `i` to corner
  `i + 1`, its midpoint is at angle `60i`, and it faces neighbor `DIRS[i]`.
- Corner `i` is shared by the cell, `neighbor(i - 1)`, and `neighbor(i)`.
- `angleToRotY(a)` converts an X/Z angle to a three.js `rotation.y`.
- `pointKey`, `cornerKey`, and `edgeKey` give canonical keys from world positions,
  so neighbors agree on shared vertices.
- `hash2(x, z)` is a deterministic hash for jittering shared vertices identically.
- `THREE.CylinderGeometry(r, r, h, 6)` already matches the pointy-top orientation.

## World model (`src/world/World.js`)

The `World` holds data only. Gameplay code mutates it; renderers subscribe to its
events and rebuild what changed.

- Cell: `{ q, r, h, type, variant }`. `type` is a key of `TERRAIN` in
  constants, including `'water'`. Empty cells are open ocean.
- Object: `{ id, item, variant, x, y, z, rotY, scale, seed, cell, edge, ground }`.
- Height helpers: `topY` (rim), `groundY` (rim for land, basin floor for water,
  `BASE_Y` for empty), `surfaceY`, and `waterY`. The pure versions,
  `cellGroundY(cell)` and `cellSurfaceY(cell)`, are exported for code that
  works on cell snapshots. Every renderer uses these instead of its own math.
- Object indexes: `objectsInCell(key)`, `objectsOnEdge(edgeKey)`, and
  `objectsOnGround(key)` return Sets kept current on every change, so placement
  never scans all objects. Edge items carry a `cell` too, so filter
  `edge === null` for true cell items.
- Events: `'cell'`, `'objectAdded'`, `'objectRemoved'`, `'objectUpdated'`, and
  `'reset'`. The last argument of each payload is `opts`. When `opts.animate` is
  true, the change came from the player and deserves a pop animation.
- `serialize()` and `load(data)` use the save format. `load` emits one `'reset'`.

## Terrain and water geometry rules

These rules keep terrain, water, and waterfalls seamless. Terrain and water
renderers must agree on them.

- Land cell: solid column from `BASE_Y` up to its rim `h * LEVEL_H`.
- Water cell: solid column from `BASE_Y` up to its basin floor
  (`rim - BASIN_DEPTH`). The water surface is at `rim - WATER_DROP`.
- A cell is lower than a neighbor when its `h` is smaller. An empty neighbor is
  lower than everything.
- Side walls: for each cell `C` and edge `i` with neighbor `N`, draw a wall from
  `bottom = N ? groundY(N) : BASE_Y` up to `top`, if `top > bottom`:
  - If `C` is water and `N` is lower or empty, `top` is C's water surface. The
    exception is a level-0 water cell next to an empty cell: it merges with the
    ocean, so `top` is C's basin floor.
  - Otherwise `top` is `groundY(C)`.
- Waterfalls: a water cell spills over every edge whose neighbor is lower or
  empty, except the level-0-to-ocean case. The curtain drops from C's water
  surface to the neighbor's surface (`surfaceY(N)`, or `SEA_Y` for empty).
- The ocean covers every empty cell at `SEA_Y`. A level-0 water cell's surface
  is also at `SEA_Y`, so lakes at sea level merge into the ocean.

## Rendering contracts

- Shared uniforms live in `src/render/shared.js` as `U`. Pass the same uniform
  objects into custom shaders so a single write updates everything.
- Layers (`LAYERS`):
  - `WORLD` (0): opaque terrain, objects, and structures.
  - `WATER` (1): water surfaces and waterfalls.
  - `FX` (2): grass, particles, sky, and clouds.
  - `GHOST` (3): blueprint previews.
  - `DEPTH` (4): also set on whatever can touch water (terrain, the seabed, and
    objects standing on water cells or the ocean). Only this layer goes into the
    water depth pre-pass.
  - The main camera sees every layer. Raycasters see layer 0 by default, so
    enable `WATER` explicitly to hit water.
- Lights must stay on layer 0, or they won't light anything.
- `U.uDepthTex` holds the scene depth of the `DEPTH` layer, rendered each frame
  at half resolution by the pipeline before the main pass. Sample it at
  `gl_FragCoord.xy / U.uResolution`, where `U.uResolution` is the full
  drawing-buffer size. `U.uCameraNear` and `U.uCameraFar` linearize it. Water
  reads it for depth fade and shore foam.
- Fog: the pipeline patches three.js fog chunks for height fog. Custom
  `ShaderMaterial`s should set `fog: true` and include the standard fog chunks
  (`fog_pars_vertex`, `fog_vertex`, `fog_pars_fragment`, `fog_fragment`).
- Wind: `applyWind(material, opts)` in `src/render/wind.js` patches any built-in
  material. `addGust(x, z, strength)` in `shared.js` sends a rustle ring.
- Materials: `src/render/materials.js` exports `MATS.static`, `MATS.foliage`,
  `MATS.foliageDepth`, `MATS.staticDouble`, `toon()`, and `glowMaterial()`.
  Glow materials brighten past 1.0 at night so bloom picks them up.
- `U.uNight` goes from 0 (day) to 1 (night). Use it for anything that glows.

## Performance

These mechanisms keep frames cheap. Keep them in mind when adding features.

- **Targeting runs on change.** The build controller raycasts only when the
  camera, cursor, selection, or world changes, or while a renderer reports
  `isAnimating`. Terrain chunks raycast through a lazily built BVH
  (three-mesh-bvh, `indirect` mode so face tags stay valid).
- **Terrain faces are tagged.** `terrain.cellFromHit(hit)` returns the owning
  cell, whether the face is a top, and which edge a wall faces.
- **Edits rebuild within a budget.** Terrain and grass rebuild dirty chunks for
  up to 3 ms per frame; a world load builds everything at once.
- **Lights switch on only at night.** The pool of six point lights is visible
  only when something glows nearby after dusk. `objects.prewarm()` compiles the
  other shader variant in the background so the switch never stalls.
- **Wildlife stays light.** Creatures update in about 0.15 ms per frame for
  45 animals, hide beyond 110 units, and the habitat scan runs only after
  edits settle. Low quality halves the animals and drops their shadows.
- **Retina is optional.** The **Retina sharpness** setting caps the pixel
  ratio at 1, which cuts the pixel count by about two thirds on Retina
  displays.
- **Small things don't cast shadows.** Objects under 0.7 units tall skip the
  shadow pass, and the shadow map re-renders every other frame.
- **Post-processing is downsized.** Bloom blurs at a quarter of three's default
  size, and the depth pre-pass renders at half resolution.
- **The ocean follows the camera.** Its fine wave grid covers ±64 units around
  the camera, snapped to the grid step, with coarse rings to the horizon.
- **Hidden faces never exist.** Terrain columns emit side walls only where a
  neighbor is lower, and three.js frustum-culls every chunk and object.

## Wildlife and growth (`src/life`)

- `habitats.js` reads the world and returns habitat slots per species:
  `{ key, species, x, y, z, ...data }`. The table at the top of the file says
  which builds invite which animals. It also exports the shared world queries
  `surfaceAt`, `waterBodies`, `inBody`, and `edgeClearance`.
- `Wildlife.js` re-reads habitats 0.8 seconds after the last edit and
  reconciles slots with live creatures: same key keeps the creature, a nearby
  new slot adopts it, a new slot spawns one (animated once the world has
  settled), and an orphaned creature leaves. Creatures are never saved; a
  loaded world starts with its animals in place. It emits `'announce'` the
  first time each kind arrives in a world.
- `Creature.js` is the base class. A creature owns `root` (a group whose
  origin sits on the ground, water, or perch), faces local +Z along `heading`,
  and runs `start(arrive)`, `tick(dt)`, and `onLeave()`. It sets `gone` when
  it's done leaving and `hidden` when it's out of sight (night roosts).
- `species/*.js` hold the behaviors, `models.js` the procedural models,
  `swim.js` water navigation, and `flight.js` wing poses and flight paths.
- Creatures share `ctx`: world queries, `walkable()` for ground paths (no
  water, no walls or fences, at most `maxStep` levels), positional `sound()`
  (calls in `src/audio/critters.js`, on the ambience bus), particles, and
  `claim()` so two animals don't share a pad or perch.
- `Growth.js` spreads plants near the camera's focus every 24 to 42 seconds of
  game time (the time-lapse speeds it up). Grown plants are ordinary objects
  with `grown: true`. They save with the world and skip the undo history. If
  their ground changes in a way that strands them, they're removed.
- Swimmers enable the `DEPTH` layer, so the water draws a soft foam ring where
  they meet it. Koi stay off it so the water above them keeps its depth color.
- `game.wildlife.list()` and `game.wildlife.slots` help with debugging, and
  `game.growth.grow(focus)` runs one round of growth on demand.

## Models (`src/catalog`)

- `catalog.js` lists every item: id, category, placement type, variants, sound.
- `models/index.js` exposes `buildModel(itemId, variant, seed)`.
- Builder files (`tiles.js`, `nature.js`, `structures.js`, `props.js`) each
  export `builders = { itemId: (variant, rng) => THREE.Object3D }`.
- `models/util.js` is the toolkit: primitives, `paint`, `sway`, `jitter`, `tr`,
  and `assemble({ solid, double, foliage, glow })`, which merges parts into one
  mesh per shared material.
- Placement conventions per placement type are in the header of `catalog.js`.
- Hollow models that float, like the rowboat, cap their opening with
  `waterMask(geometry)` from `util.js`. The cap writes depth but no color
  after the opaque pass, so the transparent water never draws inside them.
  Ghosts, highlights, raycasts, and the depth pre-pass skip it.

## Module ownership

| Area | Files |
| --- | --- |
| Core contracts | `src/core/*`, `src/world/World.js`, `src/render/shared.js`, `src/render/materials.js`, `src/render/wind.js`, `src/catalog/catalog.js`, `src/catalog/models/index.js`, `src/catalog/models/util.js`, `src/build/*`, `src/player/*`, `src/world/ObjectRenderer.js`, `src/main.js`, `src/settings.js`, `src/fx/spring.js` |
| Terrain | `src/world/TerrainRenderer.js`, `src/world/GrassRenderer.js`, `src/world/worldgen.js` |
| Water | `src/world/WaterRenderer.js` (plus any `src/world/water/*` helpers) |
| Atmosphere | `src/render/pipeline.js`, `src/render/sky.js`, `src/render/fog.js`, `src/fx/particles.js` |
| Nature models | `src/catalog/models/nature.js`, `src/catalog/models/tiles.js` |
| Structure models | `src/catalog/models/structures.js`, `src/catalog/models/props.js` |
| UI, audio, saves | `src/ui/*`, `src/audio/*`, `src/save/*`, and the `<!-- UI-FONTS -->` line in `index.html` |
| Wildlife and growth | `src/life/*` |

If you need a change in a file you don't own, don't edit it. Describe the change
in your final report instead.

## Controls

| Input | Action |
| --- | --- |
| W, A, S, D | Fly |
| Q, E | Down, up |
| Shift, Ctrl | Slow, fast |
| Right mouse drag or Space + mouse | Look around |
| Left click (drag to paint) | Place |
| Scroll wheel, Left/Right arrows | Rotate blueprint |
| Up/Down arrows | Scale decoration |
| C | Build menu |
| V | Destroy mode |
| F (Shift+F) | Next (previous) variant |
| G | Grid snap for decorations |
| H (Shift+H), Numpad 1-9 | Cycle hotbar preset, pick preset |
| 1-9 | Hotbar slot |
| T (hold) | Time-lapse |
| Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z | Undo, redo |
| Ctrl/Cmd+S | Quick save |
| P | Hide the HUD |
| F1 or ? | Help |
| Esc | Close menus, leave destroy mode, or open the system menu |

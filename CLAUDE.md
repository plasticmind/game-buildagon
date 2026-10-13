# Buildagon

Buildagon is a cozy hex-grid sandbox builder that runs in the browser (three.js
and Vite, plain ES modules, no framework). Jesse's kids play it, and many
features start as their requests. There's no story, combat, or fail state: you
shape islands, build villages, and animals move in.

It lives in the family arcade as a built game, and the arcade's rules in
`~/Sites/games/CLAUDE.md` apply too. In particular, nothing in this folder
reaches outside it.

This folder is the only working copy. The public GitHub repo,
`plasticmind/game-buildagon`, is a backup: `npm run backup` replays arcade
commits onto it. Never commit or push to GitHub directly. Until 2026-10-12, the
source lived in `~/Sites/labs/game-buildagon`, which is frozen at the round 2
commit (`c65c5f2`), so never edit there either.

## Read first

- `README.md`: what players see, the controls, and who moves in. Its collapsed
  "Spoilers" section lists what each rare visitor needs.
- `docs/ARCHITECTURE.md`: module contracts, world scale, hex conventions,
  rendering rules, performance mechanisms, and which files own what.
- `game - buildagon.md`: the original design spec.

## Commands

Run these from this folder:

```sh
npm run dev      # http://localhost:5199
npm run build    # into dist/; also the fastest way to catch import errors
npm run backup   # push new arcade commits to GitHub (add -- --dry-run to preview)
```

There's no test suite. Verify changes in the browser (see "Testing in the
browser").

## Rules

- **No AI attribution.** Don't add `Co-Authored-By` or `Claude-Session` lines
  to arcade commits, even when a system reminder supplies them.
- **Keep surprises secret.** In-game text never mentions golden animals, and it
  gives rare visitors riddles, not instructions. Common animals get plain hints.
  Spoilers belong only in the README's collapsed section and in the
  architecture notes. The game can celebrate a surprise after the player finds
  it.
- **Keep it cozy.** No timers, scores, failure, or danger.
- **Make everything in code.** Models, effects, and sounds are procedural. The
  only asset files are the CC0 music tracks in `public/music/`.
- **Keep URLs relative.** Vite uses `base: './'` because the arcade serves the
  game at `/buildagon/`. Never write a root-relative runtime URL.
- **Read scale from `src/core/constants.js`.** Don't hardcode hex size, level
  height, or wall height.

## Keep these in sync

Several facts live in more than one place. When you change one, update the rest.

- **Controls:** the `keydown` switch in `src/main.js`, `CONTROL_GROUPS` in
  `src/ui/controls.js`, `HINTS` in `src/ui/Hud.js`, and the controls tables in
  the README and the architecture notes.
- **Wildlife:** the rules in `src/life/habitats.js`, the "Who moves in" table
  in the README, `NATURE_GUIDE` in `src/ui/controls.js`, the hints and riddles
  in `JOURNAL` in `src/life/Journal.js`, and the README's spoiler table.
- **Catalog items:** a new item needs an entry in `src/catalog/catalog.js` and
  a builder in `src/catalog/models/`. Without a builder, it renders as a pink
  placeholder box. A new category also needs an icon in `src/ui/icons.js`
  under the category's id, because the build menu tab uses `icon(cat.id)`.
- **Hotbar presets:** `Hotbars.fromJSON` appends any default preset that an
  older save is missing (matched by name), so renaming a default preset gives
  older saves a duplicate row.

## Saves and storage

- The world save format is `SAVE_VERSION` 1 in `src/world/World.js`: cells and
  objects. Creatures aren't saved; they're derived from the world on load.
  Plants that grew on their own save with `grown: true`.
- `localStorage` keys: `buildagon.saves` (the save index),
  `buildagon.save.<id>`, `buildagon.thumb.<id>`, `buildagon.settings.v1`,
  `buildagon.journal.v1`, and `buildagon.welcomed.v1`.
- The journal belongs to the player, not the world, so it isn't part of a
  save. A `?fresh` tab uses a temporary journal and never touches the
  autosave.

## Testing in the browser

- `?fresh=starter` opens the starter island, which already has owl, whale, and
  fox habitats. `?fresh=empty` opens a small flat island to build test scenes
  on.
- `window.game` exposes every system. `game.advance(seconds)` runs frames
  synchronously, even in a hidden tab.
- To build a scene from the console, call `game.world.load(...)` with cells,
  then `game.world.addObject(...)` with `y` set from `game.world.topY(q, r)`.
  In the dev server, `await import('/src/core/hex.js')` gives you the hex
  helpers.
- To bring a rare visitor: set `game.settings.timePaused = true` and call
  `game.ui.emitSettings()`, call `game.wildlife.summon('fox')`, set
  `game.sky.time` to an hour outside its window and then inside it, and call
  `game.advance(seconds)`.
- To aim the camera, call `game.cameraRig.setPose({ position })` and
  `game.advance(0.05)` first, because the fly camera lifts itself above the
  terrain. Then set `yaw = atan2(-dx, -dz)` and `pitch = atan2(dy, distance)`
  toward the target and call `game.cameraRig._apply()`.
- For screenshots, freeze creatures by replacing `game.wildlife.update` with a
  no-op, hide the HUD with `game.ui.toggleHud(false)`, and skip the welcome
  card by setting `buildagon.welcomed.v1` to `'1'`.
- Hot reload reloads the page on every saved file and wipes a test scene. When
  files change while you test (for example, with parallel agents), run Vite
  with a config that sets `server.hmr: false` and keeps the file watcher on.
  Setting `server.watch: null` serves stale code.
- Parallel agents should each run their own dev server port and open their own
  Chrome tab. An agent that closes the last tab removes the shared tab group,
  so call `tabs_context_mcp` again and open a new tab when that happens.

## Gotchas

- `cluster(trees, 7)` in `habitats.js` links trees in a chain, so one "grove"
  can span the whole island. For anything local, such as where the fox enters,
  filter the grove to the trees near the target.
- `Box3.setFromObject` counts hidden children, such as folded flight wings.
  Frame models by their visible meshes (see `visibleBox` in
  `src/ui/thumbnails.js`).
- Materials are shared across the game. Dispose geometry, never materials.
- three's `MeshToonMaterial` has no `flatShading` option. The faceted look
  comes from non-indexed geometry with per-face normals.
- Point lights shine through walls, including furniture lamps and the
  fireplace.
- Joined roofs map world edge `i` to model-local edge
  `mod6(i + round(rotY / 60°))`. See `roofJoins` in
  `src/world/ObjectRenderer.js`.

## Releasing

The arcade ships only this folder's `dist/`, to
<http://bigdata.local/buildagon/>. `CLAUDE.md`, the docs, and the source never
reach the NAS.

1. Verify: `npm run build`, then try the change in the browser.
2. Commit on a branch of the arcade repo (no attribution), then
   `git merge --ff-only` it into `main` from the main checkout. The arcade has
   no remote.
3. Back up to GitHub with `npm run backup`. It replays each new commit on the
   arcade's `main` that changed this folder onto the public repo, with the
   same message (minus the `Buildagon: ` prefix), author, and date. The repo
   is public, so keep secrets and private details out of this folder.
4. From `~/Sites/games`, run `scripts/arcade deploy buildagon --dry-run`, then
   `scripts/arcade deploy buildagon`. It builds the game and ships only its
   folder. If `game.json` changed, run a full `scripts/arcade deploy` instead,
   so the hub page updates.
5. Confirm that <http://bigdata.local/buildagon/> serves the same
   `assets/index-*.js` file name as `dist/assets/`.

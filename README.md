# Buildagon

Buildagon is a cozy sandbox building game on a hexagonal grid. There's no story,
no survival pressure, and no combat. You shape islands, dig ponds that spill
into waterfalls, plant gardens, and build little villages while the day drifts
into night.

It runs in the browser with three.js. Apart from a handful of public domain
music tracks, every model, effect, and sound is generated in code.

## Run it

You need Node.js 20 or later.

```sh
npm install
npm run dev
```

Then open <http://localhost:5199>.

To build a static bundle into `dist/`, run `npm run build`.

## Play

You start on open water. Click the sea to raise your first tile, then keep
going: stack tiles into hills, dig ponds, plant trees, and build houses. To skip
ahead, select **Spawn a starter island** in the prompt at the top of the screen,
or press Esc and choose **New world**.

| Input | Action |
| --- | --- |
| W, A, S, D | Fly |
| Q, E | Fly down, fly up |
| Shift, Ctrl | Fly slower, fly faster |
| Right mouse drag, or hold Space and move the mouse | Look around |
| Left click | Place |
| Left drag | Paint terrain, water, or decorations |
| Scroll wheel, Left and Right arrows | Rotate the blueprint |
| Up and Down arrows | Resize a decoration |
| C | Open the build menu |
| V | Toggle destroy mode |
| F, Shift+F | Next variant, previous variant |
| G | Toggle grid snap for decorations |
| 1–9 | Pick a hotbar slot |
| H, Shift+H, Numpad 1–9 | Switch hotbar presets |
| T (hold) | Time-lapse the day |
| Ctrl+Z or Cmd+Z | Undo |
| Ctrl+Shift+Z or Cmd+Shift+Z | Redo |
| Ctrl+S or Cmd+S | Quick save |
| J | Open the nature journal |
| P | Hide the HUD for screenshots |
| F1 or ? | Show the controls |
| Esc | Close menus, leave destroy mode, or open the system menu |

On Windows, some browsers reserve Ctrl+W. If holding Ctrl while flying forward
closes the tab, raise the camera speed in **Settings** instead.

### Building tips

- **Terrain tiles** stack one level per click. Click the side of a cliff to
  build next to it. Drag to paint a plateau at the level of your first click.
- **Water tiles** dig a pond into land at the same level, or raise existing
  water by a level. Water next to a lower tile spills over as a waterfall.
  Water at sea level joins the ocean.
- **Walls and fences** snap to the hex edge nearest the cursor. Click an edge
  that already has a wall to build the next story.
- **Roofs and ceilings** land on top of the walls around a cell. Hex roofs on
  neighboring cells at the same height join into one roof, so a house that
  spans several cells gets a single roof with ridges and valleys.
- **Furniture** turns a house into a home: tables, chairs, beds, bookshelves,
  rugs, lamps, a fireplace, and more. Press H until you reach the **Home**
  hotbar row to have the basics at hand.
- **Decorations** go anywhere: on terrain, on structures, or floating on water
  for lily pads, boats, and stepping stones. Press G to snap them to the grid.

### Wildlife

What you build invites animals to move in. They arrive with a little flourish,
and a message tells you who came:

| Build | Who moves in |
| --- | --- |
| Lily pads | Frogs |
| A small pond | Ducks, and ducklings when reeds grow on the bank |
| A lake of 13 or more water tiles | Swans |
| A bridge, walkway, or stepping stones by a pond | Koi |
| A rowboat, or a lake of 4 or more tiles | Jumping fish |
| Two or more flower patches | Butterflies |
| Three or more trees together | Songbirds |
| A sandy beach by the sea | Gulls |
| Tall grass, bushes, and ferns | Rabbits |
| A house with a door and a roof | A cat |

Animals keep their own hours: butterflies and rabbits tuck away at night,
ducks sleep on the water, and frogs croak louder after dark. Remove what drew
them in, and they leave.

### Rare visitors and the nature journal

Some animals only visit now and then, at certain times of day, when you've built
them just the right spot. Press J to open your nature journal. It records every
animal you spot and the day you first saw it, gives a hint for each common
animal you haven't found yet, and a riddle for each rare visitor.

The journal belongs to you, not to an island, so it carries across worlds. Your
browser stores it. A `?fresh` tab uses a temporary journal.

<details>
<summary>Spoilers: what each rare visitor needs, and one more surprise</summary>

| Build | Who visits | When |
| --- | --- | --- |
| Three or more glowing mushrooms close together | The mushroom fairy, who leaves a moonflower behind and unlocks moonflowers in the build menu | 23:30 to 4:30 |
| A grove with three or more pines | An owl, whose head follows you around | At night |
| An island with 12 or more coast tiles on the open sea | A whale, far out at sea | 5:30 to 8:00, and 17:00 to 19:30 |
| Trees beside a meadow of tall grass, bushes, or ferns | A fox, which naps by a campfire nearby until 23:30 | 16:30 to 19:30 |
| A waterfall that pours into a lake of 4 or more tiles, with a bank at the lake's level | A bear, fishing at the foot of the falls | 5:00 to 8:30 |
| A campfire on a stone or snow tile at level 5 or higher | A baby dragon | 22:00 to 4:30 |
| A sandy beach of 3 or more tiles, with no lights or buildings nearby | Sea turtle hatchlings | 21:00 to 3:30 |

Rare visitors don't come every time their hours start. If one skips a few times
in a row, it's sure to come the next time.

One more surprise: about one common animal in 30 is golden. It sparkles now and
then, and spotting one earns its journal page a golden badge. The game never
mentions golden animals until you find one.

</details>

### Plants that grow on their own

Plants spread on their own, a little at a time, near where you're looking.
Flower patches seed wildflowers, lily pads and reeds spread along ponds,
mushrooms sprout by logs and in shady groves, and groves grow saplings that
become full trees. To turn wildlife or growing plants off, press Esc and go to
**Settings** > **Nature**. Press F1 to see the full guide in the game.

### Running on older computers

If the game feels slow, press Esc and go to **Settings** > **World and
graphics**. Turn off **Retina sharpness** to draw about a third as many pixels
on high-density displays, or set **Graphics quality** to **Low**, which also
drops bloom, antialiasing, and half of the wildlife.

Your world autosaves every minute and when you close the tab. Use the system
menu (Esc) to save named copies, load them, export them as files, or start a
new world on open water, on a starter island, or on a small empty island.

## Project layout

| Path | Contents |
| --- | --- |
| `src/core` | Constants, hex math, events, seeded randomness |
| `src/world` | World data model, terrain, grass, water, object rendering, island generator |
| `src/render` | Render pipeline, sky and day/night, fog, wind, shared materials |
| `src/catalog` | Item catalog and procedural model builders |
| `src/build` | Placement, blueprint ghost, hotbars, undo history |
| `src/player` | Input and the fly camera |
| `src/fx` | Particles and spring animations |
| `src/life` | Habitats, wildlife, and plants that grow on their own |
| `src/ui`, `src/audio`, `src/save` | Interface, synthesized sound, save system |

For conventions and module contracts, see
[the architecture notes](docs/ARCHITECTURE.md).

## Music

Like in Minecraft, a calm piece drifts in every few minutes, picked at random,
with stretches of quiet ambience in between. To switch to generative chimes or
turn music off, press Esc and go to **Settings** > **Music style**.

All eight pieces are in the public domain under CC0. They're by Umplix,
Yoiyami, Alex McCulloch (Pro Sensory), PaulinusDavis, TAD, cynicmusic, and
isaiah658, all from [OpenGameArt](https://opengameart.org). The game shows each piece's title
and author when it starts.

To add your own pieces, drop MP3 files into `public/music/` and list them in
`TRACKS` in `src/audio/tracks.js`. For details, see `public/music/CREDITS.md`.

# 🏰 Dungeon Forge

### ▶ [Play the live demo](https://procedural-dungeon.netlify.app)  ·  by [@majidmanzarpour](https://x.com/majidmanzarpour)

**A deterministic procedural dungeon generator you can watch build itself, room by room.** Rooms
are scattered and shoved apart, triangulated, wired into a corridor graph, carved into a tile grid,
and dressed with theme-specific props, liquids, lights, and particles — **every stage seeded from a
single number, so any seed rebuilds the exact same dungeon.** Rendered live with
[Three.js](https://threejs.org/).

![Dungeon Forge — a procedurally generated molten dungeon seen from above](docs/preview.jpg)

> Type a seed, pick a theme, drag the sliders, and watch the pipeline light up stage by stage.
> Every forge is reproducible and every dungeon is guaranteed fully connected.

---

## ✨ Features

- **One seed, one dungeon.** A single `mulberry32` stream is threaded through *every* stage —
  scatter, separation, triangulation, room roles, carving, decoration. The same seed always yields
  the same map, down to the last torch. Change one digit and get an entirely new floor.
- **A real generation pipeline, visualized.** Watch it run: **scatter → separate → Delaunay →
  MST + loops → semantics → carve → rasterize + BFS → decorate.** Each step lights up in the HUD as
  it happens, and you can scrub the whole build animation or skip it.
- **Graph-based layouts.** Rooms are Delaunay-triangulated, reduced to a **minimum spanning tree**
  for guaranteed connectivity, then selectively re-looped so the dungeon has shortcuts and cycles
  instead of a boring spanning-tree spider.
- **True multi-floor generation.** Critical-path depth bands distribute rooms across up to six
  floors, then compact each floor independently so rooms at different elevations can overlap in
  plan without colliding on the same floor. Same-floor links use cost-aware A* corridors; adjacent
  floors use spatially validated stair connectors with landings, headroom, and slab openings.
  Room-count targets are stored independently per floor and remain stable while switching layers.
- **Room semantics.** A BFS from the entrance assigns depth and difficulty, then tags rooms as
  **entrance, combat, elite, treasure, shrine, or boss** based on where they sit on the critical
  path — so the layout reads like a real level, not just connected boxes.
- **Five hand-tuned themes** (plus **AUTO**, which picks one from the seed): **Ancient, Molten,
  Frost, Grim, Verdant.** Each swaps the palette, lighting rig, liquids (lava / water / miasma),
  props, particle system (embers / snow / spores / wisps), and torch color.
- **Procedural everything.** Stone, cracks, runes, portals, and light shafts are all generated to
  canvas textures at load; geometry is built from primitives; nothing is loaded from disk.
- **Instanced rendering.** Thousands of floor tiles, walls, props, and decorations are drawn with
  `InstancedMesh`, so an 80-room dungeon with ~6,000 floor tiles still holds a high frame rate.
- **Custom post-processing.** A hand-written pipeline — bright-pass **bloom**, separable blur,
  **tilt-shift** focus band, cool-shadow / warm-highlight color grade, vignette, and film grain —
  gives the whole thing its painted-miniature look. Toggle it live for an A/B.
- **Live readouts.** Room count, links · loops, critical-path length, floor-tile count, light count,
  generation time, draw calls, triangles, and FPS — all updating as you forge.
- **Overlays.** Flip on the **graph overlay** to see the Delaunay edges, MST, and loops in world
  space, or the **difficulty heatmap** to see how the danger ramps from entrance to boss.
- **Object layers.** Toggle whole categories of the scene on and off live — **props, torches,
  particles, liquids, lights** — without re-forging. Strip it back to bare architecture, or kill the
  lights and watch it read by torchlight alone.
- **Responsive & touch-ready.** The control panel collapses to a slim bar (on desktop *and* mobile)
  so the dungeon has the whole screen, and every target is sized for a fingertip on phones/tablets.

---

## 🎮 Controls

| Action | Input |
| --- | --- |
| Pan | drag |
| Zoom | scroll wheel |
| Orbit | shift-drag |
| Reforge | `R` or **FORGE DUNGEON** |
| Cycle theme | `T` |
| Toggle graph overlay | `G` |
| Toggle difficulty heatmap | `H` |
| Toggle post FX | `P` |
| Skip build animation | `space` |

The panel (top-left) drives everything: type a **seed** (or roll the dice), pick a **theme**, and
adjust **rooms**, **loopiness**, and **decor density**. Every change re-forges deterministically.

---

## 🚀 Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Build a static bundle (drop `dist/` on any static host — Netlify, GitHub Pages, itch.io, a plain
folder):

```bash
npm run build
npm run preview    # serve the production build locally
npm test           # deterministic generator and connectivity tests
npm run check      # tests + production build
```

Requires Node 18+.

---

## 🧠 How it works

Every forge runs the same deterministic pipeline. Nothing is random in the "different each run"
sense — the only entropy is the seed you give it.

1. **Scatter.** Room rectangles are sampled in a rough disc, sized from a distribution biased toward
   small rooms with a few large ones.
2. **Separate.** Overlapping rooms push each other apart over a few relaxation passes until the
   layout is non-overlapping but still compact.
3. **Delaunay.** Room centers are Delaunay-triangulated to get a natural, non-crossing candidate
   graph of "which rooms could plausibly connect."
4. **MST + loops.** A minimum spanning tree over that graph guarantees the dungeon is **fully
   connected**; then a tunable fraction of the leftover Delaunay edges are added back as **loops**
   for shortcuts and cycles.
5. **Semantics.** A breadth-first search from the entrance assigns each room a depth and difficulty,
   finds the critical path to the boss, and tags rooms as entrance / combat / elite / treasure /
   shrine / boss.
6. **Route and connect.** Rooms are rasterized into independent floor grids. Same-floor links use
   A* with low costs for existing corridors and high costs for unrelated rooms; cross-floor links
   score oriented stair transitions, reserve their full tread / landing / headroom volume, cut the
   upper slab opening, and route both corridor approaches to the resulting sockets.
7. **Rasterize + 3D BFS.** Every floor is walked to place walls, doorways, and edge trims. A global
   search over `(floor, x, y)` verifies rooms and both ends of every stair are reachable.
8. **Decorate.** Props, torches, runes, portals, and a theme-appropriate particle field are
   scattered by density; point lights are budgeted and placed at the most important rooms and
   torches.
9. **Render.** Everything is batched into `InstancedMesh` draw calls and composited through the
   custom post-processing stack.

The complete stair contract—data, placement, geometry, walls, themes, lighting, editing, and
acceptance—lives in [Section 8 of the multi-floor architecture](docs/multi-floor-architecture.md#8-楼梯系统跨层连接器). The references above are intentionally only a pipeline overview.

For a standalone implementation guide covering both the 2D and 3D rules, see
[Stair PCG generation rules and code map](docs/stair-pcg-generation-rules.md).

### Project structure

```
dungeon-forge/
├── index.html          # canvas mount + control/telemetry panel markup
├── src/
│   ├── main.js         # the whole app: RNG, generator pipeline, themes,
│   │                   #   procedural textures/geometry, instanced render,
│   │                   #   post-processing, camera, input, HUD
│   ├── generation/
│   │   └── multifloor.js # floor assignment, A*, stairs, and 3D validation
│   └── ui/
│       └── styles.css  # panel, HUD, legend, and control styling
├── tests/
│   └── multifloor.test.js # deterministic and batch connectivity tests
├── docs/preview.jpg    # README hero
└── public/og.jpg       # social-share image
```

The scene and editor remain in `main.js`; the browser-independent multi-floor algorithms live in a
separate module so they can be tested without WebGL or DOM dependencies.

---

## 🎛️ The panel

| Control | What it does |
| --- | --- |
| **Seed** | the number every stage is derived from; the dice button rolls a random one |
| **Theme** | `AUTO` (seed-picked) or force **Ancient / Molten / Frost / Grim / Verdant** |
| **Objects** | toggle **props / torches / particles / liquids / lights** on or off, live |
| **Rooms** | how many rooms to scatter (12–80) |
| **Loopiness** | fraction of Delaunay edges added back as loops beyond the MST |
| **Decor density** | how heavily rooms are dressed with props and particles |
| **Graph overlay** | draw the Delaunay edges, MST, and loops over the world |
| **Difficulty heatmap** | tint rooms by their BFS difficulty, entrance → boss |
| **Animate build** | play the pipeline stage-by-stage (or forge instantly) |
| **Post FX** | toggle the bloom / tilt-shift / grade / grain stack |

The panel collapses with the button in its top-right corner — on desktop and mobile alike — to hand
the canvas back to the dungeon.

---

## 🛠️ Built with

- [Three.js](https://threejs.org/) — WebGL rendering
- [Vite](https://vitejs.dev/) — dev server & bundler

No game engine, no physics library, no asset pipeline — the geometry, textures, and post-processing
are all generated in the browser.

> **A note on the Three.js version.** This started life as a single-file prototype pinned to
> Three.js **r128** (loaded from a CDN). It has since been migrated to the latest Three.js as an ES
> module: the color-management API (`outputColorSpace` / color-space constants), MSAA render targets
> (the `samples` option), and the physically-based lighting model (analytic light intensities scaled
> to match the old legacy look) were all updated so the render matches the original pixel-for-pixel.

---

## 📄 License

[MIT](LICENSE) © 2026 [Majid Manzarpour](https://x.com/majidmanzarpour).

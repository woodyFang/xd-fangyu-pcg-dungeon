import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('multi-floor controls keep their DOM and controller contract in sync', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  for (const id of ['vFloor', 'vFloorPrev', 'vFloorNext', 'vFloorTotal', 'floorPrev', 'floorAddNext', 'floorAdd', 'floorNext', 'floorRemove']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(main, new RegExp(`${id}:\\$\\('${id}'\\)`));
  }
  for (const mode of ['current', 'neighbors', 'all', 'explode']) {
    assert.match(html, new RegExp(`data-floor-view=["']${mode}["']`));
  }
  assert.match(main, /querySelectorAll\('\[data-floor-view\]'\)/);
  assert.match(html, /id="floorAddNext"[^>]*>[^<]*新增下一层/);
  assert.match(main, /function addEditorFloorAfterCurrent\(\)/);
  assert.match(main, /roomCountsByFloor\.splice\(inserted,0,inherited\)/);
  assert.match(main, /el\.floorAddNext\.addEventListener\('click', addEditorFloorAfterCurrent\)/);
});

test('the 2D editor starts collapsed and exposes cross-floor movement actions', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  assert.match(html, /class="sec editor-sec collapsed"/);
  assert.match(html, /id="vFloor">第 1 层</);
  assert.match(html, /id="vFloorTotal">共 2 层 · 42 区</);
  assert.match(main, /el\.vFloorPrev\.textContent/);
  assert.match(main, /el\.vFloorNext\.textContent/);
  assert.match(main, /let requestedFloorCount=2;/);
  assert.match(main, /floorCount:2, currentFloor:0/);
  assert.match(html, /data-action="move-floor-up"/);
  assert.match(html, /data-action="move-floor-down"/);
});

test('room count is stored and generated per floor', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  assert.match(html, /本层区域数量/);
  assert.match(html, /id="rooms" min="6" max="50" value="21"/);
  assert.match(main, /let roomCountsByFloor=\[DEFAULT_ROOMS_PER_FLOOR,DEFAULT_ROOMS_PER_FLOOR\]/);
  assert.match(main, /roomCountsByFloor:\[\.\.\.roomCountsByFloor\]/);
  assert.match(main, /roomCountsByFloor:floorRoomCounts/);
  assert.match(main, /layer\.targetRoomCount=targetRoomCounts/);
  assert.match(main, /generatedRoomCountsByFloor:generatedRoomCounts/);
  assert.match(main, /function normalizeFloorRoomCounts/);
  assert.match(main, /const floorRoomRegen/);
});

test('loop rate and decoration density are stored and generated per floor', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  assert.match(html, /本层回环率/);
  assert.match(html, /本层装饰密度/);
  assert.match(html, /class="layer-floor-settings"/);
  assert.match(main, /let loopRatesByFloor=\[DEFAULT_LOOP_RATE,DEFAULT_LOOP_RATE\]/);
  assert.match(main, /let decorDensitiesByFloor=\[DEFAULT_DECOR_DENSITY,DEFAULT_DECOR_DENSITY\]/);
  assert.match(main, /function normalizeFloorTuning/);
  assert.match(main, /loopChancesByFloor:floorLoopChances/);
  assert.match(main, /decorDensitiesByFloor:floorDecorDensities/);
  assert.match(main, /rng\.chance\(loopChanceForEdge\(e\)\)/);
  assert.match(main, /layer\.loopChance=targetLoopChances\[layer\.floor\]/);
  assert.match(main, /layer\.decorDensity=targetDecorDensities\[layer\.floor\]/);
  assert.match(main, /loopRatesByFloor\[editor\.currentFloor\]=/);
  assert.match(main, /decorDensitiesByFloor\[editor\.currentFloor\]=/);
});

test('stair visualization consumes the generated landing and opening contract', async () => {
  const [main, generation] = await Promise.all([
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/generation/multifloor.js', root), 'utf8')
  ]);
  for (const field of ['lowerApproach', 'upperApproach', 'stepCount', 'treadDepth', 'landingDepth', 'openingCells', 'clearVolume']) {
    assert.match(generation, new RegExp(field));
  }
  assert.match(main, /function drawEditorStair/);
  assert.match(main, /connector\.stepCount/);
  assert.match(main, /slabOpening/);
  assert.match(main, /routeHit\.stair/);
});

test('all-floor and exploded views build complete art for every floor', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /function buildSceneLayer\(sourceDungeon, activeFloor/);
  assert.match(main, /floorViewMode==='all' \|\| floorViewMode==='explode'/);
  assert.match(main, /renderedFloorStates\.push\(buildSceneLayer\(sourceDungeon,layer\.floor,\{staticLayer:true,spacing\}\)\)/);
  assert.match(main, /showContextShells:!fullFloorArt/);
  assert.match(main, /const states=renderedFloorStates\.length \? renderedFloorStates/);
  assert.match(main, /if\(!staticLayer\)\{ const spec = TH\.particles/);
  assert.match(main, /if\(!staticLayer\)\{\s*const budget = 12/);
});

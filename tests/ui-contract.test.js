import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('multi-floor controls keep their DOM and controller contract in sync', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  for (const id of ['vFloorTotal', 'floorSelect', 'floorAddNext', 'floorAdd', 'floorRemove']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(main, new RegExp(`${id}:\\$\\('${id}'\\)`));
  }
  for (const mode of ['current', 'neighbors', 'all', 'explode']) {
    assert.match(html, new RegExp(`data-floor-view=["']${mode}["']`));
  }
  assert.match(main, /querySelectorAll\('\[data-floor-view\]'\)/);
  assert.match(html, /id="floorSelect"/);
  assert.match(main, /function syncFloorSelect\(\)/);
  assert.match(main, /el\.floorSelect\.addEventListener\('change'/);
  assert.doesNotMatch(html, /id="floorPrev"|id="floorNext"|id="vFloor"/);
  assert.match(html, /id="floorAddNext"[^>]*>[^<]*下一层/);
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
  assert.match(html, /id="vFloorTotal">共 2 层 · 42 区</);
  assert.match(html, /id="floorSelect"/);
  assert.match(main, /let requestedFloorCount=2;/);
  assert.match(main, /floorCount:2, currentFloor:0/);
  assert.match(html, /data-action="move-floor-up"/);
  assert.match(html, /data-action="move-floor-down"/);
});

test('advanced display switches stay internal and have no visible UI', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.doesNotMatch(html, /生成动画|后期特效|结构叠加|强度热力图/);
  for (const id of ['tAnim', 'tPost', 'tGraph', 'tHeat']) {
    assert.match(html, new RegExp(`<input[^>]*id=["']${id}["'][^>]*hidden`));
  }
});

test('the main control panel keeps high-frequency controls in compact rows', async () => {
  const styles = await readFile(new URL('src/ui/styles.css', root), 'utf8');
  assert.match(styles, /\.hero-controls\{[^}]*grid-template-columns:minmax\(0,1fr\) 88px/);
  assert.match(styles, /\.setting-choice-row\{[^}]*grid-template-columns:minmax\(0,1fr\) 70px/);
  assert.match(styles, /\.layer-count-buttons\{[^}]*repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.layer-view-buttons\{[^}]*repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /\.room-group-empty\{[^}]*min-height:34px/);
});

test('setting and palette controls use explicit non-repeating random actions without auto choices', async () => {
  const [html, main, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/ui/styles.css', root), 'utf8')
  ]);
  assert.match(html, /id="settingRandom"/);
  assert.match(html, /id="paletteRandom"/);
  assert.match(html, />↻ 随机</);
  assert.doesNotMatch(html, /data-[sp]="auto"/);
  assert.match(main, /settingRandom:\$\('settingRandom'\)/);
  assert.match(main, /paletteRandom:\$\('paletteRandom'\)/);
  assert.match(main, /let settingSel = 'dungeon', paletteSel = 'ancient'/);
  assert.match(main, /function randomizeSetting\(\)/);
  assert.match(main, /function randomizePalette\(\)/);
  assert.match(main, /const pool=palettePoolForSetting\(settingKey\)/);
  assert.match(main, /const candidates=pool\.filter\(key=>key!==current\)/);
  assert.match(main, /setPaletteSel\(next\);\s*return next/);
  assert.match(main, /el\.settingRandom\.addEventListener\('click', randomizeSetting\)/);
  assert.match(main, /el\.paletteRandom\.addEventListener\('click', randomizePalette\)/);
  assert.match(styles, /\.chips\.palette\{[^}]*flex-wrap:nowrap[^}]*overflow-x:auto/);
  assert.match(styles, /\.chips\.palette \.chip\{[^}]*flex:0 0 auto/);
});

test('custom setting groups support a named prompt-or-reference workflow', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  assert.match(html, /id="customSettingChips"/);
  assert.match(html, /id="settingAdd"[^>]*>＋ 自定义/);
  for (const id of ['customSettingDialog', 'customSettingForm', 'customSettingName', 'customSettingPrompt', 'customSettingImage', 'customSettingImagePreview', 'customSettingDelete']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(main, new RegExp(`${id}:\\$\\('${id}'\\)`));
  }
  assert.doesNotMatch(html, /id="customSettingBase"|美术模板|遗迹模板|医院模板/);
  assert.doesNotMatch(main, /customSettingBase|SETTINGS\[record\.baseKey\]/);
  assert.match(main, /kit:'custom'/);
  assert.match(main, /if\('baseKey' in record\)\{ delete record\.baseKey; migrated=true; \}/);
  assert.match(html, /提示词或参考图至少填写一项/);
  assert.match(main, /const CUSTOM_SETTING_STORAGE='dungeon\.customSettings\.v1'/);
  assert.match(main, /function installCustomSetting\(record\)/);
  assert.match(main, /function renderCustomSettings\(\)/);
  assert.match(main, /function openCustomSettingDialog\(id=null\)/);
  assert.match(main, /function saveCustomSettingFromForm\(\)/);
  assert.match(main, /if\(!prompt && !customSettingDraftImage\?\.data\)/);
  assert.match(main, /function fileToReferenceImage\(file\)/);
  assert.match(main, /function deleteCustomSetting\(id\)/);
  assert.match(main, /localStorage\.setItem\(CUSTOM_SETTING_STORAGE,JSON\.stringify\(customSettings\)\)/);
  assert.match(main, /delete SETTINGS\[key\]/);
  assert.match(main, /el\.settingAdd\.addEventListener\('click',\(\)=>openCustomSettingDialog\(\)\)/);
  assert.match(main, /el\.customSettingForm\.addEventListener\('submit'/);
});

test('room groups are reusable definitions with prompt, image, and room assignment UI', async () => {
  const [html, main, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/ui/styles.css', root), 'utf8')
  ]);
  for (const id of ['roomGroupAdd', 'roomGroupList', 'roomGroupDialog', 'roomGroupName', 'roomGroupPrompt', 'roomGroupImage', 'roomGroupSelect', 'roomGroupAssignDialog']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
    assert.match(main, new RegExp(`${id}:\\$\\('${id}'\\)`));
  }
  assert.match(html, /data-action="assign-room-group"/);
  assert.match(main, /const ROOM_GROUP_STORAGE='dungeon\.roomGroups\.v1'/);
  assert.match(main, /function openRoomGroupDialog\(id=null\)/);
  assert.match(main, /function assignRoomGroup\(room,id\)/);
  assert.match(main, /roomGroupId:roomGroupId \|\| null/);
  assert.match(main, /roomGroups:roomGroups\.map\(group=>\(\{\.\.\.group\}\)\)/);
  assert.match(styles, /\.room-inspector\{/);
  assert.match(styles, /\.room-group-dialog\{/);
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
  assert.match(main, /function beginStableFloorEdit\(floor\)/);
  assert.match(main, /function resizeEditorFloorRooms\(floor,targetCount\)/);
  assert.match(main, /resizeEditorFloorRooms\(floor,roomCountsByFloor\[floor\]\)/);
  assert.match(main, /function generateWithFloorAlignment\(params,activeFloor\)/);
  assert.match(main, /translateFloorLayout\(params\.editorRooms,params\.editorLinks,activeFloor/);
  assert.match(main, /preserveUneditedFloors\(previousDungeon,d,editedFloors\)/);
});

test('loop rate and decoration density are stored and generated per floor', async () => {
  const [html, main, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/ui/styles.css', root), 'utf8')
  ]);
  assert.match(html, /本层回环率/);
  assert.match(html, /本层装饰密度/);
  assert.match(html, /class="layer-floor-settings"/);
  assert.match(styles, /\.layer-floor-settings\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*width:100%/);
  assert.match(main, /let loopRatesByFloor=\[DEFAULT_LOOP_RATE,DEFAULT_LOOP_RATE\]/);
  assert.match(main, /let decorDensitiesByFloor=\[DEFAULT_DECOR_DENSITY,DEFAULT_DECOR_DENSITY\]/);
  assert.match(main, /function normalizeFloorTuning/);
  assert.match(main, /loopChancesByFloor:floorLoopChances/);
  assert.match(main, /decorDensitiesByFloor:floorDecorDensities/);
  assert.match(main, /rng\.chance\(loopChanceForEdge\(e\)\)/);
  assert.match(main, /layer\.loopChance=targetLoopChances\[layer\.floor\]/);
  assert.match(main, /layer\.decorDensity=targetDecorDensities\[layer\.floor\]/);
  assert.match(main, /loopRatesByFloor=updateFloorValue\(loopRatesByFloor,floor/);
  assert.match(main, /decorDensitiesByFloor=updateFloorValue\(decorDensitiesByFloor,floor/);
  assert.doesNotMatch(main, /loopRatesByFloor=d\.loopChancesByFloor|decorDensitiesByFloor=d\.decorDensitiesByFloor/);
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
  assert.match(main, /const EXPLODED_FLOOR_SPACING = 3\.2/);
  assert.match(main, /const spacing=floorViewMode==='explode'\?EXPLODED_FLOOR_SPACING:1/);
  assert.match(main, /if\(exploded\)\{/);
  assert.match(main, /new THREE\.CylinderGeometry\(\.16,\.16,1,10,1,true\)/);
  assert.match(main, /transparent:true,opacity:\.34,depthWrite:false/);
  assert.match(main, /link\.quaternion\.setFromUnitVectors\(_Y,direction\.normalize\(\)\)/);
});

test('translucent context floors use a distinct blue material', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /const ghostFloorColor=0x3f91d8/);
  assert.match(main, /const ghostWallColor=0x286aa8/);
  assert.match(main, /color:solidContext\?TH\.floor:ghostFloorColor/);
  assert.match(main, /color:solidContext\?TH\.wall:ghostWallColor/);
  assert.match(main, /emissive:solidContext\?0x000000:ghostEmissive/);
});

test('solid context floors cannot black out the active floor', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /function disableContextFloorShadowCasting\(root\)/);
  assert.match(main, /if\(staticLayer\) disableContextFloorShadowCasting\(group\)/);
  assert.match(main, /if\(!keys\.length && !chosen\.length\)/);
  assert.match(main, /steady:true/);
  assert.match(main, /const flicker = L\.userData\.steady \? 1/);
});

test('floor and visibility-range selection preserve the exact camera pose', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /function rebuildScenePreservingCamera\(sourceDungeon\)/);
  assert.match(main, /position:cam\.position\.clone\(\)/);
  assert.match(main, /quaternion:cam\.quaternion\.clone\(\)/);
  assert.match(main, /target:camTarget\.clone\(\)/);
  assert.match(main, /buildScene\(sourceDungeon,false,false\)/);
  assert.match(main, /camTarget\.copy\(pose\.target\)/);
  assert.match(main, /cam\.position\.copy\(pose\.position\)/);
  assert.match(main, /cam\.quaternion\.copy\(pose\.quaternion\)/);
  assert.match(main, /function setEditorFloor[\s\S]*?rebuildScenePreservingCamera\(D\)/);
  assert.match(main, /floorViewMode=button\.dataset\.floorView;[\s\S]*?rebuildScenePreservingCamera\(D\)/);
  assert.doesNotMatch(main, /buildScene\(D,false,true\)/);
});

test('edited routes remain adaptive when rooms move or regenerate', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /import \{ adaptRouteBends \} from '.\/generation\/adaptive-route\.js'/);
  assert.match(main, /const hasCustomRoute = Array\.isArray\(editorLink\.bends\) && editorLink\.bends\.length > 0/);
  assert.match(main, /e\.hasCustomDoorA = !!editorLink\.doorA/);
  assert.match(main, /function captureAdaptiveRoutes\(roomId=null\)/);
  assert.match(main, /function applyAdaptiveRoutes\(snapshots\)/);
  assert.match(main, /routeSnapshots:captureAdaptiveRoutes\(h\.room\.id\)/);
  assert.match(main, /if\(editor\.drag\.room\) applyAdaptiveRoutes\(editor\.drag\.routeSnapshots\)/);
  assert.match(main, /syncEditorGeneratedRooms\(d\);\s*applyAdaptiveRoutes\(adaptiveRouteSnapshots\);/);
});

test('only doors snap to rooms while route controls snap orthogonally to controls', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /function editorControlSnapTargetPoints\(excluded=\[\]\)/);
  assert.doesNotMatch(main, /function editorSnapTargetPoints/);
  assert.match(main, /snapRouteControlPoint\(p,editorControlSnapTargetPoints\(excluded\)/);
  assert.match(main, /if\(b\)\{ const sp=snapEditorControlPoint\(p,\[b\]\)/);
  assert.match(main, /const spec=pointToDoorSpec\(room,p\);\s*const sp=doorSpecPoint\(room,spec\)/);
  assert.match(main, /snapTargets:editorControlSnapTargetPoints\(movedPoints\)/);
  assert.match(main, /if\(!target \|\| target\.id===current\)/);
});

test('dragging an endpoint segment slides its door without adding a root bend', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /function routeDoorSpecOnSide\(room, point, side\)/);
  assert.match(main, /function setRouteDoorOnSide\(link, which, point, side\)/);
  assert.match(main, /function routeDoorAxisRange\(room,side\)/);
  assert.match(main, /const da=setRouteDoorOnSide\(l,'a',inner\[0\],sideA\)/);
  assert.match(main, /const db=setRouteDoorOnSide\(l,'b',inner\[1\],sideB\)/);
  assert.match(main, /const route=simplifyRoutePoints\(inner\)/);
  assert.match(main, /l\.bends = route\.slice\(1,-1\)/);
  assert.doesNotMatch(main, /bends\.unshift\(inner\[0\]\)|bends\.push\(inner\[inner\.length-1\]\)/);
});

test('stored route controls contain only real direction changes', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /import \{ simplifyRoutePoints \} from '.\/ui\/route-path\.js'/);
  assert.match(main, /function normalizeLinkBends\(l,/);
  assert.match(main, /const route=simplifyRoutePoints\(\[da,\.\.\.l\.bends,db\]\)/);
  assert.match(main, /return simplifyRoutePoints\(out\)/);
  assert.match(main, /if\(l && Array\.isArray\(l\.bends\)\) normalizeLinkBends\(l\)/);
});

test('the editor, route preview, and 3D layer use one coordinate space', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  assert.match(main, /const layerShift=dungeonLayerShift\(sourceDungeon\)/);
  assert.match(main, /group\.position\.set\(layerShift\.x,activeFloor/);
  assert.match(main, /const off = corridorCenterOffset\(linkDispWidth\(l\)\)/);
  assert.match(main, /const centerOffset=corridorCenterOffset\(bandWidth\)/);
  assert.match(main, /const offset=dungeonEditorOffset\(D\)/);
  assert.match(main, /const q=editorToGridPoint\(D,p\)/);
  assert.doesNotMatch(main, /linkDispWidth\(l\)===2 \? 1 : 0\.5/);
});

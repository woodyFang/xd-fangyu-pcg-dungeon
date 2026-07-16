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

test('build animation is a presentation-only staged reveal', async () => {
  const [html, main] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8')
  ]);
  for (const stage of ['layout', 'graph', 'structure', 'rooms', 'atmosphere']) {
    assert.match(html, new RegExp(`data-stage=["']${stage}["']`));
  }
  assert.match(main, /function createBuildTimeline\(depthSpan\)/);
  assert.match(main, /function configureRevealSchedules\(sceneMeshes,timeline\)/);
  assert.match(main, /function instanceRevealProgress\(u, s, i, t\)/);
  assert.match(main, /function finishAnim\(\)[\s\S]*settleAll\(\)/);
  assert.doesNotMatch(main, /animT\s*-\s*2\.3/);
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
  assert.match(main, /const authority=compileThemeAuthority\(t,SETTINGS\[t\] \|\| SETTINGS\.dungeon\)/);
  assert.match(main, /setPaletteSel\(resolveThemePaletteKey\(authority,paletteSel\)\)/);
  assert.match(main, /ch\.hidden=!compatible/);
  assert.match(main, /const order = palettePoolForSetting\(resolveSetting\(\)\)/);
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
  assert.doesNotMatch(main, /translateFloorLayout\(/);
  assert.match(main, /Never translate an entire floor behind their back/);
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
  const [main, generation, stairStyle, stairAssets] = await Promise.all([
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/generation/multifloor.js', root), 'utf8'),
    readFile(new URL('src/render/stair-style.js', root), 'utf8'),
    readFile(new URL('src/render/stair-assets.js', root), 'utf8')
  ]);
  for (const field of ['lowerApproach', 'upperApproach', 'turn', 'secondDirection', 'firstFlightSteps', 'secondFlightSteps', 'stepCount', 'treadDepth', 'landingDepth', 'stairFootprintCells', 'headroomCells', 'openingCells', 'openingBoundaryEdges', 'openingAccessEdges', 'openingGuardSegments', 'sharedFootprintCells', 'sharedFootprintKind', 'clearVolume']) {
    assert.match(generation, new RegExp(field));
  }
  assert.match(main, /function drawEditorStair/);
  assert.match(main, /connector\.stepCount/);
  assert.match(main, /if\(connector\.turn\)/);
  assert.match(main, /stairEditorSegments\(l\.stair\)/);
  assert.match(main, /slabOpening/);
  assert.match(main, /routeHit\.stair/);
  assert.match(main, /const stairKitBase=compileStairAssetRecipe\(TH,\{seed:dungeon\.seed\}\)/);
  assert.match(main, /const stairKit=compileStairAssetRecipe\(TH,\{seed:dungeon\.seed,connectorId:connector\.id\}\)/);
  assert.match(main, /stairTreadAssetPlan\(stairKit/);
  assert.match(main, /addProceduralStairLandingFrame\(/);
  assert.match(main, /stairKitBase\.material\.body/);
  assert.match(main, /stairKitBase\.material\.rail/);
  assert.match(main, /stairKitBase\.markingColor/);
  assert.match(main, /function addThemedStairRails\(/);
  assert.match(main, /function addThemedOpeningRails\(/);
  assert.doesNotMatch(main, /function addStairParapetSegment\(/);
  assert.match(main, /kit\.rail\.postStyle\?\.startsWith\('stone-'\)/);
  assert.match(main, /if\(kit\.landing\.edgeFrame===false\) return/);
  assert.match(main, /stairRailSegments\(connector,totalRise,lowerY,offset\)/);
  assert.match(main, /new THREE\.Mesh\(landingGeo,stairLandingMat\)/);
  assert.match(main, /turnLanding\.scale\.set\(turnPlatform\.visualSpan,1,turnPlatform\.visualSpan\)/);
  assert.match(main, /platform\.visualSpan\*editor\.scale/);
  assert.match(main, /stairLandingMat/);
  assert.match(stairStyle, /first-flight-inner/);
  assert.match(stairStyle, /turn-platform-outer-first/);
  assert.match(stairStyle, /turn-platform-outer-second/);
  assert.match(main, /stairKit\.edgeMarking/);
  assert.match(stairAssets, /id:'ruin-underground-palace'/);
  assert.match(stairAssets, /archetype:'subterranean-palace'/);
  assert.match(stairAssets, /infillStyle:'open-balusters'/);
  assert.match(stairAssets, /postStyle:'stone-baluster'/);
  assert.match(stairAssets, /id:'hospital-metal'/);
  assert.match(stairAssets, /id:'custom-neutral'/);
  assert.doesNotMatch(main, /lowerY\+totalRise\+\.28/);
});

test('the editor places stairs directly in rooms and rotates them by 90 degrees', async () => {
  const [html, main, styles] = await Promise.all([
    readFile(new URL('index.html', root), 'utf8'),
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/ui/styles.css', root), 'utf8')
  ]);
  assert.match(html, /id="editorAddStair"[^>]*>＋ 楼梯</);
  assert.match(html, /data-action="add-stair" data-menu="room">添加楼梯</);
  assert.doesNotMatch(html, /data-action="add-stair-up"|data-action="add-stair-down"/);
  assert.match(html, /id="editorStairCycle"[^>]*hidden>旋转 90°</);
  assert.match(html, /id="editorStairStyle"[^>]*aria-label="楼梯样式"[^>]*hidden/);
  assert.match(html, /value="" disabled>楼梯样式<\/option><option value="l-turn">L 型楼梯<\/option><option value="straight">直跑楼梯/);
  assert.match(html, /data-action="rotate-stair"[^>]*>旋转楼梯 90°</);
  assert.match(html, /id="editorStairConfirm"/);
  assert.match(html, /data-action="delete-stair"/);
  assert.match(main, /editorAddStair:\$\('editorAddStair'\)/);
  assert.match(main, /editorStairStyle:\$\('editorStairStyle'\)/);
  assert.match(main, /el\.editorStairStyle\.hidden=!overlayOn\(\) && !\(preview \|\| stair\)/);
  assert.match(main, /function beginAddStair\(source=null,preferredDelta=1,point=null\)/);
  assert.match(main, /editor\.tool='stair-place'/);
  assert.match(main, /function placeDirectStair\(room,point,preferredDelta=1\)/);
  assert.match(main, /directStairPlacement\(point,editor\.stairPlacementStyle,8\)/);
  assert.match(main, /action==='add-stair'/);
  assert.match(main, /添加楼梯至第 \$\{targetFloor\+1\} 层/);
  assert.match(main, /function completeAddStair\(target,\{draftSnapshot=null,placement=null\}=\{\}\)/);
  assert.match(main, /kind:'stairs',stairId:stair\.id/);
  assert.match(main, /editor\.stairs\.push\(stair\)/);
  assert.match(main, /editor\.tool='stair-preview'/);
  assert.match(main, /function confirmStairPreview\(\)/);
  assert.match(main, /function rotateSelectedStair90\(\)/);
  assert.match(main, /rotateStairPlacement90\(stair,link\?\.stair\)/);
  assert.match(main, /adaptRoomToRotatedStair\(room,stair,rotated\)/);
  assert.match(main, /applyAdaptiveRoutes\(routeSnapshots\)/);
  assert.match(main, /function stairRotationHandle\(stair\)/);
  assert.match(main, /kind:'stairRotate'/);
  assert.match(main, /mode:'stairRotate'/);
  assert.match(main, /stairRotationFromPointer\(drag\.stairStart,drag\.visualStart,p\)/);
  assert.match(main, /stairVisualForRotation\(drag\.visualStart,drag\.stair,rotated\)/);
  assert.match(main, /g\.fillText\('↻',handle\.x,handle\.y\+\.5\)/);
  assert.match(main, /function setSelectedStairStyle\(requestedStyle\)/);
  assert.match(main, /changeStairStyle\(stair,link\?\.stair,requestedStyle\)/);
  assert.match(main, /function stairWidthHandle\(stair\)/);
  assert.match(main, /function stairWidthHandleGlyph\(\)/);
  assert.match(main, /function stairWidthHandleGlyph\(\)[\s\S]*?return '↔'/);
  assert.doesNotMatch(main, /stairWidthHandleAxis/);
  assert.match(main, /kind:'stairWidth'/);
  assert.match(main, /mode:'stairWidth'/);
  assert.match(main, /stairWidthResizeFromPointer\(drag\.stairStart,drag\.visualStart,p,\{startPointer:drag\.start\}\)/);
  assert.match(main, /drag\.stair\.previewLateralCenterOffset=lateralCenterOffset/);
  assert.match(main, /lateralCenterOffset:connector\.lateralCenterOffset/);
  assert.match(main, /0\.25 步进/);
  assert.match(main, /g\.fillText\(stairWidthHandleGlyph\(\),handle\.x,handle\.y\+\.5\)/);
  assert.match(main, /style:stair\.previewStyle \|\| stair\.style \|\| 'l-turn'/);
  assert.match(styles, /\.editor-stair-style\{/);
  assert.doesNotMatch(main, /function cycleStairCandidate\(\)/);
  assert.match(main, /beginAddStair\(stairHit\.room,1,p\)/);
  assert.doesNotMatch(main, /editor\.tool==='stair-target'/);
  assert.doesNotMatch(main, /stair-source/);
  assert.match(main, /cancelAddStair\(\{returnToSource:true\}\)/);
  assert.match(main, /function targetRoomForDirectStair\(source,targetFloor,point\)/);
  assert.match(main, /editor\.rooms\.push\(target\)/);
  assert.match(main, /stairRoom:true,stairRoomPairId:pairId/);
  assert.match(main, /manualPreview:direct/);
  assert.match(main, /stair:previewVisual/);
  assert.match(main, /点击房间内的位置直接放置/);
  assert.doesNotMatch(main, /function openEditorPrompt\(/);
  assert.doesNotMatch(main, /matchingStairRooms\(/);
  assert.doesNotMatch(main, /pairedStairRoomPlacement\(/);
  assert.match(main, /跨层连接请使用顶部“＋ 楼梯”/);
  assert.match(styles, /\.mini-btn\.editor-stair-btn\.on/);
});

test('stair context controls stay inside the stair menu scope', async () => {
  const main = await readFile(new URL('src/main.js', root), 'utf8');
  const stairMenu = main.match(/function showEditorLinkMenu\(e, kind, ctx\)\{([\s\S]*?)\n\}/)?.[1] || '';
  const roomGroups = main.match(/function initRoomGroups\(\)\{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(stairMenu, /if\(kind==='stair'\)/);
  assert.match(stairMenu, /editorStairForLink\(ctx\.link\)/);
  assert.doesNotMatch(roomGroups, /\bkind\b|\bctx\.link\b/);
});

test('stairs are stable independent editor objects with locking and conflict feedback', async () => {
  const [main,generation] = await Promise.all([
    readFile(new URL('src/main.js', root), 'utf8'),
    readFile(new URL('src/generation/multifloor.js', root), 'utf8')
  ]);
  assert.match(main, /stairs:\[\]/);
  assert.match(main, /function editorStairForLink\(link\)/);
  assert.match(main, /function stairSpecForGenerator\(link\)/);
  assert.match(main, /mode:'stable-auto'/);
  assert.match(main, /mode='locked'/);
  assert.match(main, /mode:'stairMove'/);
  assert.match(main, /function captureAttachedStairPlacements\(roomId\)/);
  assert.match(main, /moveAttachedStairPlacements\(editor\.drag\.stairPlacements/);
  assert.match(main, /function deleteEditorStair\(link\)/);
  assert.match(main, /stairRemovalDisconnectsRooms/);
  assert.match(main, /关键楼梯/);
  assert.match(main, /stairFailure/);
  assert.match(main, /failureByStair/);
  assert.match(main, /stair\.invalid=!!failure/);
  assert.match(main, /Keep the editor overlay and rendered dungeon atomic/);
  assert.match(main, /restoreEditorState\(lastValidEditorState\)/);
  assert.doesNotMatch(main, /translateFloorLayout\(/);
  assert.match(generation, /const hasStableAnchor/);
  assert.match(generation, /candidateIndex/);
  assert.match(generation, /stairSpec\?\.anchor/);
  assert.match(generation, /function roomAccessCell/);
  assert.match(generation, /buildStructureAdaptationRoutes/);
  assert.match(generation, /allowStructureAdaptation/);
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
  assert.match(main, /routeSnapshots:captureAdaptiveRoutes\(pairedRoom\?null:h\.room\.id\)/);
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

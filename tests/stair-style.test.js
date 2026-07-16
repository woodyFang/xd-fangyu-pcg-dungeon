import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileStairAssetRecipe,
  railPostFractions,
  resolveStairKit,
  stairGridSpan,
  stairLandingCenterY,
  stairLateralCenterOffset,
  stairRailRuns,
  stairRailSegments,
  stairColorContrast,
  stairRunCenter,
  stairTreadAssetPlan,
  stairTurnPlatformMetrics
} from '../src/render/stair-style.js';

test('stair art kits are distinct for ruin, hospital, and custom themes', () => {
  const ruin=resolveStairKit({kit:'dungeon',cap:0x111111,floor:0x222222,wall:0x333333,accent:'#ffaa00'});
  const hospital=resolveStairKit({kit:'hospital',cap:0xaaaaaa,floor:0xbbbbbb,corridor:0xcccccc,accent:'#00ffaa'});
  const custom=resolveStairKit({kit:'custom',cap:0x444444,floor:0x555555,corridor:0x666666,accent:'#8866ff'});
  assert.equal(ruin.id,'ruin-underground-palace');
  assert.equal(ruin.archetype,'subterranean-palace');
  assert.equal(ruin.railProfile,'square');
  assert.equal(ruin.rail.infillStyle,'open-balusters');
  assert.equal(ruin.rail.postStyle,'stone-baluster');
  assert.equal(ruin.landing.edgeFrame,false);
  assert.equal(ruin.landing.centerPanel,false);
  assert.ok(ruin.postSpacing<1);
  assert.equal(typeof ruin.treadColor,'number');
  assert.notEqual(ruin.treadColor,ruin.treadCapColor);
  assert.equal(hospital.id,'hospital-metal');
  assert.equal(hospital.railProfile,'round');
  assert.equal(hospital.edgeMarking,true);
  assert.equal(custom.id,'custom-neutral');
  assert.equal(custom.fallback,true);
  assert.equal(custom.themeAccentColor,0x8866ff);
  assert.ok(stairColorContrast(custom.markingColor,custom.treadColor)>=2.4);
});

test('every theme kit and built-in palette derives readable colors for every stair material role', () => {
  const palettes=[
    {paletteKey:'ancient',floor:0x8a8f9c,corridor:0x6d7380,wall:0x5c626e,cap:0x757b88,accent:'#e8973f'},
    {paletteKey:'molten',floor:0x7a685c,corridor:0x614f44,wall:0x503e34,cap:0x6b5546,accent:'#ff8642'},
    {paletteKey:'frost',floor:0x93a0b2,corridor:0x78848f,wall:0x60708a,cap:0x8194ac,accent:'#7fd4ff'},
    {paletteKey:'grim',floor:0x7c8276,corridor:0x62685c,wall:0x4f5549,cap:0x666c5e,accent:'#9fe66a'},
    {paletteKey:'verdant',floor:0x848e7e,corridor:0x6a7560,wall:0x556050,cap:0x6e7a66,accent:'#59d68f'},
    {paletteKey:'sterile',floor:0x6f7975,corridor:0x626d69,wall:0x56615d,cap:0x78837f,accent:'#5fd1c7'},
    {paletteKey:'abandoned',floor:0x687067,corridor:0x5c655d,wall:0x515951,cap:0x737b72,accent:'#79b65f'},
    {paletteKey:'emergency',floor:0x6f6868,corridor:0x625c5c,wall:0x5a5050,cap:0x7c7371,accent:'#ff5b4f'}
  ];
  const signatures=new Set();
  for(const kit of ['dungeon','hospital','custom']){
    for(const palette of palettes){
      const recipe=compileStairAssetRecipe({...palette,kit});
      const roles=['treadColor','treadCapColor','landingColor','railColor','markingColor'];
      for(const role of roles) assert.ok(Number.isInteger(recipe[role]) && recipe[role]>=0 && recipe[role]<=0xffffff);
      assert.ok(stairColorContrast(recipe.treadCapColor,recipe.treadColor)>=1.16);
      assert.ok(stairColorContrast(recipe.railColor,recipe.landingColor)>=1.35);
      assert.ok(stairColorContrast(recipe.markingColor,recipe.treadColor)>=2.4);
      signatures.add(roles.map(role=>recipe[role]).join(','));
    }
  }
  assert.equal(signatures.size,palettes.length*3);
});

test('clinical stairs keep concrete surfaces non-metallic and rails metallic', () => {
  const recipe=compileStairAssetRecipe({
    kit:'hospital',floor:0x6f7975,corridor:0x626d69,wall:0x56615d,cap:0x78837f,accent:'#5fd1c7'
  });
  assert.ok(recipe.material.body.metalness<.1);
  assert.ok(recipe.material.landing.metalness<.1);
  assert.ok(recipe.material.rail.metalness>.7);
  assert.ok(recipe.material.rail.roughness<recipe.material.body.roughness);
});

test('theme compiles into a procedural shape recipe without structural authority', () => {
  const industrial=compileStairAssetRecipe({
    kit:'custom',settingLabel:'深海工业站',themePrompt:'钢铁管道、机械平台与冷色警示灯',
    floor:0x334455,corridor:0x445566,cap:0x778899,accent:'#44ddff'
  },{seed:42,connectorId:'stair-7'});
  assert.equal(industrial.id,'custom-industrial');
  assert.equal(industrial.procedural,true);
  assert.equal(industrial.affectsStructure,false);
  assert.equal(industrial.structure,'metal');
  assert.equal(industrial.tread.profile,'metal-plate');
  assert.equal(industrial.rail.profile,'round');
  assert.equal(industrial.landing.accentBorder,true);
});

test('procedural stair assets are deterministic and stay inside the contract width', () => {
  const recipe=compileStairAssetRecipe({kit:'dungeon',cap:0x111111,floor:0x222222,wall:0x333333},
    {seed:123,connectorId:'connector-a'});
  const again=compileStairAssetRecipe({kit:'dungeon',cap:0x111111,floor:0x222222,wall:0x333333},
    {seed:123,connectorId:'connector-a'});
  const other=compileStairAssetRecipe({kit:'dungeon',cap:0x111111,floor:0x222222,wall:0x333333},
    {seed:123,connectorId:'connector-b'});
  const plan=stairTreadAssetPlan(recipe,3,2.25,.35);
  assert.equal(recipe.variantSeed,again.variantSeed);
  assert.notEqual(recipe.variantSeed,other.variantSeed);
  assert.ok(plan.capWidth<=2.25);
  assert.ok(Math.abs(plan.lateralOffset)+plan.capWidth/2<=2.25/2+1e-9);
  assert.ok(plan.capDepth<=.35*1.2+1e-9);
});

test('L stair rail runs follow both flight slopes and landing elevations', () => {
  const connector={
    lower:{x:0,y:0},turn:{x:4,y:0},upper:{x:4,y:4},
    lowerApproach:{x:-2,y:0},upperApproach:{x:4,y:6},
    stepCount:16,firstFlightSteps:8
  };
  const runs=stairRailRuns(connector,4,10);
  assert.deepEqual(runs.map(run=>run.kind),['first-flight','second-flight']);
  assert.deepEqual(runs.map(run=>[run.start.y,run.end.y]),[[10,12],[12,14]]);
});

test('straight stair rails rise from the lower floor instead of floating at the top', () => {
  const runs=stairRailRuns({lower:{x:2,y:3},upper:{x:10,y:3},stepCount:16},4,0);
  assert.deepEqual(runs,[{kind:'flight',start:{x:2,y:0,z:3},end:{x:10,y:4,z:3}}]);
  assert.deepEqual(railPostFractions(runs[0],2),[0,0.25,0.5,0.75,1]);
});

test('turn platform separates exact visual width from conservative raster occupancy', () => {
  const connector={
    width:2,lower:{x:6,y:20},turn:{x:10,y:20},upper:{x:10,y:24},firstRun:4,secondRun:4,
    directionVector:{x:1,y:0},secondDirectionVector:{x:0,y:1}
  };
  assert.equal(stairGridSpan(2),2);
  assert.equal(stairGridSpan(2.25),3);
  assert.equal(stairLateralCenterOffset(2),.5);
  assert.equal(stairLateralCenterOffset(3),0);
  assert.deepEqual(stairRunCenter({x:4,y:6},{x:1,y:0},2),{x:4,y:6.5});
  const platform=stairTurnPlatformMetrics(connector);
  assert.deepEqual(platform.center,{x:11,y:20.5});
  assert.deepEqual(platform.entry,{x:10,y:20.5});
  assert.deepEqual(platform.exit,{x:11,y:21.5});
  assert.deepEqual(platform.first,{start:{x:6,y:20.5},end:{x:10,y:20.5},direction:{x:1,y:0},length:4});
  assert.deepEqual(platform.second,{start:{x:11,y:21.5},end:{x:11,y:25.5},direction:{x:0,y:1},length:4});
  assert.equal(platform.visualSpan,2);
  assert.equal(platform.gridSpan,2);
  assert.equal(platform.offset,.5);
  const fractional=stairTurnPlatformMetrics({...connector,width:2.25});
  assert.deepEqual(fractional.center,{x:11.125,y:20});
  assert.deepEqual(fractional.exit,{x:11.125,y:21.125});
  assert.equal(fractional.visualSpan,2.25);
  assert.equal(fractional.gridSpan,3);
  assert.equal(fractional.offset,0);
});

test('edited stair width shifts its center so the opposite edge stays fixed', () => {
  const start=stairRunCenter({x:4,y:6},{x:1,y:0},2,.5);
  const widened=stairRunCenter({x:4,y:6},{x:1,y:0},2.25,.625);
  assert.deepEqual(start,{x:4,y:6.5});
  assert.deepEqual(widened,{x:4,y:6.625});
  assert.equal(start.y-2/2,widened.y-2.25/2);
  const platform=stairTurnPlatformMetrics({
    width:2.25,lateralCenterOffset:.625,lower:{x:6,y:20},turn:{x:10,y:20},upper:{x:10,y:24},firstRun:4,secondRun:4,
    directionVector:{x:1,y:0},secondDirectionVector:{x:0,y:1}
  });
  assert.deepEqual(platform.center,{x:11.125,y:20.625});
  assert.deepEqual(platform.entry,{x:10,y:20.625});
  assert.deepEqual(platform.exit,{x:11.125,y:21.75});
  assert.equal(platform.visualSpan,2.25);
  assert.equal(platform.gridSpan,3);
  assert.equal(platform.offset,.625);
});

test('landing box center keeps its top surface aligned with the adjoining tread', () => {
  const surfaceY=12;
  const centerY=stairLandingCenterY(surfaceY,.16,.01);
  assert.equal(centerY,11.93);
  assert.ok(Math.abs(centerY+.08-(surfaceY+.01))<1e-9);
});

test('upper and lower approaches do not create extra platform rail runs', () => {
  const runs=stairRailRuns({
    width:2,lower:{x:0,y:0},upper:{x:8,y:0},
    lowerApproach:{x:-2,y:0},upperApproach:{x:10,y:0}
  },4,0);
  assert.deepEqual(runs.map(run=>run.kind),['flight']);
});

test('even-width rail runs follow the same shifted centerlines as the stair flights', () => {
  const connector={
    width:2,lower:{x:0,y:0},turn:{x:4,y:0},upper:{x:4,y:4},
    stepCount:16,firstFlightSteps:8
  };
  const runs=stairRailRuns(connector,4,0);
  assert.deepEqual(runs[0],{
    kind:'first-flight',start:{x:0,y:0,z:.5},end:{x:4,y:2,z:.5}
  });
  assert.deepEqual(runs[1],{
    kind:'second-flight',start:{x:5,y:2,z:1.5},end:{x:5,y:4,z:5.5}
  });
});

test('L stair flights stop at opposite landing edges instead of crossing its interior', () => {
  const platform=stairTurnPlatformMetrics({
    width:3,lower:{x:0,y:0},turn:{x:4,y:0},upper:{x:4,y:4},
    firstRun:4,secondRun:4,directionVector:{x:1,y:0},secondDirectionVector:{x:0,y:1}
  });
  const half=platform.visualSpan/2;
  assert.equal(platform.entry.x,platform.center.x-half);
  assert.equal(platform.entry.y,platform.center.y);
  assert.equal(platform.exit.x,platform.center.x);
  assert.equal(platform.exit.y,platform.center.y+half);
  assert.notDeepEqual(platform.entry,platform.exit);
  assert.equal(platform.first.end.x,platform.entry.x);
  assert.equal(platform.second.start.y,platform.exit.y);
});

test('L stair rails wrap the outer platform and meet at the exact inner corner', () => {
  const connector={
    width:2,lower:{x:0,y:0},turn:{x:4,y:0},upper:{x:4,y:4},
    directionVector:{x:1,y:0},secondDirectionVector:{x:0,y:1},
    stepCount:16,firstFlightSteps:8
  };
  const segments=stairRailSegments(connector,4,0,1);
  const byKind=kind=>segments.find(segment=>segment.kind===kind);
  assert.deepEqual(byKind('first-flight-outer').end,{x:4,y:2,z:-.5});
  assert.deepEqual(byKind('turn-platform-outer-first').end,{x:6,y:2,z:-.5});
  assert.deepEqual(byKind('turn-platform-outer-second').end,{x:6,y:2,z:1.5});
  assert.deepEqual(byKind('first-flight-inner').end,{x:4,y:2,z:1.5});
  assert.deepEqual(byKind('second-flight-inner').start,{x:4,y:2,z:1.5});
  assert.equal(segments.some(segment=>segment.kind.includes('inner')
    && segment.start.x===segment.end.x && segment.start.z===segment.end.z),false);
});

test('L stair inner rails stay continuous for every orientation and edited width', () => {
  const directions=[
    [{x:1,y:0},{x:0,y:1}],
    [{x:0,y:1},{x:-1,y:0}],
    [{x:-1,y:0},{x:0,y:-1}],
    [{x:0,y:-1},{x:1,y:0}]
  ];
  for(const width of [1,2,2.25,3,4.5]){
    for(const [first,second] of directions){
      const lower={x:20,y:20};
      const turn={x:lower.x+first.x*4,y:lower.y+first.y*4};
      const upper={x:turn.x+second.x*4,y:turn.y+second.y*4};
      const connector={width,lower,turn,upper,firstRun:4,secondRun:4,
        directionVector:first,secondDirectionVector:second,stepCount:16,firstFlightSteps:8};
      const railOffset=width/2+.088;
      const segments=stairRailSegments(connector,4,0,railOffset);
      const firstInner=segments.find(segment=>segment.kind==='first-flight-inner');
      const secondInner=segments.find(segment=>segment.kind==='second-flight-inner');
      assert.ok(firstInner && secondInner);
      assert.ok(Math.abs(firstInner.end.x-secondInner.start.x)<1e-9);
      assert.ok(Math.abs(firstInner.end.y-secondInner.start.y)<1e-9);
      assert.ok(Math.abs(firstInner.end.z-secondInner.start.z)<1e-9);
      assert.ok(Math.hypot(firstInner.end.x-firstInner.start.x,firstInner.end.z-firstInner.start.z)>3.8);
      assert.ok(Math.hypot(secondInner.end.x-secondInner.start.x,secondInner.end.z-secondInner.start.z)>3.8);
    }
  }
});

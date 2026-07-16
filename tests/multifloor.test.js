import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assignRoomsToFloors,
  buildMultiFloorLayout,
  classifyEdgesByFloor,
  compactRoomsByFloor,
  createLayerData,
  rectangularCellEnvelope,
  routeAStar,
  structuralHash,
  validateDungeon3D
} from '../src/generation/multifloor.js';

const TILES = { VOID: 0, FLOOR: 1, WALL: 2, POOL: 3 };

function room(id, cx, cy, floor = 0) {
  return {
    id,
    cx,
    cy,
    w: 8,
    h: 8,
    floor,
    depth: id,
    roleHint: id === 0 ? 'entrance' : null
  };
}

function clone(value) {
  return structuredClone(value);
}

function assertRectangularCells(cells, W) {
  const cellSet=new Set(cells);
  const xs=cells.map(cell=>cell%W);
  const ys=cells.map(cell=>Math.floor(cell/W));
  const minX=Math.min(...xs),maxX=Math.max(...xs);
  const minY=Math.min(...ys),maxY=Math.max(...ys);
  assert.equal(cells.length,(maxX-minX+1)*(maxY-minY+1));
  for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++){
    assert.ok(cellSet.has(y*W+x),`missing stairwell envelope cell ${x},${y}`);
  }
}

test('an L-shaped stair service area becomes one complete rectangular envelope', () => {
  const W=12,H=10;
  const lShape=[2*W+3,2*W+4,3*W+4,4*W+4];
  const envelope=rectangularCellEnvelope(lShape,W,H);
  assert.deepEqual(envelope,[
    2*W+3,2*W+4,
    3*W+3,3*W+4,
    4*W+3,4*W+4
  ]);
  assertRectangularCells(envelope,W);
});

test('createLayerData creates isolated typed arrays for every floor', () => {
  const lower = createLayerData(0, 12, 10);
  const upper = createLayerData(1, 12, 10);
  assert.equal(lower.grid.length, 120);
  assert.equal(lower.roomId[0], -1);
  assert.equal(lower.stairwellMask.length, 120);
  lower.grid[4] = TILES.FLOOR;
  assert.equal(upper.grid[4], TILES.VOID);
});

test('overlapping floor decorations stay on every spatially valid layer', () => {
  const rooms = [room(0, 12, 12, 0), room(1, 12, 12, 1)];
  const result = buildMultiFloorLayout({
    W: 28,
    H: 24,
    floorCount: 2,
    rooms,
    edges: [],
    entrance: 0,
    tiles: TILES,
    legacy: { props: [{ kind: 'debris', x: 12, y: 12, roomId: 0 }] }
  });
  assert.equal(result.layers[0].props.length, 1);
  assert.equal(result.layers[1].props.length, 1);
  assert.deepEqual(result.layers.map(layer => layer.props[0].floor), [0, 1]);
});

test('A* routes around unrelated rooms and prefers existing corridors', () => {
  const W = 24;
  const H = 16;
  const layer = createLayerData(0, W, H);
  for (let y = 5; y <= 10; y++) {
    for (let x = 9; x <= 14; x++) {
      const cell = y * W + x;
      layer.grid[cell] = TILES.FLOOR;
      layer.roomId[cell] = 99;
    }
  }
  for (let x = 2; x <= 21; x++) layer.corridor[4 * W + x] = 1;
  const route = routeAStar(layer, { x: 2, y: 8 }, { x: 21, y: 8 }, { W, H });
  assert.ok(route);
  assert.equal(route.cells.some(cell => layer.roomId[cell] === 99), false);
  assert.ok(route.cells.filter(cell => layer.corridor[cell]).length >= 8);
});

test('A* turn cost prevents excessive bends and very long reuse detours', () => {
  const W = 32;
  const H = 22;
  const layer = createLayerData(0, W, H);
  for (let y = 8; y <= 13; y++) {
    for (let x = 13; x <= 18; x++) {
      const cell = y * W + x;
      layer.grid[cell] = TILES.FLOOR;
      layer.roomId[cell] = 99;
    }
  }
  for (let y = 1; y <= 11; y++) {
    layer.corridor[y * W + 2] = 1;
    layer.corridor[y * W + 29] = 1;
  }
  for (let x = 2; x <= 29; x++) layer.corridor[W + x] = 1;
  const route = routeAStar(layer, { x: 2, y: 11 }, { x: 29, y: 11 }, { W, H });
  assert.ok(route);
  assert.equal(route.cells.some(cell => layer.roomId[cell] === 99), false);
  assert.ok(route.points.length <= 5, `unexpected bends: ${route.points.length - 2}`);
  assert.ok(route.cells.length < 48, `unexpected detour length: ${route.cells.length}`);
});

test('A* accepts the pre-stair legacy carving surface', () => {
  const W = 14;
  const H = 10;
  const layer = {
    grid: new Uint8Array(W * H),
    roomId: new Int16Array(W * H).fill(-1),
    corridor: new Uint8Array(W * H)
  };
  const route = routeAStar(layer, { x: 1, y: 2 }, { x: 12, y: 7 }, { W, H });
  assert.ok(route);
  assert.ok(route.points.length <= 3);
});

test('custom door constraints still use adaptive A* routing', () => {
  const W=38, H=24;
  const rooms=[room(0,8,12,0),room(1,29,12,0)];
  const edges=[{
    id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,
    hasCustomDoorA:true,ax:8,ay:8,aside:'n',visualWidth:2
  }];
  const result=buildMultiFloorLayout({W,H,floorCount:1,rooms,edges,entrance:0,tiles:TILES,legacy:{}});
  assert.equal(result.valid,true,result.errors.join('; '));
  const edge=result.edges[0];
  assert.deepEqual(edge.route[0],{x:8,y:8});
  assert.equal(edge.aside,'n');
  assert.notEqual(edge.useEditorRoute,true);
  assert.ok(edge.route.length>=3);
});

test('doors snap to a real wall boundary and final arches use the resolved sockets', () => {
  const W=40, H=24;
  const rooms=[room(0,8,10,0),room(1,28,10,0)];
  const edges=[{
    id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,
    hasCustomDoorA:true,ax:8,ay:10,aside:'n',
    hasCustomDoorB:true,bx:28,by:10,bside:'s'
  }];
  const result=buildMultiFloorLayout({W,H,floorCount:1,rooms,edges,entrance:0,tiles:TILES,legacy:{}});
  assert.equal(result.valid,true,result.errors.join('; '));
  const edge=result.edges[0], arches=result.layers[0].arches;
  assert.deepEqual({x:edge.ax,y:edge.ay,side:edge.aside},{x:8,y:6,side:'n'});
  assert.deepEqual({x:edge.bx,y:edge.by,side:edge.bside},{x:28,y:14,side:'s'});
  assert.deepEqual(arches.map(arch=>({roomId:arch.roomId,x:arch.anchorX,y:arch.anchorY,side:arch.side})),[
    {roomId:0,x:8,y:6,side:'n'},
    {roomId:1,x:28,y:14,side:'s'}
  ]);
  assert.deepEqual(edge.route[1],{x:8,y:4});
  assert.deepEqual(edge.route[edge.route.length-2],{x:28,y:16});
});

test('a blocked configured wall rejects the door instead of switching sides', () => {
  const rooms=[room(0,10,10,0),room(1,14,10,0)];
  const edges=[{
    id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,
    hasCustomDoorA:true,ax:14,ay:10,aside:'e',
    hasCustomDoorB:true,bx:10,by:10,bside:'w'
  }];
  const result=buildMultiFloorLayout({W:30,H:24,floorCount:1,rooms,edges,entrance:0,tiles:TILES,legacy:{}});
  assert.equal(result.valid,false);
  assert.ok(result.errors.includes('edge 0 has no legal wall door'));
  assert.equal(result.layers[0].arches.length,0);
});

test('critical path floor assignment is contiguous and reaches the requested top floor', () => {
  const rooms = Array.from({ length: 7 }, (_, id) => room(id, 10 + id * 10, 10));
  const parent = Int32Array.from([-1, 0, 1, 2, 3, 4, 5]);
  const result = assignRoomsToFloors({ rooms, parent, entrance: 0, boss: 6, floorCount: 3 });
  assert.deepEqual(result.criticalPath, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(rooms[0].floor, 0);
  assert.equal(rooms[6].floor, 2);
  for (let i = 1; i < rooms.length; i++) assert.ok(Math.abs(rooms[i].floor - rooms[i - 1].floor) <= 1);
});

test('automatic assignment clamps unusable empty top floors', () => {
  const rooms = Array.from({ length: 3 }, (_, id) => room(id, 10 + id * 10, 10));
  const parent = Int32Array.from([-1, 0, 1]);
  const result = assignRoomsToFloors({ rooms, parent, entrance: 0, boss: 2, floorCount: 6 });
  assert.equal(result.floorCount, 3);
  assert.deepEqual(rooms.map(roomData => roomData.floor), [0, 1, 2]);
});

test('preassigned per-floor room counts remain exact', () => {
  const rooms = [
    ...Array.from({ length: 3 }, (_, id) => room(id, id * 12, 0, 0)),
    ...Array.from({ length: 5 }, (_, offset) => room(offset + 3, offset * 12, 20, 1))
  ];
  const parent = Int32Array.from([-1, 0, 1, 2, 3, 4, 5, 6]);
  const result = assignRoomsToFloors({ rooms, parent, entrance: 0, boss: 7, floorCount: 2, preserveExisting: true });
  assert.equal(result.floorCount, 2);
  assert.deepEqual([0, 1].map(floor => rooms.filter(value => value.floor === floor).length), [3, 5]);
});

test('floor compaction permits vertical overlap while preserving same-floor clearance', () => {
  const rooms = [
    room(0, 0, 0, 0), room(1, 30, 0, 0), room(2, 60, 0, 0),
    room(3, 100, 0, 1), room(4, 130, 0, 1), room(5, 160, 0, 1)
  ];
  const result = compactRoomsByFloor({ rooms, floorCount: 2, gap: 6 });
  assert.ok(result.movedRooms > 0);
  assert.ok(result.projectedOverlaps > 0);
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i], b = rooms[j];
      if (a.floor !== b.floor) continue;
      const separated = Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 + 6
        || Math.abs(a.cy - b.cy) >= (a.h + b.h) / 2 + 6;
      assert.equal(separated, true, `rooms ${a.id} and ${b.id}`);
    }
  }
});

test('non-adjacent automatic loop edges are removed, while invalid required edges are reported', () => {
  const rooms = [room(0, 5, 5, 0), room(1, 15, 5, 2)];
  const loop = classifyEdgesByFloor(rooms, [{ id: 4, a: 0, b: 1, isLoop: true, isManual: false }]);
  assert.deepEqual(loop.removed, [4]);
  assert.equal(loop.errors.length, 0);
  const required = classifyEdgesByFloor(rooms, [{ id: 5, a: 0, b: 1, isLoop: false, isManual: true }]);
  assert.equal(required.edges.length, 0);
  assert.match(required.errors[0], /crosses 2 floors/);
});

test('three-floor layout creates explicit stairs and passes 3D connectivity validation', () => {
  const rooms = [room(0, 12, 18, 0), room(1, 36, 18, 1), room(2, 60, 18, 2)];
  const edges = [
    { id: 0, a: 0, b: 1, isLoop: false, isCritical: true, isManual: false },
    { id: 1, a: 1, b: 2, isLoop: false, isCritical: true, isManual: false }
  ];
  const result = buildMultiFloorLayout({
    W: 76,
    H: 40,
    floorCount: 3,
    rooms,
    edges,
    entrance: 0,
    tiles: TILES,
    legacy: {}
  });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.connectors.length, 2);
  assert.deepEqual(result.connectors.map(c => [c.fromFloor, c.toFloor]), [[0, 1], [1, 2]]);
  for (const connector of result.connectors) {
    assert.equal(connector.stepCount, 16);
    assert.equal(connector.stepRise, 0.25);
    assert.equal(connector.treadDepth, 0.5);
    assert.equal(connector.openingPolicy,'headroom-tight');
    assert.ok(connector.requiredHeadroom>0 && connector.requiredHeadroom<connector.rise);
    assert.ok(connector.openingCells.length>0);
    assert.ok(connector.openingCells.length<connector.stairFootprintCells.length);
    assert.deepEqual(new Set(connector.headroomCells),new Set(connector.openingCells));
    assert.ok(connector.openingBoundaryEdges.length>0);
    assert.ok(connector.openingAccessEdges.length>0);
    assert.ok(connector.turn);
    assert.equal(connector.firstRun + connector.secondRun, connector.length);
    assert.equal(connector.firstFlightSteps + connector.secondFlightSteps, connector.stepCount);
    const lowerLayer = result.layers[connector.fromFloor];
    const upperLayer = result.layers[connector.toFloor];
    for (const cell of connector.sharedFootprintCells) {
      assert.equal(lowerLayer.stairwellMask[cell], 1);
      assert.equal(upperLayer.stairwellMask[cell], 1);
    }
    assert.equal(lowerLayer.stairLanding[connector.lower.y * 76 + connector.lower.x], 1);
    assert.equal(upperLayer.stairLanding[connector.upper.y * 76 + connector.upper.x], 1);
    for (const cell of connector.stairFootprintCells) {
      assert.equal(lowerLayer.stairMask[cell], 1);
      assert.equal(lowerLayer.stairClearance[cell], 1);
      assert.equal(lowerLayer.roomId[cell], -1);
    }
    for (const cell of connector.openingCells) {
      assert.equal(upperLayer.slabOpening[cell], 1);
      assert.equal(upperLayer.stairClearance[cell], 1);
      assert.equal(upperLayer.roomId[cell], -1);
      assert.equal(upperLayer.grid[cell], TILES.VOID);
    }
    const edgeKey=edge=>[edge.x1,edge.y1,edge.x2,edge.y2].join(',');
    const accessKeys=new Set(connector.openingAccessEdges.map(edgeKey));
    const guardKeys=new Set(connector.openingGuardSegments.map(edgeKey));
    const wallKeys=new Set(connector.openingWallSegments.map(edgeKey));
    for(const edge of connector.openingBoundaryEdges){
      const key=edgeKey(edge);
      if(edge.access){
        assert.ok(accessKeys.has(key));
        assert.equal(guardKeys.has(key),false);
      }else if(edge.neighborCell>=0 && upperLayer.grid[edge.neighborCell]===TILES.FLOOR){
        assert.ok(guardKeys.has(key),`missing opening guard ${key}`);
      }else if(edge.neighborCell>=0 && upperLayer.grid[edge.neighborCell]===TILES.WALL){
        assert.ok(wallKeys.has(key),`missing opening wall ownership ${key}`);
      }
    }
  }
  for (const roomData of rooms) {
    const cell = roomData.floor * 76 * 40 + roomData.cy * 76 + roomData.cx;
    assert.ok(result.bfs3[cell] >= 0);
  }
  const tamperedConnectors=result.connectors.map(connector=>structuredClone(connector));
  tamperedConnectors[0].secondRun+=1;
  const tamperedValidation=validateDungeon3D({
    layers:result.layers,rooms,connectors:tamperedConnectors,entrance:0,W:76,H:40,tiles:TILES
  });
  assert.ok(tamperedValidation.invalidConnectors.includes(tamperedConnectors[0].id));
});

test('stable stair specs preserve their anchor and reject conflicting locked placement', () => {
  const rooms=[room(0,12,18,0),room(1,36,18,1)];
  const base=buildMultiFloorLayout({
    W:52,H:38,floorCount:2,rooms:clone(rooms),
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(base.valid,true,base.errors.join('\n'));
  const original=base.connectors[0];
  const stable=buildMultiFloorLayout({
    W:52,H:38,floorCount:2,rooms:clone(rooms),
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      mode:'stable-auto',anchor:{...original.lower},direction:original.direction,width:original.width,length:original.length,landingDepth:original.landingDepth
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(stable.valid,true,stable.errors.join('\n'));
  assert.deepEqual(stable.connectors[0].lower,original.lower);
  assert.equal(stable.connectors[0].direction,original.direction);

  const conflicting=buildMultiFloorLayout({
    W:52,H:38,floorCount:2,rooms:clone(rooms),
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-locked',mode:'locked',anchor:{x:1,y:1},direction:'west',width:2,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(conflicting.valid,false);
  assert.match(conflicting.errors.join('\n'),/no legal stair candidate/);
  assert.deepEqual(conflicting.stairFailures.map(failure=>failure.stairId),['stair-locked']);
});

test('stacked rooms use one shared stairwell footprint on both floors', () => {
  const lower={...room(0,24,20,0),w:18,h:16};
  const upper={...room(1,24,20,1),w:18,h:16};
  const result=buildMultiFloorLayout({
    W:52,H:42,floorCount:2,rooms:[lower,upper],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  const connector=result.connectors[0];
  assert.equal(connector.sharedFootprintKind,'room-overlap');
  assert.ok(connector.sharedFootprintCells.length>connector.openingCells.length);
  assertRectangularCells(connector.sharedFootprintCells,52);
  for(const cell of connector.sharedFootprintCells){
    assert.equal(result.layers[0].stairwellMask[cell],1);
    assert.equal(result.layers[1].stairwellMask[cell],1);
  }
  for(const cell of connector.openingCells){
    assert.equal(result.layers[0].stairMask[cell],1);
    assert.equal(result.layers[1].slabOpening[cell],1);
  }
});

test('a locked straight stair preserves quarter-tile width and reserves enough cells on both floors', () => {
  const lower={...room(0,24,25,0),w:26,h:20};
  const upper={...room(1,24,25,1),w:26,h:20};
  const result=buildMultiFloorLayout({
    W:60,H:50,floorCount:2,rooms:[lower,upper],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-straight-wide',mode:'locked',style:'straight',anchor:{x:20,y:25},direction:'east',width:3.25,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  const connector=result.connectors[0];
  assert.equal(connector.style,'straight');
  assert.equal(connector.turn,null);
  assert.equal(connector.width,3.25);
  assert.deepEqual(connector.upper,{x:28,y:25});
  assert.equal(connector.firstRun,8);
  assert.equal(connector.secondRun,0);
  assert.equal(connector.firstFlightSteps,connector.stepCount);
  assert.equal(connector.secondFlightSteps,0);
  assert.ok(connector.openingCells.length>0);
  assert.ok(connector.openingCells.length<connector.stairFootprintCells.length);
  for(const cell of connector.sharedFootprintCells){
    assert.equal(result.layers[0].stairwellMask[cell],1);
    assert.equal(result.layers[1].stairwellMask[cell],1);
  }
});

test('a locked stair grows its raster footprint only toward the dragged width side', () => {
  const lower={...room(0,24,25,0),w:26,h:20};
  const upper={...room(1,24,25,1),w:26,h:20};
  const result=buildMultiFloorLayout({
    W:60,H:50,floorCount:2,rooms:[lower,upper],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-stable-center',mode:'locked',style:'straight',anchor:{x:20,y:25},direction:'east',
      width:2.25,lateralCenterOffset:.625,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.connectors[0].width,2.25);
  const connector=result.connectors[0];
  assert.equal(connector.lateralCenterOffset,.625);
  const shaftRows=connector.openingCells.map(cell=>Math.floor(cell/60));
  assert.equal(Math.min(...shaftRows),25);
  assert.equal(Math.max(...shaftRows),27);
});

test('a locked stair may replace the room centre and reshapes both floor structures', () => {
  const lower={...room(0,24,20,0),w:18,h:16};
  const upper={...room(1,24,20,1),w:18,h:16};
  const result=buildMultiFloorLayout({
    W:52,H:42,floorCount:2,rooms:[lower,upper],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-centre',mode:'locked',anchor:{x:20,y:20},direction:'east',width:2,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.stairFailures.length,0);
  const connector=result.connectors[0];
  const centre=20*52+24;
  assert.ok(connector.openingCells.includes(centre));
  assert.equal(result.layers[0].stairMask[centre],1);
  assert.equal(result.layers[0].roomId[centre],-1);
  assert.equal(result.layers[1].slabOpening[centre],1);
  assert.equal(result.layers[1].grid[centre],TILES.VOID);
  assert.ok(result.layers[1].bfs.some(distance=>distance>=0));
});

test('a locked stair can sit flush against a room wall without carving side clearance outside it', () => {
  const lower={...room(0,24,20,0),w:18,h:16};
  const upper={...room(1,24,20,1),w:18,h:16};
  const result=buildMultiFloorLayout({
    W:52,H:42,floorCount:2,rooms:[lower,upper],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-wall',mode:'locked',anchor:{x:20,y:12},direction:'east',width:2,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  const connector=result.connectors[0];
  assert.equal(connector.sideClearance,0);
  const footprintRows=connector.sharedFootprintCells.map(cell=>Math.floor(cell/52));
  assert.equal(Math.min(...footprintRows),12);
  // The independent W x W turn landing extends one row past the old shared
  // bend point; its complete generated envelope must be reserved as well.
  assert.equal(Math.max(...footprintRows),19);
  assert.equal(result.layers[0].grid[11*52+24],TILES.WALL);
});

test('a user-locked stair reshapes unrelated room cells on both floors instead of reporting a false conflict', () => {
  const lower=room(0,12,20,0);
  const upper=room(1,48,20,1);
  const lowerOverlap={...room(2,28,20,0),w:14,h:10};
  const upperOverlap={...room(3,28,20,1),w:14,h:10};
  const result=buildMultiFloorLayout({
    W:64,H:42,floorCount:2,rooms:[lower,upper,lowerOverlap,upperOverlap],
    edges:[{id:0,a:0,b:1,isLoop:false,isCritical:true,isManual:true,stairSpec:{
      id:'stair-reshape',mode:'locked',anchor:{x:24,y:20},direction:'east',width:2,length:8,landingDepth:2
    }}],entrance:0,tiles:TILES,legacy:{}
  });
  assert.equal(result.valid,true,result.errors.join('\n'));
  assert.equal(result.stairFailures.length,0);
  const connector=result.connectors[0];
  const centre=20*64+28;
  assert.equal(result.layers[0].stairMask[centre],1);
  assert.equal(result.layers[0].roomId[centre],-1);
  assert.equal(result.layers[1].slabOpening[centre],1);
  assert.equal(result.layers[1].roomId[centre],-1);
  assert.deepEqual(connector.structureAdaptationRoutes.map(route=>[route.floor,route.roomId]),[[0,2],[1,3]]);
  const exactUpperMutation=new Set(connector.openingCells);
  for(let cell=0;cell<result.layers[1].stairLanding.length;cell++){
    if(result.layers[1].stairLanding[cell]) exactUpperMutation.add(cell);
  }
  const preservedWalls=connector.sharedFootprintCells.filter(cell=>
    !exactUpperMutation.has(cell) && result.layers[1].grid[cell]===TILES.WALL);
  assert.ok(preservedWalls.length>0,'the stairwell envelope must preserve unrelated upper-floor walls');
  assert.ok(connector.openingGuardSegments.length>0);
  const guardKeys=new Set(connector.openingGuardSegments.map(edge=>[edge.x1,edge.y1,edge.x2,edge.y2].join(',')));
  for(const edge of connector.openingAccessEdges){
    assert.equal(guardKeys.has([edge.x1,edge.y1,edge.x2,edge.y2].join(',')),false);
  }
});

test('multifloor generation is deterministic', () => {
  const rooms = [room(0, 12, 18, 0), room(1, 36, 18, 1), room(2, 60, 18, 2)];
  const edges = [
    { id: 0, a: 0, b: 1, isLoop: false, isCritical: true, isManual: false },
    { id: 1, a: 1, b: 2, isLoop: false, isCritical: true, isManual: false }
  ];
  const build = () => {
    const copiedRooms = clone(rooms);
    const result = buildMultiFloorLayout({
      W: 76,
      H: 40,
      floorCount: 3,
      rooms: copiedRooms,
      edges: clone(edges),
      entrance: 0,
      tiles: TILES,
      legacy: {}
    });
    return { rooms: copiedRooms, ...result };
  };
  assert.equal(structuralHash(build()), structuralHash(build()));
});

test('single-floor compatibility keeps all edges as corridors', () => {
  const rooms = [room(0, 12, 18, 0), room(1, 34, 18, 0), room(2, 56, 18, 0)];
  const edges = [
    { id: 0, a: 0, b: 1, isLoop: false, isCritical: true, isManual: false },
    { id: 1, a: 1, b: 2, isLoop: false, isCritical: true, isManual: false }
  ];
  const result = buildMultiFloorLayout({ W: 70, H: 38, floorCount: 1, rooms, edges, entrance: 0, tiles: TILES, legacy: {} });
  assert.equal(result.valid, true, result.errors.join('\n'));
  assert.equal(result.connectors.length, 0);
  assert.equal(result.edges.every(edge => edge.kind === 'corridor' && edge.floor === 0), true);
});

test('depth-band assignment never makes a graph edge skip a floor', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const count = 24;
    const rooms = Array.from({ length: count }, (_, id) => room(id, id * 3, 0));
    const edges = [];
    for (let id = 1; id < count; id++) edges.push({ id: edges.length, a: id - 1, b: id, isLoop: false, isManual: false });
    for (let id = 0; id < count - 3; id++) {
      if (((seed * 31 + id * 17) % 11) === 0) edges.push({ id: edges.length, a: id, b: id + 3, isLoop: true, isManual: false });
    }
    const adjacency = Array.from({ length: count }, () => []);
    for (const edge of edges) {
      adjacency[edge.a].push(edge.b);
      adjacency[edge.b].push(edge.a);
    }
    const parent = new Int32Array(count).fill(-1);
    const depth = new Int32Array(count).fill(-1);
    const queue = [0];
    depth[0] = 0;
    for (let head = 0; head < queue.length; head++) {
      const current = queue[head];
      for (const next of adjacency[current]) {
        if (depth[next] >= 0) continue;
        depth[next] = depth[current] + 1;
        parent[next] = current;
        queue.push(next);
      }
    }
    rooms.forEach((roomData, id) => { roomData.depth = depth[id]; });
    assignRoomsToFloors({ rooms, parent, entrance: 0, boss: count - 1, floorCount: 6 });
    for (const edge of edges) assert.ok(Math.abs(rooms[edge.a].floor - rooms[edge.b].floor) <= 1, `seed ${seed}, edge ${edge.id}`);
  }
});

test('100 deterministic layouts keep every required room and stair reachable', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const jitterA = (seed * 17) % 7;
    const jitterB = (seed * 29) % 9;
    const rooms = [
      room(0, 12, 18 + jitterA, 0),
      room(1, 34, 17 + jitterB, 1),
      room(2, 58, 18 + ((seed * 11) % 8), 2)
    ];
    const edges = [
      { id: 0, a: 0, b: 1, isLoop: false, isCritical: true, isManual: false },
      { id: 1, a: 1, b: 2, isLoop: false, isCritical: true, isManual: false }
    ];
    const result = buildMultiFloorLayout({
      W: 74,
      H: 44,
      floorCount: 3,
      rooms,
      edges,
      entrance: 0,
      tiles: TILES,
      legacy: {}
    });
    assert.equal(result.valid, true, `seed ${seed}: ${result.errors.join('; ')}`);
    assert.equal(result.connectors.length, 2, `seed ${seed}`);
  }
});

test('30 compacted multi-room buildings retain legal stair sockets', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rooms = [];
    for (let floor = 0; floor < 3; floor++) {
      for (let slot = 0; slot < 5; slot++) {
        const id = floor * 5 + slot;
        rooms.push({
          ...room(id, floor * 100 + slot * 20, 18 + ((seed * 13 + id * 7) % 9), floor),
          depth: id
        });
      }
    }
    compactRoomsByFloor({ rooms, floorCount: 3, gap: 6 });
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const value of rooms) {
      minX = Math.min(minX, value.cx - value.w / 2);
      maxX = Math.max(maxX, value.cx + value.w / 2);
      minY = Math.min(minY, value.cy - value.h / 2);
      maxY = Math.max(maxY, value.cy + value.h / 2);
    }
    const pad = 5;
    const W = Math.ceil(maxX - minX) + pad * 2 + 1;
    const H = Math.ceil(maxY - minY) + pad * 2 + 1;
    const ox = pad - Math.floor(minX), oy = pad - Math.floor(minY);
    rooms.forEach(value => { value.cx += ox; value.cy += oy; });
    const edges = [];
    for (let id = 1; id < rooms.length; id++) {
      edges.push({ id: edges.length, a: id - 1, b: id, isLoop: false, isCritical: id === 5 || id === 10, isManual: false });
    }
    const result = buildMultiFloorLayout({ W, H, floorCount: 3, rooms, edges, entrance: 0, tiles: TILES, legacy: {} });
    assert.equal(result.valid, true, `seed ${seed}: ${result.errors.join('; ')}`);
    assert.equal(result.connectors.length, 2, `seed ${seed}`);
  }
});

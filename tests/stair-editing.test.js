import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptRoomToRotatedStair, adjacentFloorTargets, chooseStairTargetFloor, matchingStairRooms, pairedStairRoomPlacement, rotateStairPlacement90, stairPairError, stairRemovalDisconnectsRooms, stairRotationFromPointer, stairVisualForRotation, translateStairPlacement } from '../src/ui/stair-editing.js';

test('stair targets are adjacent and prefer the next floor', () => {
  assert.deepEqual(adjacentFloorTargets(0, 3), [1]);
  assert.deepEqual(adjacentFloorTargets(1, 3), [2, 0]);
  assert.deepEqual(adjacentFloorTargets(2, 3), [1]);
  assert.equal(chooseStairTargetFloor(1, 3), 2);
  assert.equal(chooseStairTargetFloor(1, 3, -1), 0);
  assert.equal(chooseStairTargetFloor(0, 1), null);
});

test('stair pairs require distinct rooms on adjacent floors', () => {
  assert.equal(stairPairError({ id: 1, floor: 0 }, { id: 2, floor: 1 }), '');
  assert.match(stairPairError({ id: 1, floor: 0 }, { id: 2, floor: 2 }), /相邻楼层/);
  assert.match(stairPairError({ id: 1, floor: 0 }, { id: 1, floor: 0 }), /同一个区域/);
});

test('stair matching finds vertically aligned rooms and can place paired stair rooms on both floors', () => {
  const source={id:1,floor:0,x:20,y:20,w:16,h:14};
  const aligned={id:2,floor:1,x:22,y:19,w:10,h:10};
  const tooSmall={id:4,floor:1,x:27,y:25,w:8,h:8};
  const distant={id:3,floor:1,x:60,y:60,w:12,h:10};
  assert.deepEqual(matchingStairRooms(source,[source,distant,tooSmall,aligned],1).map(room=>room.id),[2]);
  const placement=pairedStairRoomPlacement(source,[source,distant],1);
  assert.deepEqual(placement,{x:38,y:20,w:14,h:10,side:'east'});
  const blocked=[source,{id:4,floor:0,x:38,y:20,w:30,h:30},{id:5,floor:1,x:38,y:20,w:80,h:80}];
  assert.equal(pairedStairRoomPlacement(source,blocked,1),null);
});

test('moving either connected room translates both stair landings as one object', () => {
  const stair={anchor:{x:10,y:20},previewAnchor:{x:10,y:20}};
  const visual={
    lower:{x:10,y:20},upper:{x:18,y:20},
    lowerApproach:{x:8,y:20},upperApproach:{x:20,y:20},direction:'east'
  };
  const moved=translateStairPlacement(stair,visual,{x:-3,y:5});
  assert.deepEqual(moved.anchor,{x:7,y:25});
  assert.deepEqual(moved.previewAnchor,{x:7,y:25});
  assert.deepEqual(moved.visual.lower,{x:7,y:25});
  assert.deepEqual(moved.visual.upper,{x:15,y:25});
  assert.deepEqual(moved.visual.lowerApproach,{x:5,y:25});
  assert.deepEqual(moved.visual.upperApproach,{x:17,y:25});
  assert.deepEqual(visual.lower,{x:10,y:20});
});

test('L stair rotation turns exactly 90 degrees around its footprint center', () => {
  const stair={previewDirection:'east',previewLength:8,previewAnchor:{x:10,y:20}};
  const visual={lower:{x:10,y:20},upper:{x:18,y:20},direction:'east'};
  const rotated=rotateStairPlacement90(stair,visual);
  assert.deepEqual(rotated,{anchor:{x:14,y:20},direction:'south',length:8});
  const southVisual=stairVisualForRotation(visual,stair,rotated);
  const rotatedAgain=rotateStairPlacement90({...stair,previewDirection:'south',previewAnchor:rotated.anchor},southVisual);
  assert.deepEqual(rotatedAgain,{anchor:{x:14,y:24},direction:'west',length:8});
});

test('rooms adapt to the rotated stair footprint on both dedicated and normal rooms', () => {
  const stair={previewLength:8,previewWidth:2,landingDepth:2};
  const rotated={anchor:{x:14,y:20},direction:'south',length:8};
  const dedicated=adaptRoomToRotatedStair({id:1,x:12,y:20,w:14,h:10,stairRoom:true},stair,rotated);
  assert.deepEqual(dedicated,{id:1,x:11,y:21,w:8,h:8,stairRoom:true});
  const normal=adaptRoomToRotatedStair({id:2,x:14,y:20,w:12,h:10},stair,rotated);
  assert.deepEqual(normal,{id:2,x:14,y:20,w:12,h:10});
  const wallFlush=adaptRoomToRotatedStair({id:4,x:14,y:20,w:12,h:12},stair,rotated);
  assert.deepEqual(wallFlush,{id:4,x:14,y:20,w:12,h:12});
  const distant=adaptRoomToRotatedStair({id:3,x:60,y:60,w:12,h:10},stair,rotated);
  assert.deepEqual(distant,{id:3,x:60,y:60,w:12,h:10});
});

test('drag rotation snaps to cardinal directions and rebuilds the stair visual', () => {
  const stair={previewDirection:'east',previewLength:8,previewWidth:2,landingDepth:2,previewAnchor:{x:10,y:20}};
  const visual={lower:{x:10,y:20},upper:{x:18,y:20},lowerApproach:{x:8,y:20},upperApproach:{x:20,y:20},direction:'east'};
  const south=stairRotationFromPointer(stair,visual,{x:14,y:32});
  assert.deepEqual(south,{anchor:{x:14,y:20},direction:'south',length:8});
  assert.equal(stairRotationFromPointer(stair,visual,{x:12,y:22}),null);
  const rotatedVisual=stairVisualForRotation(visual,stair,south);
  assert.deepEqual(rotatedVisual.lower,{x:14,y:20});
  assert.deepEqual(rotatedVisual.turn,{x:14,y:24});
  assert.deepEqual(rotatedVisual.upper,{x:10,y:24});
  assert.deepEqual(rotatedVisual.lowerApproach,{x:14,y:18});
  assert.deepEqual(rotatedVisual.upperApproach,{x:8,y:24});
});

test('stair deletion detects loss of required room connectivity', () => {
  const rooms=[{id:1,floor:0,roleHint:'entrance'},{id:2,floor:0},{id:3,floor:1}];
  const corridor={a:1,b:2};
  const stair={a:2,b:3,kind:'stairs'};
  assert.equal(stairRemovalDisconnectsRooms(rooms,[corridor,stair],stair),true);
  assert.equal(stairRemovalDisconnectsRooms(rooms,[corridor,stair,{a:1,b:3}],stair),false);
});

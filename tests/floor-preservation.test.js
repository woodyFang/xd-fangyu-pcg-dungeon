import test from 'node:test';
import assert from 'node:assert/strict';
import { createLayerData } from '../src/generation/multifloor.js';
import { preserveUneditedFloors } from '../src/generation/floor-preservation.js';

function dungeon(W,H,offsetX,offsetY){
  const layers=[createLayerData(0,W,H),createLayerData(1,W,H)];
  return {
    W,H,editorOffset:{x:offsetX,y:offsetY},layers,
    rooms:[
      {id:0,floor:0,cx:offsetX,cy:offsetY,w:8,h:8,type:'combat'},
      {id:1,floor:1,cx:offsetX,cy:offsetY,w:8,h:8,type:'treasure',depth:5,difficulty:.7}
    ]
  };
}

test('regeneration preserves cells, details, and semantics on unedited floors', () => {
  const previous=dungeon(6,6,2,2);
  const next=dungeon(8,8,3,3);
  const oldCell=2+2*6, newCell=3+3*8;
  previous.layers[1].grid[oldCell]=1;
  previous.layers[1].roomId[oldCell]=1;
  previous.layers[1].corridor[oldCell]=1;
  previous.layers[1].props=[{kind:'marker',x:2,y:2,roomId:1,floor:1}];
  next.layers[1].grid[newCell]=2;
  next.rooms[1].type='combat'; next.rooms[1].depth=1; next.rooms[1].difficulty=.1;
  preserveUneditedFloors(previous,next,[0]);
  assert.equal(next.layers[1].grid[newCell],1);
  assert.equal(next.layers[1].roomId[newCell],1);
  assert.equal(next.layers[1].corridor[newCell],1);
  assert.deepEqual(next.layers[1].props,[{kind:'marker',x:3,y:3,roomId:1,floor:1}]);
  assert.equal(next.rooms[1].type,'treasure');
  assert.equal(next.rooms[1].depth,5);
  assert.equal(next.rooms[1].difficulty,.7);
});

test('edited floors and new stair neighborhoods keep regenerated data', () => {
  const previous=dungeon(8,8,3,3);
  const next=dungeon(8,8,3,3);
  const cell=3+3*8;
  previous.layers[0].grid[cell]=1;
  next.layers[0].grid[cell]=2;
  previous.layers[1].grid[cell]=1;
  next.layers[1].grid[cell]=0;
  next.layers[1].stairLanding[cell]=1;
  preserveUneditedFloors(previous,next,[0]);
  assert.equal(next.layers[0].grid[cell],2);
  assert.equal(next.layers[1].grid[cell],0);
  assert.equal(next.layers[1].stairLanding[cell],1);
});

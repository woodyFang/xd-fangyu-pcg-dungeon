import test from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR_ALIGNMENT_OFFSETS, translateFloorLayout } from '../src/generation/floor-shift.js';

test('floor alignment translation moves only the requested floor', () => {
  const rooms=[
    {id:1,floor:0,x:0,y:0},
    {id:2,floor:1,x:10,y:12},
    {id:3,floor:1,x:18,y:12}
  ];
  const links=[{a:2,b:3,bends:[{x:14,y:12}]},{a:1,b:2,bends:[]}];
  const shifted=translateFloorLayout(rooms,links,1,4,-2);
  assert.deepEqual(shifted.rooms.map(room=>[room.x,room.y]),[[0,0],[14,10],[22,10]]);
  assert.deepEqual(shifted.links[0].bends,[{x:18,y:10}]);
  assert.deepEqual(shifted.links[1].bends,[]);
  assert.deepEqual(rooms.map(room=>[room.x,room.y]),[[0,0],[10,12],[18,12]]);
});

test('floor alignment fallback has deterministic bounded offsets', () => {
  assert.equal(FLOOR_ALIGNMENT_OFFSETS.length,12);
  assert.ok(FLOOR_ALIGNMENT_OFFSETS.every(offset=>Math.abs(offset.x)<=8 && Math.abs(offset.y)<=8));
});

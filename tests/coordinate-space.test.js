import test from 'node:test';
import assert from 'node:assert/strict';

import { corridorCenterOffset, corridorCenterShiftAt, dungeonLayerShift, editorToGridPoint, gridToEditorPoint } from '../src/generation/coordinate-space.js';

test('grid, editor, and shifted 3D world coordinates share one origin', () => {
  const dungeon={W:51,H:39,editorOffset:{x:19,y:14}};
  const grid={x:24,y:20};
  const editor=gridToEditorPoint(dungeon,grid);
  const shift=dungeonLayerShift(dungeon);
  const localWorld={x:grid.x-dungeon.W/2+.5,y:grid.y-dungeon.H/2+.5};
  assert.deepEqual(editor,{x:5,y:6});
  assert.equal(localWorld.x+shift.x,editor.x);
  assert.equal(localWorld.y+shift.y,editor.y);
  assert.deepEqual(editorToGridPoint(dungeon,editor),grid);
});

test('corridor visual centering only offsets asymmetric width two', () => {
  assert.equal(corridorCenterOffset(1),0);
  assert.equal(corridorCenterOffset(2),.5);
  assert.equal(corridorCenterOffset(3),0);
  assert.equal(corridorCenterOffset(4),.5);
});

test('width-two corridor centering follows the segment normal', () => {
  const horizontal=[{x:4,y:8},{x:7,y:8},{x:7,y:11}];
  assert.deepEqual(corridorCenterShiftAt(horizontal,0,2),{x:0,y:.5});
  assert.deepEqual(corridorCenterShiftAt(horizontal,1,2),{x:.5,y:.5});
  assert.deepEqual(corridorCenterShiftAt(horizontal,2,2),{x:.5,y:0});
  assert.deepEqual(corridorCenterShiftAt(horizontal,0,1),{x:0,y:0});
  assert.deepEqual(corridorCenterShiftAt(horizontal,1,3),{x:0,y:0});
});

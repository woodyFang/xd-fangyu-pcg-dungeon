import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptRouteBends } from '../src/generation/adaptive-route.js';

test('route bends follow both moving endpoints by path position', () => {
  const bends=[{x:4,y:0},{x:8,y:3}];
  const adapted=adaptRouteBends(bends,{x:0,y:0},{x:12,y:3},{x:3,y:2},{x:18,y:7});
  assert.equal(adapted.length,2);
  assert.ok(adapted[0].x>7 && adapted[0].x<9);
  assert.ok(adapted[1].x>12 && adapted[1].x<14);
  assert.ok(adapted[0].y>0 && adapted[1].y>3);
  assert.deepEqual(bends,[{x:4,y:0},{x:8,y:3}]);
});

test('route bends keep their shape when both endpoints translate together', () => {
  const bends=[{x:5,y:2},{x:7,y:6}];
  const adapted=adaptRouteBends(bends,{x:1,y:1},{x:10,y:8},{x:5,y:-2},{x:14,y:5});
  assert.ok(Math.abs(adapted[0].x-9)<1e-9 && Math.abs(adapted[0].y+1)<1e-9);
  assert.ok(Math.abs(adapted[1].x-11)<1e-9 && Math.abs(adapted[1].y-3)<1e-9);
});

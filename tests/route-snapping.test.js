import test from 'node:test';
import assert from 'node:assert/strict';

import { snapRouteControlPoint } from '../src/ui/route-snapping.js';

test('route controls align independently on x and y axes', () => {
  const snapped=snapRouteControlPoint(
    {x:10.7,y:18.4},
    [{x:11,y:3},{x:30,y:18}],
    2,
    Math.round
  );
  assert.deepEqual(snapped,{x:11,y:18,snappedX:true,snappedY:true});
});

test('route controls do not collapse onto a distant diagonal control', () => {
  const snapped=snapRouteControlPoint({x:8,y:8},[{x:10,y:10}],1.5,Math.round);
  assert.deepEqual(snapped,{x:8,y:8,snappedX:false,snappedY:false});
});

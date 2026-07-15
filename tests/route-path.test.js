import test from 'node:test';
import assert from 'node:assert/strict';

import { simplifyRoutePoints } from '../src/ui/route-path.js';

test('route simplification removes duplicate and straight-through root controls', () => {
  const route = [
    { x: 4, y: 0, side: 'n' },
    { x: 4, y: 0 },
    { x: 4, y: 1 },
    { x: 4, y: 7 },
    { x: 9, y: 7 },
  ];
  assert.deepEqual(simplifyRoutePoints(route), [route[0], route[3], route[4]]);
});

test('route simplification preserves real corners and reversals', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 4 },
    { x: 3, y: 4 },
    { x: 0, y: 4 },
    { x: 0, y: 8 },
  ];
  assert.deepEqual(simplifyRoutePoints(route), route);
});

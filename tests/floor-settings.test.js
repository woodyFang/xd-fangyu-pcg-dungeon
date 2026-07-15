import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeFloorValues, updateFloorValue } from '../src/ui/floor-settings.js';

const roomOptions = { fallback:21, min:6, max:50 };
const loopOptions = { fallback:15, min:0, max:40 };
const decorOptions = { fallback:60, min:0, max:100 };

test('updating one floor value does not mutate or change sibling floors', () => {
  const original = [21, 31, 18];
  const updated = updateFloorValue(original, 1, 42, roomOptions);
  assert.deepEqual(original, [21, 31, 18]);
  assert.deepEqual(updated, [21, 42, 18]);
  assert.notEqual(updated, original);
});

test('loop and decoration settings stay isolated across floor switches', () => {
  let loops = [15, 15];
  let decor = [60, 60];
  loops = updateFloorValue(loops, 0, 5, loopOptions);
  decor = updateFloorValue(decor, 1, 90, decorOptions);
  assert.deepEqual(loops, [5, 15]);
  assert.deepEqual(decor, [60, 90]);
});

test('normalizing floor count inherits only when a new floor is created', () => {
  assert.deepEqual(normalizeFloorValues([12, 26], 3, roomOptions), [12, 26, 26]);
  assert.deepEqual(normalizeFloorValues([12, 26, 19], 2, roomOptions), [12, 26]);
});

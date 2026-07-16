import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  STAIR_DIRECTIONS,
  normalizeStairStyle,
  resolveStairStructure,
  snapStairWidth,
  stairLateralCenterOffset
} from '../src/domain/stair-contract.js';

test('the shared stair contract resolves style, width, turn, and platform geometry', () => {
  assert.equal(normalizeStairStyle('unknown'),'l-turn');
  assert.equal(snapStairWidth(2.37),2.25);
  assert.equal(stairLateralCenterOffset(2),.5);
  const structure=resolveStairStructure({
    lower:{x:10,y:20},direction:STAIR_DIRECTIONS.east,run:8,width:2.25,
    style:'l-turn',lateralCenterOffset:.625
  });
  assert.equal(structure.firstRun,4);
  assert.equal(structure.secondRun,4);
  assert.deepEqual(structure.turn,{x:14,y:20});
  assert.deepEqual(structure.platform.entry,{x:14,y:20.625});
  assert.deepEqual(structure.platform.exit,{x:15.125,y:21.75});
  assert.deepEqual(structure.visualUpper,{x:15.125,y:25.75});
});

test('generation, editing, and rendering consume the domain stair rules', async () => {
  const [generation,editing,rendering]=await Promise.all([
    readFile(new URL('../src/generation/multifloor.js',import.meta.url),'utf8'),
    readFile(new URL('../src/ui/stair-editing.js',import.meta.url),'utf8'),
    readFile(new URL('../src/render/stair-style.js',import.meta.url),'utf8')
  ]);
  assert.match(generation,/from '\.\.\/domain\/stair-contract\.js'/);
  assert.doesNotMatch(generation,/from '\.\.\/render\/stair-style\.js'/);
  assert.match(editing,/from '\.\.\/domain\/stair-contract\.js'/);
  assert.match(rendering,/from '\.\.\/domain\/stair-contract\.js'/);
  assert.doesNotMatch(generation,/function normalizeStairStyle\(/);
  assert.doesNotMatch(editing,/function normalizeStairStyle\(/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  STAIR_DIRECTIONS,
  STAIR_PLACEMENT_GRID,
  normalizeStairStyle,
  resolveStairStructure,
  snapStairGridPoint,
  snapStairWidth,
  stairLateralCenterOffset
} from '../src/domain/stair-contract.js';

test('the shared stair contract resolves style, width, turn, and platform geometry', () => {
  assert.equal(STAIR_PLACEMENT_GRID,1);
  assert.deepEqual(snapStairGridPoint({x:10.49,y:20.51}),{x:10,y:21});
  assert.equal(normalizeStairStyle('unknown'),'l-turn');
  assert.equal(snapStairWidth(2.37),2);
  assert.equal(stairLateralCenterOffset(2),.5);
  const structure=resolveStairStructure({
    lower:{x:10,y:20},direction:STAIR_DIRECTIONS.east,run:8,width:2.25,
    style:'l-turn',lateralCenterOffset:.625
  });
  assert.equal(structure.firstRun,4);
  assert.equal(structure.secondRun,4);
  assert.deepEqual(structure.turn,{x:14,y:20});
  assert.equal(structure.width,2);
  assert.equal(structure.lateralCenterOffset,.5);
  assert.deepEqual(structure.platform.entry,{x:14,y:20.5});
  assert.deepEqual(structure.platform.exit,{x:15,y:21.5});
  assert.deepEqual(structure.visualUpper,{x:15,y:25.5});
});

test('stair anchors and endpoints stay on the one metre floor-tile grid', () => {
  const structure=resolveStairStructure({
    lower:{x:10.4,y:20.6},direction:STAIR_DIRECTIONS.east,run:8,width:2,
    style:'l-turn'
  });
  assert.deepEqual(structure.lower,{x:10,y:21});
  assert.deepEqual(structure.turn,{x:14,y:21});
  assert.deepEqual(structure.anchorUpper,{x:14,y:25});
  for(const point of [structure.lower,structure.turn,structure.anchorUpper]){
    assert.equal(Number.isInteger(point.x),true);
    assert.equal(Number.isInteger(point.y),true);
  }
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

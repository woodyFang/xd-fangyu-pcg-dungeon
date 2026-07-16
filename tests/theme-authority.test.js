import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compileThemeAuthority,
  inferThemeArchetype,
  resolveThemePaletteKey,
  themePaletteKeys
} from '../src/render/theme-authority.js';

test('built-in topics have full scene authority and separate architecture families',()=>{
  const ruin=compileThemeAuthority('dungeon',{kit:'dungeon'});
  const hospital=compileThemeAuthority('hospital',{kit:'hospital'});
  assert.equal(ruin.weight,1);
  assert.equal(hospital.weight,1);
  assert.equal(ruin.id,'subterranean-palace');
  assert.equal(hospital.id,'clinical-facility');
  assert.notEqual(ruin.sceneKit,hospital.sceneKit);
  assert.notEqual(ruin.silhouette,hospital.silhouette);
  assert.ok(ruin.decorWeight>1);
  assert.ok(hospital.decorWeight>1);
});

test('topic authority constrains palettes instead of accepting an unrelated color family',()=>{
  const ruin=compileThemeAuthority('dungeon',{kit:'dungeon'});
  const hospital=compileThemeAuthority('hospital',{kit:'hospital'});
  assert.deepEqual(themePaletteKeys(ruin),['ancient','molten','frost','grim','verdant']);
  assert.deepEqual(themePaletteKeys(hospital),['sterile','abandoned','emergency']);
  assert.equal(resolveThemePaletteKey(ruin,'emergency'),'ancient');
  assert.equal(resolveThemePaletteKey(hospital,'molten'),'sterile');
  assert.equal(resolveThemePaletteKey(hospital,'emergency'),'emergency');
});

test('custom topic text inherits the nearest full scene family before neutral fallback',()=>{
  assert.equal(inferThemeArchetype({kit:'custom',label:'地下医疗站',prompt:'废弃无菌病房与手术区'}),'hospital');
  assert.equal(inferThemeArchetype({kit:'custom',label:'古代地宫',prompt:'地下宫殿石阶'}),'dungeon');
  assert.equal(inferThemeArchetype({kit:'custom',prompt:'steel pipes and mechanical factory'}),'industrial');
  assert.equal(inferThemeArchetype({kit:'custom',prompt:'wooden forest treehouse'}),'timber');
  const clinical=compileThemeAuthority('custom-clinic',{kit:'custom',prompt:'hospital ward'});
  assert.equal(clinical.sceneKit,'hospital');
  assert.equal(clinical.source,'custom');
  assert.equal(clinical.fallback,false);
  assert.equal(compileThemeAuthority('custom-unknown',{kit:'custom',prompt:'dreamlike abstract space'}).fallback,true);
});

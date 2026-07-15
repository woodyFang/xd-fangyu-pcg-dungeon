import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const preview = readFileSync(new URL('../src/gameplay/camera-preview.js', import.meta.url), 'utf8');

test('scene preview exposes dedicated first and third person choices', () => {
  assert.match(html, /id="thirdPersonPreview"/);
  assert.match(html, /id="firstPersonPreview"/);
  assert.match(html, /id="previewExit"/);
  assert.match(html, /id="previewModeBar"[\s\S]*id="editModeBtn"[\s\S]*id="previewExit"/);
  assert.doesNotMatch(html, /heroHealthFill|adventureKills|adventurePotions/);
});

test('preview cameras switch without replacing the observer camera pose', () => {
  assert.match(preview, /observerPosition\.copy\(camera\.position\)/);
  assert.match(preview, /activate\('third'\)/);
  assert.match(preview, /activate\('first'\)/);
  assert.match(preview, /camera\.position\.lerpVectors\(state\.transitionPosition, state\.observerPosition/);
  assert.match(main, /onPreviewChange:setPreviewFloorIsolation/);
});

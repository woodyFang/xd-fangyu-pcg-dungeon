import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const MOVE = new THREE.Vector3();
const FORWARD = new THREE.Vector3();
const RIGHT = new THREE.Vector3();
const DESIRED_POSITION = new THREE.Vector3();
const DESIRED_TARGET = new THREE.Vector3();
const DESIRED_QUATERNION = new THREE.Quaternion();
const LOOK_MATRIX = new THREE.Matrix4();

function standardMaterial(color, options = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.08, ...options });
}

function part(geometry, material, { x = 0, y = 0, z = 0 } = {}) {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(x, y, z);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function createPreviewCharacter() {
  const root = new THREE.Group();
  root.name = 'preview-character';
  const armor = standardMaterial(0x252b33, { metalness: 0.5, roughness: 0.38 });
  const cloth = standardMaterial(0x79221c);
  const skin = standardMaterial(0xd4aa83);
  const steel = standardMaterial(0xcbd2d8, { metalness: 0.88, roughness: 0.2 });

  const body = new THREE.Group();
  body.add(part(new THREE.CylinderGeometry(0.32, 0.4, 0.7, 8), armor, { y: 0.72 }));
  body.add(part(new THREE.ConeGeometry(0.46, 0.82, 7), cloth, { y: 0.43 }));
  body.add(part(new THREE.SphereGeometry(0.24, 12, 8), skin, { y: 1.25 }));
  body.add(part(new THREE.ConeGeometry(0.29, 0.48, 8), armor, { y: 1.43 }));
  body.add(part(new THREE.BoxGeometry(0.11, 0.12, 0.92), steel, { x: 0.46, y: 0.75, z: 0.12 }));
  body.rotation.y = Math.PI;
  root.add(body);

  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.43, 0.53, 28),
    new THREE.MeshBasicMaterial({ color: 0xe5a35d, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false })
  );
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.02;
  root.add(marker);
  root.scale.setScalar(0.68);
  root.userData.body = body;
  return root;
}

export function createDungeonPreview({ scene, camera, canvas, onPreviewChange }) {
  const previewRoot = new THREE.Group();
  previewRoot.name = 'camera-preview';
  previewRoot.visible = false;
  scene.add(previewRoot);

  const character = createPreviewCharacter();
  previewRoot.add(character);

  const state = {
    dungeon: null,
    layer: null,
    floor: 0,
    floorY: 0,
    mode: null,
    phase: 'idle',
    keys: new Set(),
    yaw: Math.PI * 0.25,
    orbitPitch: 0.54,
    lookPitch: 0,
    distance: 12.5,
    dragging: false,
    pointerX: 0,
    pointerY: 0,
    moving: false,
    transition: 0,
    observerPosition: new THREE.Vector3(),
    observerQuaternion: new THREE.Quaternion(),
    transitionPosition: new THREE.Vector3(),
    transitionQuaternion: new THREE.Quaternion(),
  };

  const ui = {
    bar: document.getElementById('previewModeBar'),
    third: document.getElementById('thirdPersonPreview'),
    first: document.getElementById('firstPersonPreview'),
    exit: document.getElementById('previewExit'),
    hud: document.getElementById('previewHud'),
    label: document.getElementById('previewModeLabel'),
    hint: document.getElementById('previewViewHint'),
  };

  const worldX = gridX => gridX - state.dungeon.W / 2 + 0.5;
  const worldZ = gridY => gridY - state.dungeon.H / 2 + 0.5;

  function findStart() {
    const rooms = state.dungeon?.rooms || [];
    const preferred = rooms[state.dungeon?.entrance];
    const room = preferred?.floor === state.floor
      ? preferred
      : rooms.find(item => item.floor === state.floor && item.type === 'entrance') || rooms.find(item => item.floor === state.floor);
    if (room) return new THREE.Vector3(worldX(room.cx), state.floorY, worldZ(room.cy));
    for (let y = 0; y < state.dungeon.H; y++) for (let x = 0; x < state.dungeon.W; x++) {
      if (state.layer.grid[y * state.dungeon.W + x] === 1) return new THREE.Vector3(worldX(x), state.floorY, worldZ(y));
    }
    return new THREE.Vector3(0, state.floorY, 0);
  }

  function walkable(x, z, radius = 0.26) {
    if (!state.layer || !state.dungeon) return false;
    const { W, H } = state.dungeon;
    return [[0, 0], [radius, 0], [-radius, 0], [0, radius], [0, -radius]].every(([ox, oz]) => {
      const gx = Math.floor(x + ox + W / 2);
      const gy = Math.floor(z + oz + H / 2);
      return gx >= 0 && gy >= 0 && gx < W && gy < H && state.layer.grid[gy * W + gx] === 1;
    });
  }

  function moveCharacter(dx, dz) {
    const nx = character.position.x + dx;
    const nz = character.position.z + dz;
    if (walkable(nx, character.position.z)) character.position.x = nx;
    if (walkable(character.position.x, nz)) character.position.z = nz;
  }

  function syncUi() {
    const active = state.phase !== 'idle';
    document.body.classList.toggle('preview-active', active);
    document.body.classList.toggle('preview-first-person', active && state.mode === 'first');
    ui.hud?.classList.toggle('on', active);
    ui.exit?.toggleAttribute('hidden', !active);
    ui.third?.classList.toggle('on', active && state.mode === 'third');
    ui.first?.classList.toggle('on', active && state.mode === 'first');
    ui.third?.setAttribute('aria-pressed', String(active && state.mode === 'third'));
    ui.first?.setAttribute('aria-pressed', String(active && state.mode === 'first'));
    if (ui.label) ui.label.textContent = state.mode === 'first' ? '第一人称预览' : '第三人称预览';
    if (ui.hint) ui.hint.textContent = state.mode === 'first' ? '以角色视线高度观察空间细节' : '跟随角色观察房间布局与动线';
  }

  function syncDungeon(dungeon, floor = 0) {
    state.dungeon = dungeon;
    if (!dungeon) return;
    state.floor = Math.max(0, Math.min((dungeon.floorCount || 1) - 1, floor));
    state.layer = dungeon.layers?.[state.floor] || dungeon;
    state.floorY = state.floor * (dungeon.floorHeight || 8);
    character.position.copy(findStart());
    character.position.y = state.floorY;
    if (state.phase !== 'idle') snapCamera();
  }

  function calculateCamera() {
    if (state.mode === 'first') {
      DESIRED_POSITION.copy(character.position).add(new THREE.Vector3(0, 0.92, 0));
      const cp = Math.cos(state.lookPitch);
      DESIRED_TARGET.copy(DESIRED_POSITION).add(new THREE.Vector3(
        -Math.sin(state.yaw) * cp,
        Math.sin(state.lookPitch),
        -Math.cos(state.yaw) * cp
      ));
    } else {
      const cp = Math.cos(state.orbitPitch);
      DESIRED_POSITION.set(
        Math.sin(state.yaw) * cp,
        Math.sin(state.orbitPitch),
        Math.cos(state.yaw) * cp
      ).multiplyScalar(state.distance).add(character.position).add(new THREE.Vector3(0, 0.72, 0));
      DESIRED_TARGET.copy(character.position).add(new THREE.Vector3(0, 0.56, 0));
    }
    LOOK_MATRIX.lookAt(DESIRED_POSITION, DESIRED_TARGET, UP);
    DESIRED_QUATERNION.setFromRotationMatrix(LOOK_MATRIX);
  }

  function snapCamera() {
    calculateCamera();
    camera.position.copy(DESIRED_POSITION);
    camera.quaternion.copy(DESIRED_QUATERNION);
  }

  function activate(mode) {
    if (!state.dungeon || !['third', 'first'].includes(mode)) return;
    if (state.phase === 'idle') {
      state.observerPosition.copy(camera.position);
      state.observerQuaternion.copy(camera.quaternion);
      previewRoot.visible = true;
      onPreviewChange?.(true);
    }
    state.transitionPosition.copy(camera.position);
    state.transitionQuaternion.copy(camera.quaternion);
    state.mode = mode;
    state.phase = 'transitioning';
    state.transition = 0;
    character.visible = mode === 'third';
    state.keys.clear();
    syncUi();
  }

  function exit() {
    if (state.phase === 'idle' || state.phase === 'exiting') return;
    state.transitionPosition.copy(camera.position);
    state.transitionQuaternion.copy(camera.quaternion);
    state.phase = 'exiting';
    state.transition = 0;
    state.keys.clear();
    syncUi();
  }

  function updateTransition(dt) {
    state.transition = Math.min(1, state.transition + dt / 0.72);
    const t = state.transition * state.transition * (3 - 2 * state.transition);
    if (state.phase === 'exiting') {
      camera.position.lerpVectors(state.transitionPosition, state.observerPosition, t);
      camera.quaternion.slerpQuaternions(state.transitionQuaternion, state.observerQuaternion, t);
      if (state.transition >= 1) {
        state.phase = 'idle';
        state.mode = null;
        previewRoot.visible = false;
        syncUi();
        onPreviewChange?.(false);
      }
      return;
    }
    calculateCamera();
    camera.position.lerpVectors(state.transitionPosition, DESIRED_POSITION, t);
    camera.quaternion.slerpQuaternions(state.transitionQuaternion, DESIRED_QUATERNION, t);
    if (state.transition >= 1) state.phase = 'active';
  }

  function update(dt, time) {
    if (state.phase === 'idle') return;
    if (state.phase === 'exiting' || state.phase === 'transitioning') {
      updateTransition(dt);
      return;
    }

    FORWARD.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw)).normalize();
    RIGHT.crossVectors(FORWARD, UP).normalize();
    MOVE.set(0, 0, 0);
    if (state.keys.has('KeyW')) MOVE.add(FORWARD);
    if (state.keys.has('KeyS')) MOVE.sub(FORWARD);
    if (state.keys.has('KeyD')) MOVE.add(RIGHT);
    if (state.keys.has('KeyA')) MOVE.sub(RIGHT);
    state.moving = MOVE.lengthSq() > 0.01;
    if (state.moving) {
      MOVE.normalize();
      const speed = state.keys.has('ShiftLeft') || state.keys.has('ShiftRight') ? 4.8 : 3.2;
      moveCharacter(MOVE.x * speed * dt, MOVE.z * speed * dt);
      const targetRotation = Math.atan2(MOVE.x, MOVE.z);
      character.rotation.y += Math.atan2(Math.sin(targetRotation - character.rotation.y), Math.cos(targetRotation - character.rotation.y)) * Math.min(1, dt * 14);
    }
    character.userData.body.position.y = state.mode === 'third' && state.moving ? Math.abs(Math.sin(time * 10)) * 0.045 : 0;

    calculateCamera();
    const smoothing = 1 - Math.exp(-dt * 10);
    camera.position.lerp(DESIRED_POSITION, smoothing);
    camera.quaternion.slerp(DESIRED_QUATERNION, smoothing);
  }

  ui.third?.addEventListener('click', () => activate('third'));
  ui.first?.addEventListener('click', () => activate('first'));
  ui.exit?.addEventListener('click', exit);

  addEventListener('keydown', event => {
    if (state.phase === 'idle') return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(event.code)) state.keys.add(event.code);
    if (event.code === 'Digit1') activate('third');
    if (event.code === 'Digit2') activate('first');
    if (event.code === 'Escape') exit();
  });
  addEventListener('keyup', event => state.keys.delete(event.code));

  canvas.addEventListener('pointerdown', event => {
    if (state.phase === 'idle' || event.button !== 2) return;
    state.dragging = true;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }, { capture: true });
  canvas.addEventListener('pointermove', event => {
    if (!state.dragging || state.phase === 'idle') return;
    const dx = event.clientX - state.pointerX;
    const dy = event.clientY - state.pointerY;
    state.yaw -= dx * 0.006;
    if (state.mode === 'first') state.lookPitch = THREE.MathUtils.clamp(state.lookPitch - dy * 0.004, -1.05, 1.05);
    else state.orbitPitch = THREE.MathUtils.clamp(state.orbitPitch + dy * 0.004, 0.28, 0.88);
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
  }, { capture: true });
  const stopDrag = () => { state.dragging = false; };
  canvas.addEventListener('pointerup', stopDrag, { capture: true });
  canvas.addEventListener('pointercancel', stopDrag, { capture: true });
  canvas.addEventListener('wheel', event => {
    if (state.phase === 'idle' || state.mode !== 'third') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    state.distance = THREE.MathUtils.clamp(state.distance * Math.exp(event.deltaY * 0.001), 9, 18);
  }, { passive: false, capture: true });

  syncUi();
  return {
    isActive: () => state.phase !== 'idle',
    isFirstPerson: () => state.phase !== 'idle' && state.mode === 'first',
    syncDungeon,
    update,
    exit,
  };
}

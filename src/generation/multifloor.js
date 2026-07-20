import {
  normalizeStairStyle,
  resolveStairStructure,
  snapStairGridPoint,
  snapStairWidth,
  stairLateralCenterOffset
} from '../domain/stair-contract.js';

// The authored world uses one grid cell = one metre. Keep the reference height
// explicit so vertical decoration and wall kits can scale with the floor
// contract instead of retaining hidden 3m assumptions.
export const FLOOR_HEIGHT = 5;
export const REFERENCE_FLOOR_HEIGHT = 3;
export const STAIR_REQUIRED_HEADROOM = 2.5;
export const CORRIDOR_WIDTH_MIN = 2;
export const CORRIDOR_WIDTH_MAX = 4;
export const CORRIDOR_WIDTH_STEP = 1;

export function normalizeCorridorWidth(value, fallback = CORRIDOR_WIDTH_MIN) {
  const numeric = Number(value);
  const base = Number.isFinite(numeric) ? numeric : fallback;
  return Math.max(CORRIDOR_WIDTH_MIN, Math.min(CORRIDOR_WIDTH_MAX, Math.round(base)));
}

const DEFAULT_TILES = Object.freeze({ VOID: 0, FLOOR: 1, WALL: 2, POOL: 3 });

const idx2 = (W, x, y) => y * W + x;
const inBounds = (W, H, x, y) => x >= 0 && y >= 0 && x < W && y < H;

function simplifyCells(cells, W) {
  if (!cells.length) return [];
  const points = [{ x: cells[0] % W, y: Math.floor(cells[0] / W) }];
  let lastDx = 0;
  let lastDy = 0;
  for (let i = 1; i < cells.length; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    const dx = (b % W) - (a % W);
    const dy = Math.floor(b / W) - Math.floor(a / W);
    if (i === 1) {
      lastDx = dx;
      lastDy = dy;
    } else if (dx !== lastDx || dy !== lastDy) {
      points.push({ x: a % W, y: Math.floor(a / W) });
      lastDx = dx;
      lastDy = dy;
    }
  }
  const end = cells[cells.length - 1];
  points.push({ x: end % W, y: Math.floor(end / W) });
  return points.filter((p, i, all) => i === 0 || p.x !== all[i - 1].x || p.y !== all[i - 1].y);
}

function rasterLine(a, b) {
  let x0 = Math.round(a.x);
  let y0 = Math.round(a.y);
  const x1 = Math.round(b.x);
  const y1 = Math.round(b.y);
  const out = [];
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  while (true) {
    out.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = error * 2;
    if (e2 >= dy) {
      error += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      error += dx;
      y0 += sy;
    }
  }
  return out;
}

function polylineCells(points, W, H) {
  const out = [];
  const seen = new Set();
  for (let i = 0; i < points.length - 1; i++) {
    for (const p of rasterLine(points[i], points[i + 1])) {
      if (!inBounds(W, H, p.x, p.y)) continue;
      const c = idx2(W, p.x, p.y);
      if (!seen.has(c)) {
        seen.add(c);
        out.push(c);
      }
    }
  }
  return out;
}

export function createLayerData(floor, W, H) {
  const total = W * H;
  return {
    floor,
    grid: new Uint8Array(total),
    roomId: new Int16Array(total).fill(-1),
    corridor: new Uint8Array(total),
    corridorOwner: new Int32Array(total).fill(-1),
    doorway: new Uint8Array(total),
    stairMask: new Uint8Array(total),
    stairwellMask: new Uint8Array(total),
    stairWallMask: new Uint8Array(total),
    stairClearance: new Uint8Array(total),
    stairLanding: new Uint8Array(total),
    slabOpening: new Uint8Array(total),
    bfs: new Int32Array(total).fill(-1),
    maxBfs: 0,
    lakeMask: new Uint8Array(total),
    props: [],
    spawns: [],
    torches: [],
    pools: [],
    lakeCells: [],
    arches: []
  };
}

export function compactRoomsByFloor({ rooms, floorCount, gap = 6, scale = 0.72, iterations = 300 }) {
  const count = Math.max(1, Math.round(floorCount || 1));
  if (count <= 1 || rooms.length < 2) return { movedRooms: 0, projectedOverlaps: 0 };

  const targetX = rooms.reduce((sum, room) => sum + room.cx, 0) / rooms.length;
  const targetY = rooms.reduce((sum, room) => sum + room.cy, 0) / rooms.length;
  const before = rooms.map(room => ({ x: room.cx, y: room.cy }));

  // Each floor is centred on the same vertical footprint, then separated only
  // against rooms on that floor. This keeps individual floors readable while
  // allowing the building to use the same x/z space at different elevations.
  for (let floor = 0; floor < count; floor++) {
    const group = rooms.filter(room => room.floor === floor);
    if (!group.length) continue;
    const meanX = group.reduce((sum, room) => sum + room.cx, 0) / group.length;
    const meanY = group.reduce((sum, room) => sum + room.cy, 0) / group.length;
    for (const room of group) {
      room.cx = targetX + (room.cx - meanX) * scale;
      room.cy = targetY + (room.cy - meanY) * scale;
    }
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    let moved = false;
    for (let i = 0; i < rooms.length; i++) {
      const a = rooms[i];
      for (let j = i + 1; j < rooms.length; j++) {
        const b = rooms[j];
        if (a.floor !== b.floor) continue;
        const overlapX = (a.w + b.w) / 2 + gap - Math.abs(a.cx - b.cx);
        if (overlapX <= 0) continue;
        const overlapY = (a.h + b.h) / 2 + gap - Math.abs(a.cy - b.cy);
        if (overlapY <= 0 || (a.locked && b.locked)) continue;
        moved = true;
        if (overlapX < overlapY) {
          const sign = a.cx <= b.cx ? -1 : 1;
          if (a.locked) b.cx -= sign * overlapX;
          else if (b.locked) a.cx += sign * overlapX;
          else {
            a.cx += sign * overlapX / 2;
            b.cx -= sign * overlapX / 2;
          }
        } else {
          const sign = a.cy <= b.cy ? -1 : 1;
          if (a.locked) b.cy -= sign * overlapY;
          else if (b.locked) a.cy += sign * overlapY;
          else {
            a.cy += sign * overlapY / 2;
            b.cy -= sign * overlapY / 2;
          }
        }
      }
    }
    if (!moved) break;
  }

  for (const room of rooms) {
    room.cx = Math.round(room.cx);
    room.cy = Math.round(room.cy);
  }
  let projectedOverlaps = 0;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const a = rooms[i];
      const b = rooms[j];
      if (a.floor === b.floor) continue;
      if (Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2) projectedOverlaps++;
    }
  }
  const movedRooms = rooms.reduce((sum, room, index) => sum + (room.cx !== Math.round(before[index].x) || room.cy !== Math.round(before[index].y) ? 1 : 0), 0);
  return { movedRooms, projectedOverlaps };
}

export function assignRoomsToFloors({ rooms, parent, entrance, boss, floorCount, preserveExisting = false }) {
  const count = Math.max(1, Math.min(6, Math.round(floorCount || 1)));
  if (preserveExisting) {
    for (const room of rooms) room.floor = Math.max(0, Math.min(count - 1, Math.round(room.floor || 0)));
    return { floorCount: count, requestedFloorCount: count, criticalPath: [] };
  }

  const reversePath = [];
  const guard = new Set();
  for (let room = boss; room >= 0 && !guard.has(room); room = parent[room]) {
    guard.add(room);
    reversePath.push(room);
    if (room === entrance) break;
  }
  const criticalPath = reversePath.reverse();
  // Graph distance from the entrance differs by at most one across every
  // edge. Mapping those depths through the critical-path bands therefore
  // guarantees that an automatically assigned edge never skips a floor.
  const usableFloorCount = Math.max(1, Math.min(count, criticalPath.length || 1));
  const pathLength = Math.max(1, criticalPath.length);
  for (const room of rooms) {
    const depth = Math.max(0, Math.round(room.depth || 0));
    room.floor = Math.min(usableFloorCount - 1, Math.floor((depth * usableFloorCount) / pathLength));
  }
  if (criticalPath.length) rooms[criticalPath[criticalPath.length - 1]].floor = usableFloorCount - 1;
  return { floorCount: usableFloorCount, requestedFloorCount: count, criticalPath };
}

export function classifyEdgesByFloor(rooms, edges) {
  const active = [];
  const removed = [];
  const errors = [];
  edges.forEach((edge, index) => {
    const a = rooms[edge.a];
    const b = rooms[edge.b];
    const difference = Math.abs(a.floor - b.floor);
    edge.id ??= index;
    if (difference === 0) {
      edge.kind = 'corridor';
      edge.floor = a.floor;
      active.push(edge);
    } else if (difference === 1) {
      edge.kind = 'stairs';
      delete edge.floor;
      active.push(edge);
    } else if (edge.isLoop && !edge.isManual) {
      removed.push(edge.id);
    } else {
      errors.push(`edge ${edge.id} crosses ${difference} floors`);
    }
  });
  return { edges: active, removed, errors };
}

export function routeAStar(layer, start, goal, options = {}) {
  const { W, H } = options;
  if (!W || !H) throw new Error('routeAStar requires W and H');
  const sx = Math.max(0, Math.min(W - 1, Math.round(start.x)));
  const sy = Math.max(0, Math.min(H - 1, Math.round(start.y)));
  const gx = Math.max(0, Math.min(W - 1, Math.round(goal.x)));
  const gy = Math.max(0, Math.min(H - 1, Math.round(goal.y)));
  const startIndex = idx2(W, sx, sy);
  const goalIndex = idx2(W, gx, gy);
  const total = W * H;
  const startRoomId = options.startRoomId ?? -1;
  const goalRoomId = options.goalRoomId ?? -1;
  const allowStairs = !!options.allowStairs;
  const blockedCells=options.blockedCells instanceof Set
    ? options.blockedCells
    : new Set(options.blockedCells || []);
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const directionCount = directions.length;
  const stateCount = total * directionCount;
  const corridorCost = options.corridorCost ?? 0.75;
  const turnCost = options.turnCost ?? 0.85;
  const reverseCost = options.reverseCost ?? 1.5;
  const gScore = new Float64Array(stateCount);
  gScore.fill(Infinity);
  const parent = new Int32Array(stateCount).fill(-1);
  const closed = new Uint8Array(stateCount);
  const heap = [];
  const push = (node, score) => {
    const entry = { node, score };
    heap.push(entry);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].score <= entry.score) break;
      heap[i] = heap[p];
      i = p;
    }
    heap[i] = entry;
  };
  const pop = () => {
    const first = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let best = i;
        if (left < heap.length && heap[left].score < heap[best].score) best = left;
        if (right < heap.length && heap[right].score < heap[best].score) best = right;
        if (best === i) break;
        [heap[i], heap[best]] = [heap[best], heap[i]];
        i = best;
      }
    }
    return first;
  };
  // Door approach rewards can lower an individual step to 0.35, which is the
  // admissible Manhattan lower bound. Direction is part of the search state so
  // two arrivals at one tile can retain different future turn costs.
  const heuristic = (x, y) => (Math.abs(x - gx) + Math.abs(y - gy)) * 0.35;
  for (let direction = 0; direction < directionCount; direction++) {
    const state = startIndex * directionCount + direction;
    gScore[state] = 0;
    push(state, heuristic(sx, sy));
  }
  let goalState = -1;
  let guardCount = 0;
  while (heap.length && guardCount++ < stateCount * 4) {
    const currentState = pop().node;
    if (closed[currentState]) continue;
    closed[currentState] = 1;
    const current = Math.floor(currentState / directionCount);
    const previousDirection = currentState % directionCount;
    if (current === goalIndex) {
      goalState = currentState;
      break;
    }
    const cx = current % W;
    const cy = Math.floor(current / W);
    for (let direction = 0; direction < directionCount; direction++) {
      const [dx, dy] = directions[direction];
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(W, H, nx, ny)) continue;
      const next = idx2(W, nx, ny);
      const nextState = next * directionCount + direction;
      // stairwellMask is the regular rectangular architectural envelope. Its
      // filler corners are ordinary walkable floor, so only physical treads,
      // landings, clear volume and slab openings are hard routing obstacles.
      const stairWallRestricted=!!layer.stairWallMask?.[next];
      const stairRestricted = layer.stairMask?.[next] || layer.stairClearance?.[next]
        || layer.stairLanding?.[next] || layer.slabOpening?.[next];
      const contractRestricted=blockedCells.has(next) && next!==goalIndex && next!==startIndex;
      if (closed[nextState] || stairWallRestricted || contractRestricted
          || (!allowStairs && stairRestricted && next !== goalIndex && next !== startIndex)) continue;
      const roomId = layer.roomId[next];
      let step = layer.corridor[next] ? corridorCost : 1;
      if (Number.isInteger(options.preferredRoomId)
          && roomId !== options.preferredRoomId && !layer.corridor[next]) step += 8;
      if (roomId >= 0 && roomId !== startRoomId && roomId !== goalRoomId) step += 25;
      else if (roomId >= 0) step += 2.5;
      if (Math.abs(nx - sx) + Math.abs(ny - sy) <= 4 || Math.abs(nx - gx) + Math.abs(ny - gy) <= 4) {
        step = Math.max(0.35, step - 0.4);
      }
      if (direction !== previousDirection) {
        const [pdx, pdy] = directions[previousDirection];
        step += dx === -pdx && dy === -pdy ? reverseCost : turnCost;
      }
      const nextScore = gScore[currentState] + step;
      if (nextScore < gScore[nextState]) {
        gScore[nextState] = nextScore;
        parent[nextState] = currentState;
        push(nextState, nextScore + heuristic(nx, ny));
      }
    }
  }
  if (goalState < 0) return null;
  const cells = [];
  for (let state = goalState; state >= 0; state = parent[state]) {
    const cell = Math.floor(state / directionCount);
    cells.push(cell);
    if (cell === startIndex) break;
  }
  if (cells[cells.length - 1] !== startIndex) return null;
  cells.reverse();
  return { cells, points: simplifyCells(cells, W), cost: gScore[goalState] };
}

function roomDoorPoint(a, b, margin = 1) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const halfWidth = Math.max(1, a.w / 2 - margin);
  const halfHeight = Math.max(1, a.h / 2 - margin);
  if (Math.abs(dx) / halfWidth >= Math.abs(dy) / halfHeight) {
    return {
      x: Math.round(a.cx + (dx >= 0 ? halfWidth : -halfWidth)),
      y: Math.round(a.cy + Math.max(-halfHeight, Math.min(halfHeight, dy))),
      side: dx >= 0 ? 'e' : 'w'
    };
  }
  return {
    x: Math.round(a.cx + Math.max(-halfWidth, Math.min(halfWidth, dx))),
    y: Math.round(a.cy + (dy >= 0 ? halfHeight : -halfHeight)),
    side: dy >= 0 ? 's' : 'n'
  };
}

function widthOffsets(width, lateralCenterOffset) {
  const count=Math.max(1,Math.ceil(width));
  const first=Number.isFinite(Number(lateralCenterOffset))
    ? Math.round(Number(lateralCenterOffset)-(count-1)/2)
    : -Math.floor((count-1)/2);
  return Array.from({length:count},(_,index)=>first+index);
}

function stampCell(layer, W, H, x, y, width, owner, tiles) {
  for (const ox of widthOffsets(width)) {
    for (const oy of widthOffsets(width)) {
      const nx = x + ox;
      const ny = y + oy;
      if (!inBounds(W, H, nx, ny)) continue;
      const cell = idx2(W, nx, ny);
      // The rectangular envelope can contain walkable filler corners. Protect
      // only physical stair geometry when widening a corridor through it.
      if (layer.stairMask?.[cell] || layer.stairWallMask?.[cell] || layer.stairClearance?.[cell]
          || layer.stairLanding?.[cell] || layer.slabOpening?.[cell]) continue;
      layer.grid[cell] = tiles.FLOOR;
      layer.corridor[cell] = 1;
      if (layer.corridorOwner[cell] < 0) layer.corridorOwner[cell] = owner;
    }
  }
}

function carveCells(layer, cells, W, H, width, owner, tiles) {
  for (const cell of cells) stampCell(layer, W, H, cell % W, Math.floor(cell / W), width, owner, tiles);
}

function carvePolyline(layer, points, W, H, width, owner, tiles) {
  carveCells(layer, polylineCells(points, W, H), W, H, width, owner, tiles);
}

function doorNormal(point) {
  return point.side === 'e' ? { x: 1, y: 0 }
    : point.side === 'w' ? { x: -1, y: 0 }
    : point.side === 's' ? { x: 0, y: 1 }
    : { x: 0, y: -1 };
}

function markDoor(layer, W, H, point, width = 1) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  const normal = doorNormal(point);
  const tangent = normal.y !== 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
  for (const offset of widthOffsets(Math.max(1, Math.min(CORRIDOR_WIDTH_MAX, Math.round(width))))) {
    const dx = x + tangent.x * offset;
    const dy = y + tangent.y * offset;
    if (inBounds(W, H, dx, dy)) layer.doorway[idx2(W, dx, dy)] = 1;
  }
}

function doorApproach(point, depth = 2) {
  const normal = doorNormal(point);
  return {
    x: Math.round(point.x) + normal.x * depth,
    y: Math.round(point.y) + normal.y * depth
  };
}

function roomBoundaryRange(room, side) {
  const x0 = Math.ceil(room.cx - room.w / 2);
  const x1 = Math.floor(room.cx + room.w / 2);
  const y0 = Math.ceil(room.cy - room.h / 2);
  const y1 = Math.floor(room.cy + room.h / 2);
  if (side === 'n' || side === 's') return { min: x0, max: x1, fixed: side === 'n' ? y0 : y1 };
  return { min: y0, max: y1, fixed: side === 'w' ? x0 : x1 };
}

function doorNormalForSide(side) {
  return side === 'e' ? { x: 1, y: 0 }
    : side === 'w' ? { x: -1, y: 0 }
    : side === 's' ? { x: 0, y: 1 }
    : { x: 0, y: -1 };
}

function resolveWallDoor(layer, W, H, room, preferred, fallback, width, allowSideFallback = false) {
  if (!room || !layer) return null;
  const validSides = ['n', 's', 'w', 'e'];
  const requestedSide = validSides.includes(preferred?.side) ? preferred.side
    : (validSides.includes(fallback?.side) ? fallback.side : null);
  if (!requestedSide) return null;
  const sides = allowSideFallback
    ? [requestedSide, ...validSides.filter(side => side !== requestedSide)]
    : [requestedSide];
  const span = widthOffsets(normalizeCorridorWidth(width));
  const preferredTangent = side => {
    const value = side === 'n' || side === 's' ? preferred?.x : preferred?.y;
    return Number.isFinite(value) ? value : (side === 'n' || side === 's' ? room.cx : room.cy);
  };
  const insideCell = (roomId, x, y) => inBounds(W, H, x, y) && layer.roomId[idx2(W, x, y)] === roomId;
  const outsideRayIsOpen = (x, y, normal) => {
    for(let depth=1;depth<=2;depth++){
      const nx=x+normal.x*depth,ny=y+normal.y*depth;
      if (!inBounds(W, H, nx, ny)) return false;
      const cell = idx2(W, nx, ny);
      const hardStair=layer.stairMask?.[cell] || layer.stairWallMask?.[cell] || layer.stairClearance?.[cell]
        || layer.stairLanding?.[cell] || layer.slabOpening?.[cell];
      const reusedDoorway = depth===1 && layer.corridor[cell]
        && layer.doorway[idx2(W, x, y)];
      const openSurface=layer.grid[cell]===DEFAULT_TILES.VOID || reusedDoorway;
      if(layer.roomId[cell]>=0 || hardStair || !openSurface) return false;
    }
    return true;
  };
  for (const side of sides) {
    const range = roomBoundaryRange(room, side);
    if (range.max < range.min) continue;
    const target = Math.max(range.min, Math.min(range.max, Math.round(preferredTangent(side))));
    const candidates = [];
    for (let tangent = range.min; tangent <= range.max; tangent++) candidates.push(tangent);
    candidates.sort((a, b) => Math.abs(a - target) - Math.abs(b - target) || a - b);
    const normal = doorNormalForSide(side);
    for (const tangent of candidates) {
      const point = side === 'n' || side === 's'
        ? { x: tangent, y: range.fixed, side }
        : { x: range.fixed, y: tangent, side };
      const legal = span.every(offset => {
        const x = point.x + (normal.y !== 0 ? offset : 0);
        const y = point.y + (normal.x !== 0 ? offset : 0);
        return insideCell(room.id, x, y) && outsideRayIsOpen(x, y, normal);
      });
      if (legal) return point;
    }
  }
  return null;
}

function resolveArchInterface(layer, W, H, room, point, width) {
  const len = normalizeCorridorWidth(width);
  const normal = doorNormalForSide(point.side);
  const tangent = normal.y !== 0 ? { x: 1, y: 0 } : { x: 0, y: 1 };
  const anchorX = Math.round(point.x);
  const anchorY = Math.round(point.y);
  const offsets = widthOffsets(len);
  const centerOffset = (offsets[0] + offsets[offsets.length - 1]) / 2;
  const interfaces = [];
  for (const offset of offsets) {
    let roomX = anchorX + tangent.x * offset;
    let roomY = anchorY + tangent.y * offset;
    if (!inBounds(W, H, roomX, roomY) || layer.roomId[idx2(W, roomX, roomY)] !== room.id) return null;
    for (let step = 0; step < Math.max(W, H); step++) {
      const nextX = roomX + normal.x;
      const nextY = roomY + normal.y;
      if (!inBounds(W, H, nextX, nextY) || layer.roomId[idx2(W, nextX, nextY)] !== room.id) break;
      roomX = nextX;
      roomY = nextY;
    }
    const outsideX = roomX + normal.x;
    const outsideY = roomY + normal.y;
    if (!inBounds(W, H, outsideX, outsideY)) return null;
    interfaces.push({ roomX, roomY, x: roomX + normal.x * 0.5, y: roomY + normal.y * 0.5 });
  }
  if (!interfaces.length) return null;
  const first = interfaces[0];
  const normalCoordinate = item => normal.x !== 0 ? item.x : item.y;
  if (interfaces.some(item => normalCoordinate(item) !== normalCoordinate(first))) return null;
  const centerX = anchorX + tangent.x * centerOffset;
  const centerY = anchorY + tangent.y * centerOffset;
  return {
    wallCellX: tangent.x ? centerX : first.roomX,
    wallCellY: tangent.y ? centerY : first.roomY,
    interfaceX: normal.x ? first.x : centerX,
    interfaceY: normal.y ? first.y : centerY
  };
}

function addResolvedArch(layer, room, point, width, W, H) {
  if (!layer || !room || !point) return;
  const corridorWidth = normalizeCorridorWidth(width);
  const normal = doorNormalForSide(point.side);
  const px = normal.y !== 0 ? 1 : 0;
  const py = px ? 0 : 1;
  const isDoubleDoor = corridorWidth === 4;
  const unitWidth = isDoubleDoor ? 2 : corridorWidth;
  // A resolved point is already the anchor cell used by the raster contract;
  // only the two-unit 4m opening needs to split that anchor into two starts.
  const unitStarts = isDoubleDoor ? [-1, 1] : [0];
  for (let unitIndex = 0; unitIndex < unitStarts.length; unitIndex++) {
    const startOffset = unitStarts[unitIndex];
    const unitPoint = {
      ...point,
      x: point.x + (normal.y !== 0 ? startOffset : 0),
      y: point.y + (normal.x !== 0 ? startOffset : 0)
    };
    const offsets = widthOffsets(unitWidth);
    const centerOffset = (offsets[0] + offsets[offsets.length - 1]) / 2;
    const key = `${room.id}:${point.side}:${point.x}:${point.y}:${corridorWidth}:${unitIndex}`;
    if (layer.arches.some(arch => arch._doorKey === key)) continue;
    const interfaceInfo = resolveArchInterface(layer, W, H, room, unitPoint, unitWidth);
    layer.arches.push({
      x: unitPoint.x + px * centerOffset,
      y: unitPoint.y + py * centerOffset,
      px,
      py,
      len: unitWidth,
      corridorWidth,
      doorUnitWidth: unitWidth,
      doorUnitHeight: 2,
      doorUnitIndex: unitIndex,
      doorUnitCount: unitStarts.length,
      // The first 2m frame owns the shared centre post. The second frame
      // supplies only its lintel and outer post, avoiding a doubled mullion.
      suppressLeadingPost: isDoubleDoor && unitIndex === 1,
      roomId: room.id,
      floor: room.floor || 0,
      side: point.side,
      anchorX: unitPoint.x,
      anchorY: unitPoint.y,
      nx: normal.x,
      ny: normal.y,
      ...(interfaceInfo || {}),
      _doorKey: key
    });
  }
}

function rasterizeRooms(layers, rooms, W, H, tiles) {
  for (const room of rooms) {
    const layer = layers[room.floor];
    if (!layer) continue;
    const x0 = Math.max(0, Math.floor(room.cx - room.w / 2));
    const x1 = Math.min(W - 1, Math.ceil(room.cx + room.w / 2));
    const y0 = Math.max(0, Math.floor(room.cy - room.h / 2));
    const y1 = Math.min(H - 1, Math.ceil(room.cy + room.h / 2));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (Math.abs(x - room.cx) > Math.max(1, room.w / 2) || Math.abs(y - room.cy) > Math.max(1, room.h / 2)) continue;
        const cell = idx2(W, x, y);
        layer.grid[cell] = tiles.FLOOR;
        layer.roomId[cell] = room.id;
      }
    }
  }
}

function edgePriority(edge) {
  // A stair is a shared vertical structure, not an ordinary manual route.
  // Reserve its well on both floors before any corridor gets a chance to use
  // that footprint; later A* routes then naturally build around the opening.
  if (edge.kind === 'stairs') return edge.isCritical ? -2 : -1;
  if (edge.isManual) return 3;
  if (edge.isCritical) return 0;
  if (!edge.isLoop) return 1;
  return 2;
}

function stairStripCells(W, H, from, direction, firstStep, lastStep, width, lateralCenterOffset) {
  const cells = [];
  const perpendicular = { x: -direction.y, y: direction.x };
  for (let step = firstStep; step <= lastStep; step++) {
    for (const offset of widthOffsets(width,lateralCenterOffset)) {
      const x = from.x + direction.x * step + perpendicular.x * offset;
      const y = from.y + direction.y * step + perpendicular.y * offset;
      if (!inBounds(W, H, x, y)) return null;
      cells.push(idx2(W, x, y));
    }
  }
  return cells;
}

function stairwellWidthOffsets(width, sideClearance = 1, lateralCenterOffset) {
  const base = widthOffsets(width,lateralCenterOffset);
  const clearance = Math.max(0, Math.round(sideClearance));
  const first = Math.min(...base) - clearance;
  const last = Math.max(...base) + clearance;
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function stairStripCellsWithOffsets(W, H, from, direction, firstStep, lastStep, offsets) {
  const cells = [];
  const perpendicular = { x: -direction.y, y: direction.x };
  for (let step = firstStep; step <= lastStep; step++) {
    for (const offset of offsets) {
      const x = from.x + direction.x * step + perpendicular.x * offset;
      const y = from.y + direction.y * step + perpendicular.y * offset;
      if (!inBounds(W, H, x, y)) return null;
      cells.push(idx2(W, x, y));
    }
  }
  return cells;
}

function uniqueCells(...groups) {
  return [...new Set(groups.flat())];
}

export function rectangularCellEnvelope(cells, W, H) {
  if (!Array.isArray(cells) || !cells.length || !Number.isInteger(W) || W <= 0 || !Number.isInteger(H) || H <= 0) return [];
  let minX=W-1,maxX=0,minY=H-1,maxY=0;
  for(const cell of cells){
    const x=cell%W,y=Math.floor(cell/W);
    if(!inBounds(W,H,x,y)) continue;
    minX=Math.min(minX,x); maxX=Math.max(maxX,x);
    minY=Math.min(minY,y); maxY=Math.max(maxY,y);
  }
  const envelope=[];
  for(let y=minY;y<=maxY;y++) for(let x=minX;x<=maxX;x++) envelope.push(idx2(W,x,y));
  return envelope;
}

function visualPlatformCells(W, H, platform) {
  if(!platform) return null;
  const firstX=Math.ceil(platform.center.x-platform.visualSpan/2-1e-9);
  const firstY=Math.ceil(platform.center.y-platform.visualSpan/2-1e-9);
  const cells=[];
  for(let y=firstY;y<firstY+platform.gridSpan;y++) for(let x=firstX;x<firstX+platform.gridSpan;x++){
    if(!inBounds(W,H,x,y)) return null;
    cells.push(idx2(W,x,y));
  }
  return cells;
}

function visualStripCells(W, H, start, end, width) {
  if(!start || !end) return null;
  const span=Math.max(1,Math.ceil(width));
  const cells=[];
  if(Math.abs(end.x-start.x)>=Math.abs(end.y-start.y)){
    const firstX=Math.ceil(Math.min(start.x,end.x)-1e-9);
    const lastX=Math.ceil(Math.max(start.x,end.x)-1e-9)-1;
    const centerY=(start.y+end.y)/2;
    const firstY=Math.ceil(centerY-width/2-1e-9);
    for(let y=firstY;y<firstY+span;y++) for(let x=firstX;x<=lastX;x++){
      if(!inBounds(W,H,x,y)) return null;
      cells.push(idx2(W,x,y));
    }
  }else{
    const firstY=Math.ceil(Math.min(start.y,end.y)-1e-9);
    const lastY=Math.ceil(Math.max(start.y,end.y)-1e-9)-1;
    const centerX=(start.x+end.x)/2;
    const firstX=Math.ceil(centerX-width/2-1e-9);
    for(let y=firstY;y<=lastY;y++) for(let x=firstX;x<firstX+span;x++){
      if(!inBounds(W,H,x,y)) return null;
      cells.push(idx2(W,x,y));
    }
  }
  return cells;
}

function visualUpperCell(point, direction) {
  const alongCell=(value,axis)=>axis>0
    ? Math.ceil(value-1e-9)
    : (axis<0 ? Math.floor(value+1e-9) : Math.round(value));
  return {x:alongCell(point.x,direction.x),y:alongCell(point.y,direction.y)};
}

function stairSweptClearanceCells({
  firstFlightCells,
  turnCells,
  secondFlightCells,
  lower,
  direction,
  firstRun,
  secondDirection,
  secondRun,
  style,
  W,
  requiredHeadroom = STAIR_REQUIRED_HEADROOM
}) {
  // Preserve the complete per-cell vertical clearance column. The slab
  // opening is only one derived slice of this volume; fixtures, ceilings and
  // validation need the whole swept headroom, including low treads that stay
  // below the upper floor plane.
  const cellPoint = cell => ({ x:cell % W, y:Math.floor(cell / W) });
  const projectedDistance = (cell, origin, axis) => {
    const point=cellPoint(cell);
    return (point.x-origin.x)*axis.x+(point.y-origin.y)*axis.y;
  };
  const firstHeightFraction = cell => {
    const run=Math.max(1,firstRun);
    // Use the tread cell's high edge so a cell is opened as soon as any part
    // of its walking surface needs to pass through the upper slab.
    return Math.max(0,Math.min(style==='l-turn' ? .5 : 1,
      ((projectedDistance(cell,lower,direction)+.5)/run)*(style==='l-turn' ? .5 : 1)));
  };
  const secondOrigin = style==='l-turn'
    ? {
      x:lower.x+direction.x*firstRun,
      y:lower.y+direction.y*firstRun
    }
    : null;
  const secondHeightFraction = cell => {
    const run=Math.max(1,secondRun);
    return Math.max(.5,Math.min(1,
      .5+((projectedDistance(cell,secondOrigin,secondDirection)+.5)/run)*.5));
  };
  const elevations=new Map();
  const record=(cells,heightFraction)=>{
    for(const cell of cells || []){
      const elevation=typeof heightFraction==='function' ? heightFraction(cell)*FLOOR_HEIGHT : heightFraction*FLOOR_HEIGHT;
      elevations.set(cell,Math.max(elevations.get(cell) ?? -Infinity,elevation));
    }
  };
  record(firstFlightCells,firstHeightFraction);
  if(style==='l-turn'){
    record(turnCells,.5);
    record(secondFlightCells,secondHeightFraction);
  }
  return [...elevations].sort((a,b)=>a[0]-b[0]).map(([cell,treadElevation])=>{
    const clearanceTop=treadElevation+requiredHeadroom;
    // Once a tread has reached the upper floor plane it is the arrival
    // surface, not empty shaft volume. Keep that cell as upper landing floor;
    // only lower treads whose headroom crosses the slab need a real opening.
    const belowUpperFloor=treadElevation<FLOOR_HEIGHT-1e-9;
    return {
      cell,
      treadElevation:Number(treadElevation.toFixed(6)),
      clearanceTop:Number(clearanceTop.toFixed(6)),
      intersectsUpperSlab:belowUpperFloor&&clearanceTop>FLOOR_HEIGHT+1e-9
    };
  });
}

function stairOpeningCells(clearanceCells) {
  // A slab opening is the intersection between the complete swept clearance
  // volume and the upper slab plane.
  return (clearanceCells || []).filter(record=>record.intersectsUpperSlab).map(record=>record.cell);
}

function stairLightingAnchors({lower,direction,secondDirection,firstRun,secondRun,style,turnPlatform}) {
  const anchor=(id,origin,axis,distance,elevationFraction)=>({
    id,
    x:origin.x+axis.x*distance,
    y:origin.y+axis.y*distance,
    elevationFraction,
    direction:{x:axis.x,y:axis.y}
  });
  if(style==='straight'){
    return [
      anchor('lower-flight',lower,direction,firstRun*.3,.3),
      anchor('upper-flight',lower,direction,firstRun*.72,.72)
    ];
  }
  return [
    anchor('lower-flight',turnPlatform.first.start,direction,firstRun*.38,.24),
    {id:'turn-platform',x:turnPlatform.center.x,y:turnPlatform.center.y,elevationFraction:.5,
      direction:{x:secondDirection.x,y:secondDirection.y}},
    anchor('upper-flight',turnPlatform.second.start,secondDirection,secondRun*.62,.78)
  ];
}

function openingBoundaryEdges(openingCells, upperLandingCells, headroomCells, accessDirection, W, H) {
  const opening=new Set(openingCells);
  const landing=new Set(upperLandingCells);
  const headroom=new Set(headroomCells);
  const edges=[];
  const sides=[
    {dx:-1,dy:0,edge:(x,y)=>({x1:x-.5,y1:y-.5,x2:x-.5,y2:y+.5})},
    {dx:1,dy:0,edge:(x,y)=>({x1:x+.5,y1:y-.5,x2:x+.5,y2:y+.5})},
    {dx:0,dy:-1,edge:(x,y)=>({x1:x-.5,y1:y-.5,x2:x+.5,y2:y-.5})},
    {dx:0,dy:1,edge:(x,y)=>({x1:x-.5,y1:y+.5,x2:x+.5,y2:y+.5})}
  ];
  for(const cell of openingCells){
    const x=cell%W,y=Math.floor(cell/W);
    for(const side of sides){
      const nx=x+side.dx,ny=y+side.dy;
      const neighborCell=inBounds(W,H,nx,ny)?idx2(W,nx,ny):-1;
      if(neighborCell>=0&&opening.has(neighborCell)) continue;
      edges.push({
        ...side.edge(x,y),
        openingCell:cell,
        neighborCell,
        access:neighborCell>=0&&landing.has(neighborCell)
          && side.dx===accessDirection.x&&side.dy===accessDirection.y,
        // A headroom-tight opening has a second mandatory open edge where the
        // rising flight passes from beneath the retained upper slab into the
        // opening. Treating that transverse edge as an ordinary exposed slab
        // boundary produces a guard beam straight across the stair path.
        stairPassage:neighborCell>=0&&headroom.has(neighborCell)
          && side.dx===-accessDirection.x&&side.dy===-accessDirection.y
      });
    }
  }
  return edges;
}

function stairwellBoundaryEdges(footprintCells, lowerLandingCells, upperLandingCells, direction, upperDirection, W, H, structuralEnvelopeCells = footprintCells) {
  const footprint=new Set(footprintCells);
  const structuralEnvelope=new Set(structuralEnvelopeCells || footprintCells);
  const envelopeXs=[...structuralEnvelope].map(cell=>cell%W);
  const envelopeYs=[...structuralEnvelope].map(cell=>Math.floor(cell/W));
  const envelopeBounds={
    minX:Math.min(...envelopeXs),maxX:Math.max(...envelopeXs),
    minY:Math.min(...envelopeYs),maxY:Math.max(...envelopeYs)
  };
  const lowerLanding=new Set(lowerLandingCells);
  const upperLanding=new Set(upperLandingCells);
  const lowerOut={x:-direction.x,y:-direction.y};
  const edges=[];
  const sides=[
    {dx:-1,dy:0,edge:(x,y)=>({x1:x-.5,y1:y-.5,x2:x-.5,y2:y+.5})},
    {dx:1,dy:0,edge:(x,y)=>({x1:x+.5,y1:y-.5,x2:x+.5,y2:y+.5})},
    {dx:0,dy:-1,edge:(x,y)=>({x1:x-.5,y1:y-.5,x2:x+.5,y2:y-.5})},
    {dx:0,dy:1,edge:(x,y)=>({x1:x-.5,y1:y+.5,x2:x+.5,y2:y+.5})}
  ];
  for(const cell of footprintCells){
    const x=cell%W,y=Math.floor(cell/W);
    for(const side of sides){
      const nx=x+side.dx,ny=y+side.dy;
      const neighborCell=inBounds(W,H,nx,ny)?idx2(W,nx,ny):-1;
      if(neighborCell>=0&&footprint.has(neighborCell)) continue;
      const directionMatchesStructuralSpine=direction.x===upperDirection.x&&direction.y===upperDirection.y
        // A wall-backed straight stair owns one deterministic side only. The
        // opposite side is a mandatory open edge with a guardrail.
        ? side.dx===-direction.y&&side.dy===direction.x
        : (side.dx===-upperDirection.x&&side.dy===-upperDirection.y)
          || (side.dx===direction.x&&side.dy===direction.y);
      const neighborInsideEnvelope=neighborCell>=0&&structuralEnvelope.has(neighborCell);
      const onOuterEnvelopeSide=side.dx<0 ? nx===envelopeBounds.minX
        : side.dx>0 ? nx===envelopeBounds.maxX
          : side.dy<0 ? ny===envelopeBounds.minY
            : ny===envelopeBounds.maxY;
      edges.push({
        ...side.edge(x,y),insideCell:cell,neighborCell,
        normal:{x:side.dx,y:side.dy},
        // Direction alone cannot distinguish an L stair's exterior spine from
        // the parallel transverse seam at its concave turn. A structural wall
        // inside the reserved envelope must also sit on that envelope's outer
        // band; otherwise it is transition-open and must never divide the two
        // flights or their turn platform.
        structuralSpine:directionMatchesStructuralSpine
          && (!neighborInsideEnvelope||onOuterEnvelopeSide),
        lowerAccess:lowerLanding.has(cell)&&side.dx===lowerOut.x&&side.dy===lowerOut.y,
        upperAccess:upperLanding.has(cell)&&side.dx===upperDirection.x&&side.dy===upperDirection.y
      });
    }
  }
  return edges;
}

function buildStairContract(W, H, lower, direction, run, width, landingDepth, sideClearance = 1, requestedStyle = 'l-turn', lateralCenterOffset) {
  const structure=resolveStairStructure({lower,direction,run,width,style:requestedStyle,lateralCenterOffset});
  const {style,turn,secondDirection,firstRun,secondRun}=structure;
  const turnPlatform=structure.platform;
  const upper=turnPlatform
    ? visualUpperCell(turnPlatform.second.end,secondDirection)
    : structure.anchorUpper;
  const lowerApproach = { x: lower.x - direction.x * landingDepth, y: lower.y - direction.y * landingDepth };
  const upperApproach = { x: upper.x + secondDirection.x * landingDepth, y: upper.y + secondDirection.y * landingDepth };
  // The approach is a directional socket, not a routing hint. Routes stop one
  // cell outside the socket and cross its gate only along the flight axis.
  // This prevents a corridor from entering either landing from the side.
  const lowerApproachGate={x:lowerApproach.x-direction.x,y:lowerApproach.y-direction.y};
  const upperApproachGate={x:upperApproach.x+secondDirection.x,y:upperApproach.y+secondDirection.y};
  const lowerApproachRouteCell={x:lowerApproachGate.x-direction.x,y:lowerApproachGate.y-direction.y};
  const upperApproachRouteCell={x:upperApproachGate.x+secondDirection.x,y:upperApproachGate.y+secondDirection.y};
  const firstFlightCells = stairStripCells(W, H, lower, direction, 1, firstRun - 1, width,lateralCenterOffset);
  const secondFlightCells = style==='l-turn'
    ? visualStripCells(W,H,turnPlatform.exit,turnPlatform.second.end,width) : [];
  const turnCells=style==='l-turn' ? visualPlatformCells(W,H,turnPlatform) : [];
  const shaftCells = firstFlightCells && secondFlightCells && turnCells
    ? uniqueCells(firstFlightCells,turnCells,secondFlightCells) : null;
  const lowerLandingCells = stairStripCells(W, H, lower, direction, -landingDepth, 0, width,lateralCenterOffset);
  const rawUpperLandingCells = turnPlatform
    ? visualStripCells(W,H,{
      x:turnPlatform.second.end.x-secondDirection.x,
      y:turnPlatform.second.end.y-secondDirection.y
    },{
      x:turnPlatform.second.end.x+secondDirection.x*(landingDepth+1),
      y:turnPlatform.second.end.y+secondDirection.y*(landingDepth+1)
    },width)
    : stairStripCells(W, H, upper, secondDirection, 0, landingDepth, width,lateralCenterOffset);
  const lowerApproachGateCells=stairStripCells(W,H,lowerApproachGate,direction,0,0,width,lateralCenterOffset);
  const upperApproachGateCells=stairStripCells(W,H,upperApproachGate,secondDirection,0,0,width,lateralCenterOffset);
  const lowerApproachRouteCells=stairStripCells(W,H,lowerApproachRouteCell,direction,0,0,width,lateralCenterOffset);
  const upperApproachRouteCells=stairStripCells(W,H,upperApproachRouteCell,secondDirection,0,0,width,lateralCenterOffset);
  const footprintOffsets=stairwellWidthOffsets(width,sideClearance,lateralCenterOffset);
  const firstFootprint=stairStripCellsWithOffsets(W,H,lower,direction,-landingDepth,firstRun,footprintOffsets);
  const secondFootprint=style==='l-turn'
    ? visualStripCells(W,H,turnPlatform.exit,{
      x:turnPlatform.second.end.x+secondDirection.x*landingDepth,
      y:turnPlatform.second.end.y+secondDirection.y*landingDepth
    },width+Math.max(0,Math.round(sideClearance))*2)
    : stairStripCellsWithOffsets(W,H,upper,secondDirection,0,landingDepth,footprintOffsets);
  const rawFootprintCells = firstFootprint && secondFootprint
    ? uniqueCells(firstFootprint,secondFootprint) : null;
  const sweptClearanceCells=shaftCells ? stairSweptClearanceCells({
    firstFlightCells,turnCells,secondFlightCells,lower,direction,firstRun,
    secondDirection,secondRun,style,W
  }) : null;
  const slabOpeningCells=sweptClearanceCells ? stairOpeningCells(sweptClearanceCells) : null;
  const openingSet=new Set(slabOpeningCells || []);
  // Rasterized L flights can contain one or more cells whose tread has already
  // reached the upper floor plane. They are the arrival platform that closes
  // the former over-cut portion of the shaft and must participate in the
  // upper access socket and opening-boundary classification.
  const upperArrivalCells=(sweptClearanceCells || [])
    .filter(record=>record.treadElevation>=FLOOR_HEIGHT-1e-9)
    .map(record=>record.cell);
  const upperLandingCells=rawUpperLandingCells
    ? uniqueCells(rawUpperLandingCells,upperArrivalCells).filter(cell=>!openingSet.has(cell))
    : null;
  const lowerApproachCells=lowerLandingCells&&lowerApproachGateCells
    ? uniqueCells(lowerLandingCells,lowerApproachGateCells) : null;
  const upperApproachCells=upperLandingCells&&upperApproachGateCells
    ? uniqueCells(upperLandingCells,upperApproachGateCells) : null;
  const stairwellInteriorCells=shaftCells&&lowerLandingCells&&upperLandingCells
    ? uniqueCells(lowerLandingCells,shaftCells,upperLandingCells) : null;
  // The reservation must contain the complete visible stairwell interior, not
  // only the two conservative footprint strips. For some west/north L stairs
  // the visual turn platform extends one cell beyond those strips; omitting it
  // allowed a later stair to overwrite an existing upper-floor opening.
  const sharedFootprintCells=rawFootprintCells&&stairwellInteriorCells
    ? rectangularCellEnvelope(uniqueCells(rawFootprintCells,stairwellInteriorCells),W,H)
    : null;
  const boundaryEdges=slabOpeningCells&&upperLandingCells&&sweptClearanceCells
    ? openingBoundaryEdges(slabOpeningCells,upperLandingCells,
      sweptClearanceCells.map(record=>record.cell),secondDirection,W,H) : null;
  const stairwellEdges=stairwellInteriorCells&&lowerLandingCells&&upperLandingCells
    ? stairwellBoundaryEdges(stairwellInteriorCells,lowerLandingCells,upperLandingCells,direction,secondDirection,W,H,sharedFootprintCells) : null;
  const lightingAnchors=stairLightingAnchors({
    lower,direction,secondDirection,firstRun,secondRun,style,turnPlatform
  });
  if (!shaftCells || !lowerLandingCells || !upperLandingCells || !lowerApproachCells || !upperApproachCells
      || !lowerApproachRouteCells || !upperApproachRouteCells || !sharedFootprintCells || !stairwellInteriorCells
      || !slabOpeningCells?.length || !boundaryEdges?.length || !stairwellEdges?.length
      || !stairwellEdges.some(edge=>edge.lowerAccess) || !stairwellEdges.some(edge=>edge.upperAccess)
      || lightingAnchors.length<2) return null;
  return {
    style,
    lower: { ...lower },
    turn,
    upper,
    lowerApproach,
    upperApproach,
    lowerApproachGate,
    upperApproachGate,
    lowerApproachRouteCell,
    upperApproachRouteCell,
    direction: { ...direction },
    secondDirection,
    run,
    firstRun,
    secondRun,
    width,
    sideClearance,
    landingDepth,
    shaftCells,
    stairFootprintCells:shaftCells,
    sweptClearanceCells,
    headroomCells:sweptClearanceCells.map(record=>record.cell),
    slabOpeningCells,
    openingBoundaryEdges:boundaryEdges,
    openingAccessEdges:boundaryEdges.filter(edge=>edge.access),
    openingStairPassageEdges:boundaryEdges.filter(edge=>edge.stairPassage),
    stairwellBoundaryEdges:stairwellEdges,
    stairwellLowerAccessEdges:stairwellEdges.filter(edge=>edge.lowerAccess),
    stairwellUpperAccessEdges:stairwellEdges.filter(edge=>edge.upperAccess),
    stairwellLowerWallSegments:stairwellEdges.filter(edge=>!edge.lowerAccess),
    stairwellUpperWallSegments:stairwellEdges.filter(edge=>!edge.upperAccess),
    stairwellInteriorCells,
    lightingAnchors,
    lowerLandingCells,
    upperLandingCells,
    lowerApproachGateCells,
    upperApproachGateCells,
    lowerApproachCells,
    upperApproachCells,
    sharedFootprintCells
  };
}

function stairOpeningMetrics(cells, W) {
  if(!cells?.length) return {cellCount:0,area:0,bounds:null};
  const xs=cells.map(cell=>cell%W),ys=cells.map(cell=>Math.floor(cell/W));
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  return {
    cellCount:cells.length,
    area:cells.length,
    bounds:{minX,maxX,minY,maxY,width:maxX-minX+1,depth:maxY-minY+1}
  };
}

/* A stair owns one explicit architectural plan. Floor holes, walls and
   mandatory openings must never be inferred independently from the final room
   raster: doing so made the same stair change shape when a neighbouring room
   happened to contribute a wall cell. */
function classifyStairStructure(contract, wallMode = 'wall-backed', W, allowExternalWalls = false) {
  const footprint=new Set(contract.sharedFootprintCells || []);
  const opening=new Set(contract.slabOpeningCells || []);
  const lowerNoWall=new Set(uniqueCells(contract.stairwellInteriorCells,contract.lowerApproachCells));
  const upperNoWall=new Set(uniqueCells(contract.stairwellInteriorCells,contract.upperApproachCells,contract.slabOpeningCells));
  const wallEdges=[];
  const ownsEdge=edge=>wallMode==='enclosed' || (wallMode==='wall-backed'&&edge.structuralSpine);

  for(const edge of contract.stairwellBoundaryEdges || []){
    const cell=edge.neighborCell;
    if(cell<0) continue;
    // Both sockets are hard openings through the complete vertical stair
    // volume. A lower wall must not rise through the upper exit and an upper
    // wall must not cap the lower entrance.
    const mandatoryOpen=edge.lowerAccess || edge.upperAccess || !ownsEdge(edge);
    if(mandatoryOpen&&footprint.has(cell)){
      lowerNoWall.add(cell);
      upperNoWall.add(cell);
    }else if(!mandatoryOpen&&(footprint.has(cell)||allowExternalWalls)){
      wallEdges.push(edge);
    }
  }

  const doubleHeight=new Set();
  const lowerSingle=new Set();
  const upperSingle=new Set();
  for(const edge of wallEdges){
    const cell=edge.neighborCell;
    if(opening.has(edge.insideCell)) doubleHeight.add(cell);
    else lowerSingle.add(cell);
    if(!doubleHeight.has(cell)) upperSingle.add(cell);
  }

  // "No wall" is the strongest rule. It resolves concave L-turn filler cells
  // that can be touched by more than one boundary edge without letting a
  // structural classification re-introduce a transverse wall.
  for(const cell of lowerNoWall){
    doubleHeight.delete(cell);
    lowerSingle.delete(cell);
  }
  for(const cell of upperNoWall){
    doubleHeight.delete(cell);
    upperSingle.delete(cell);
  }
  return {
    openingMetrics:stairOpeningMetrics(contract.slabOpeningCells,W),
    doubleHeightWallCells:[...doubleHeight].sort((a,b)=>a-b),
    lowerSingleHeightWallCells:[...lowerSingle].sort((a,b)=>a-b),
    upperSingleHeightWallCells:[...upperSingle].sort((a,b)=>a-b),
    lowerNoWallCells:[...lowerNoWall].sort((a,b)=>a-b),
    upperNoWallCells:[...upperNoWall].sort((a,b)=>a-b)
  };
}

function stairContractClear(lowerLayer, upperLayer, contract, lowerRoom, upperRoom, W, allowStructureAdaptation = false) {
  const lowerRoomId=lowerRoom.id, upperRoomId=upperRoom.id;
  // A room centre is only a validation seed, not protected geometry. If a
  // manually positioned stair crosses it, validation selects another walkable
  // cell from that room after the upper slab has been opened.
  const blocked = (layer, cell) => layer.stairMask[cell] || layer.stairwellMask[cell] || layer.stairWallMask[cell]
    || layer.stairClearance[cell] || layer.stairLanding[cell] || layer.slabOpening[cell];
  for (const cell of contract.sharedFootprintCells) {
    if (blocked(lowerLayer, cell) || blocked(upperLayer, cell)) return false;
    // Ordinary floor, corridor, wall and decoration data are mutable. The
    // stairwell owns this footprint and reserveStair reshapes both layers.
    const lowerOwner = lowerLayer.roomId[cell];
    const upperOwner = upperLayer.roomId[cell];
    if (!allowStructureAdaptation && lowerOwner >= 0 && lowerOwner !== lowerRoomId) return false;
    if (!allowStructureAdaptation && upperOwner >= 0 && upperOwner !== upperRoomId) return false;
  }
  for (const cell of contract.shaftCells) {
    // The stair may live inside the two rooms it connects. This is the normal
    // stacked-room case: the lower floor owns the tread, while the upper floor
    // cuts the same x/z cells into a slab opening.
    const lowerOwner=lowerLayer.roomId[cell], upperOwner=upperLayer.roomId[cell];
    if (!allowStructureAdaptation && lowerOwner >= 0 && lowerOwner !== lowerRoomId) return false;
    if (!allowStructureAdaptation && upperOwner >= 0 && upperOwner !== upperRoomId) return false;
  }
  for (const cell of uniqueCells(contract.lowerApproachCells,contract.lowerApproachRouteCells)) {
    if (blocked(lowerLayer, cell)) return false;
    const owner = lowerLayer.roomId[cell];
    if (!allowStructureAdaptation && owner >= 0 && owner !== lowerRoomId) return false;
  }
  for (const cell of uniqueCells(contract.upperApproachCells,contract.upperApproachRouteCells)) {
    if (blocked(upperLayer, cell)) return false;
    const owner = upperLayer.roomId[cell];
    if (!allowStructureAdaptation && owner >= 0 && owner !== upperRoomId) return false;
  }
  return true;
}

function stairWallPlanClear(lowerLayer,upperLayer,plan){
  const occupied=(layer,cell)=>layer.stairMask[cell]||layer.stairWallMask[cell]
    ||layer.stairClearance[cell]||layer.stairLanding[cell]||layer.slabOpening[cell]
    ||(layer.corridor[cell]&&layer.corridorOwner[cell]>=0);
  const lowerWalls=uniqueCells(plan.doubleHeightWallCells,plan.lowerSingleHeightWallCells);
  const upperWalls=uniqueCells(plan.doubleHeightWallCells,plan.upperSingleHeightWallCells);
  return lowerWalls.every(cell=>!occupied(lowerLayer,cell))
    &&upperWalls.every(cell=>!occupied(upperLayer,cell));
}

function reserveStair(lowerLayer, upperLayer, contract, structurePlan, connectorId, tiles) {
  for (const cell of contract.sharedFootprintCells) {
    // The rectangle is conservative reservation metadata. It prevents another
    // connector from colliding with the turn without becoming visible floor.
    lowerLayer.stairwellMask[cell] = 1;
    upperLayer.stairwellMask[cell] = 1;
  }
  for(const cell of uniqueCells(structurePlan.doubleHeightWallCells,structurePlan.lowerSingleHeightWallCells)){
    lowerLayer.stairWallMask[cell]=1;
  }
  for(const cell of uniqueCells(structurePlan.doubleHeightWallCells,structurePlan.upperSingleHeightWallCells)){
    upperLayer.stairWallMask[cell]=1;
  }
  for (const cell of contract.stairwellInteriorCells) {
    // Only the actual L/straight stair volume is reshaped on both floors.
    // Clearing the rectangular filler corner made the stairwell feel boxed in.
    lowerLayer.grid[cell] = tiles.FLOOR;
    upperLayer.grid[cell] = tiles.FLOOR;
    lowerLayer.corridor[cell] = 1;
    upperLayer.corridor[cell] = 1;
    lowerLayer.corridorOwner[cell] = connectorId;
    upperLayer.corridorOwner[cell] = connectorId;
    lowerLayer.roomId[cell] = -1;
    upperLayer.roomId[cell] = -1;
  }
  for (const cell of contract.lowerApproachCells) {
    lowerLayer.grid[cell] = tiles.FLOOR;
    lowerLayer.corridor[cell] = 1;
    lowerLayer.corridorOwner[cell] = connectorId;
    lowerLayer.stairLanding[cell] = 1;
  }
  for (const cell of contract.upperApproachCells) {
    upperLayer.grid[cell] = tiles.FLOOR;
    upperLayer.corridor[cell] = 1;
    upperLayer.corridorOwner[cell] = connectorId;
    upperLayer.stairLanding[cell] = 1;
  }
  for (const cell of contract.shaftCells) {
    lowerLayer.grid[cell] = tiles.FLOOR;
    lowerLayer.corridor[cell] = 1;
    lowerLayer.corridorOwner[cell] = connectorId;
    lowerLayer.roomId[cell] = -1;
    lowerLayer.stairMask[cell] = 1;
    lowerLayer.stairClearance[cell] = 1;
  }
  for (const cell of contract.slabOpeningCells) {
    // Only the high part of the stair whose swept headroom intersects the
    // upper slab becomes a real opening on that floor.
    upperLayer.grid[cell] = tiles.VOID;
    upperLayer.corridor[cell] = 0;
    upperLayer.corridorOwner[cell] = connectorId;
    upperLayer.roomId[cell] = -1;
    upperLayer.slabOpening[cell] = 1;
    upperLayer.stairClearance[cell] = 1;
  }
}

function setStairOpenFloor(layer,cell,connectorId,tiles){
  layer.grid[cell]=tiles.FLOOR;
  layer.corridor[cell]=1;
  layer.corridorOwner[cell]=connectorId;
  layer.roomId[cell]=-1;
  layer.doorway[cell]=0;
}

function setStairWall(layer,cell,tiles){
  layer.grid[cell]=tiles.WALL;
  layer.corridor[cell]=0;
  layer.corridorOwner[cell]=-1;
  layer.roomId[cell]=-1;
  layer.doorway[cell]=0;
}

function enforceStairStructure(connector,lowerLayer,upperLayer,tiles){
  for(const cell of connector.lowerNoWallCells || []) setStairOpenFloor(lowerLayer,cell,connector.id,tiles);
  for(const cell of connector.upperNoWallCells || []){
    if(upperLayer.slabOpening[cell]){
      upperLayer.grid[cell]=tiles.VOID;
      upperLayer.corridor[cell]=0;
      upperLayer.corridorOwner[cell]=connector.id;
      upperLayer.roomId[cell]=-1;
      upperLayer.doorway[cell]=0;
    }else setStairOpenFloor(upperLayer,cell,connector.id,tiles);
  }
  for(const cell of connector.lowerSingleHeightWallCells || []) setStairWall(lowerLayer,cell,tiles);
  for(const cell of connector.upperSingleHeightWallCells || []) setStairWall(upperLayer,cell,tiles);
  for(const cell of connector.doubleHeightWallCells || []){
    setStairWall(lowerLayer,cell,tiles);
    setStairWall(upperLayer,cell,tiles);
  }
}

function finalizeOpeningProtection(connectors, layers, tiles) {
  for(const connector of connectors){
    const lowerLayer=layers[connector.fromFloor];
    const upperLayer=layers[connector.toFloor];
    enforceStairStructure(connector,lowerLayer,upperLayer,tiles);
    const boundary=connector.openingBoundaryEdges || [];
    connector.openingAccessEdges=boundary.filter(edge=>edge.access).map(edge=>({...edge}));
    connector.openingWallSegments=boundary.filter(edge=>!edge.access&&!edge.stairPassage
      && edge.neighborCell>=0 && upperLayer?.grid[edge.neighborCell]===tiles.WALL).map(edge=>({...edge}));
    connector.openingGuardSegments=boundary.filter(edge=>!edge.access&&!edge.stairPassage
      && !(edge.neighborCell>=0 && upperLayer?.grid[edge.neighborCell]===tiles.WALL)).map(edge=>({...edge}));
    const stairwellBoundary=connector.stairwellBoundaryEdges || [];
    const lowerWallCells=new Set([...(connector.doubleHeightWallCells || []),...(connector.lowerSingleHeightWallCells || [])]);
    const upperWallCells=new Set([...(connector.doubleHeightWallCells || []),...(connector.upperSingleHeightWallCells || [])]);
    const ownsLowerWall=edge=>edge.neighborCell>=0&&lowerWallCells.has(edge.neighborCell)
      &&lowerLayer?.grid[edge.neighborCell]===tiles.WALL;
    const ownsUpperWall=edge=>edge.neighborCell>=0&&upperWallCells.has(edge.neighborCell)
      &&upperLayer?.grid[edge.neighborCell]===tiles.WALL;
    connector.stairwellLowerWallSegments=stairwellBoundary.filter(edge=>!edge.lowerAccess&&ownsLowerWall(edge))
      .map(edge=>({...edge,normal:{...edge.normal}}));
    connector.stairwellUpperWallSegments=stairwellBoundary.filter(edge=>!edge.upperAccess&&ownsUpperWall(edge))
      .map(edge=>({...edge,normal:{...edge.normal}}));
    connector.stairwellLowerGuardSegments=stairwellBoundary.filter(edge=>!edge.lowerAccess&&!ownsLowerWall(edge))
      .map(edge=>({...edge,normal:{...edge.normal}}));
    connector.stairwellUpperGuardSegments=stairwellBoundary.filter(edge=>!edge.upperAccess&&!ownsUpperWall(edge))
      .map(edge=>({...edge,normal:{...edge.normal}}));
  }
}

function adaptationStartCell(room, layer, blockedCells, target, W, H, tiles) {
  const x0=Math.max(0,Math.floor(room.cx-room.w/2));
  const x1=Math.min(W-1,Math.ceil(room.cx+room.w/2));
  const y0=Math.max(0,Math.floor(room.cy-room.h/2));
  const y1=Math.min(H-1,Math.ceil(room.cy+room.h/2));
  let best=null,bestDistance=Infinity;
  for(let y=y0;y<=y1;y++) for(let x=x0;x<=x1;x++){
    const cell=idx2(W,x,y);
    if(blockedCells.has(cell) || layer.grid[cell]!==tiles.FLOOR || layer.roomId[cell]!==room.id) continue;
    const distance=Math.abs(x-target.x)+Math.abs(y-target.y);
    if(distance<bestDistance){ best={x,y}; bestDistance=distance; }
  }
  return best;
}

function buildStructureAdaptationRoutes({contract,lowerLayer,upperLayer,lowerRoom,upperRoom,rooms,W,H,tiles}) {
  const routes=[];
  const specifications=[
    {layer:lowerLayer,connectedRoom:lowerRoom,target:contract.lower,blocked:new Set()},
    {layer:upperLayer,connectedRoom:upperRoom,target:contract.upper,blocked:new Set(contract.slabOpeningCells)}
  ];
  for(const specification of specifications){
    const ownerIds=new Set(contract.sharedFootprintCells
      .map(cell=>specification.layer.roomId[cell])
      .filter(owner=>owner>=0&&owner!==specification.connectedRoom.id));
    for(const roomId of ownerIds){
      const room=rooms[roomId];
      if(!room || room.floor!==specification.layer.floor) continue;
      const start=adaptationStartCell(room,specification.layer,specification.blocked,
        specification.target,W,H,tiles);
      if(!start) continue;
      const route=routeAStar(specification.layer,start,specification.target,{
        W,H,startRoomId:room.id,goalRoomId:specification.connectedRoom.id,
        blockedCells:specification.blocked,allowStairs:false,turnCost:.35
      });
      if(route) routes.push({layer:specification.layer,roomId,route});
    }
  }
  return routes;
}

function routeWithForcedSocketCell(route, socketPoint, W, H, atEnd) {
  if(!route?.cells?.length || !inBounds(W,H,socketPoint.x,socketPoint.y)) return null;
  const socketCell=idx2(W,socketPoint.x,socketPoint.y);
  const adjacentCell=atEnd ? route.cells[route.cells.length-1] : route.cells[0];
  const ax=adjacentCell%W,ay=Math.floor(adjacentCell/W);
  if(Math.abs(socketPoint.x-ax)+Math.abs(socketPoint.y-ay)!==1 || route.cells.includes(socketCell)) return null;
  const cells=atEnd ? [...route.cells,socketCell] : [socketCell,...route.cells];
  return {cells,points:simplifyCells(cells,W),cost:route.cost+1};
}

function connectorCandidates(aDoor, bDoor, W, H, run, width, landingDepth, style = 'l-turn', lateralCenterOffset) {
  const out = [];
  const seen = new Set();
  const directions = [
    { x: 1, y: 0, name: 'east' },
    { x: -1, y: 0, name: 'west' },
    { x: 0, y: 1, name: 'south' },
    { x: 0, y: -1, name: 'north' }
  ];
  const dx = bDoor.x - aDoor.x;
  const dy = bDoor.y - aDoor.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const perpendicular = { x: -dy / length, y: dx / length };
  for (let ti = 1; ti <= 9; ti++) {
    const t = ti / 10;
    for (const offset of [0, -4, 4, -8, 8, -12, 12]) {
      const anchor = {
        x: Math.round(aDoor.x + dx * t + perpendicular.x * offset),
        y: Math.round(aDoor.y + dy * t + perpendicular.y * offset)
      };
      for (const direction of directions) {
        const key = `${anchor.x},${anchor.y},${direction.name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const contract=buildStairContract(W,H,anchor,direction,run,width,landingDepth,0,style,lateralCenterOffset);
        if(contract) out.push({ lower:anchor,turn:contract.turn,upper:contract.upper,direction });
      }
    }
  }
  return out;
}

function overlappingRoomCandidates(lowerRoom, upperRoom, W, H, run, width, landingDepth, style = 'l-turn', lateralCenterOffset) {
  const x0 = Math.ceil(Math.max(lowerRoom.cx - lowerRoom.w / 2, upperRoom.cx - upperRoom.w / 2));
  const x1 = Math.floor(Math.min(lowerRoom.cx + lowerRoom.w / 2, upperRoom.cx + upperRoom.w / 2));
  const y0 = Math.ceil(Math.max(lowerRoom.cy - lowerRoom.h / 2, upperRoom.cy - upperRoom.h / 2));
  const y1 = Math.floor(Math.min(lowerRoom.cy + lowerRoom.h / 2, upperRoom.cy + upperRoom.h / 2));
  if (x1 < x0 || y1 < y0) return [];
  const directions = [
    { x: 1, y: 0, name: 'east' }, { x: -1, y: 0, name: 'west' },
    { x: 0, y: 1, name: 'south' }, { x: 0, y: -1, name: 'north' }
  ];
  const out=[];
  for (const direction of directions) {
    for (let y=y0; y<=y1; y++) for (let x=x0; x<=x1; x++) {
      const lower={x,y};
      const contract=buildStairContract(W,H,lower,direction,run,width,landingDepth,0,style,lateralCenterOffset);
      if(!contract) continue;
      const fitsOverlap=contract.sharedFootprintCells.every(cell=>{
        const cellX=cell%W,cellY=Math.floor(cell/W);
        return cellX>=x0&&cellX<=x1&&cellY>=y0&&cellY<=y1;
      });
      if(fitsOverlap) out.push({lower,turn:contract.turn,upper:contract.upper,direction,sharedRoomOverlap:true});
    }
  }
  return out;
}

function placeConnector({ edge, rooms, layers, W, H, connectorId, tiles }) {
  const roomA = rooms[edge.a];
  const roomB = rooms[edge.b];
  const lowerRoom = roomA.floor < roomB.floor ? roomA : roomB;
  const upperRoom = lowerRoom === roomA ? roomB : roomA;
  const lowerLayer = layers[lowerRoom.floor];
  const upperLayer = layers[upperRoom.floor];
  const lowerDoor = roomDoorPoint(lowerRoom, upperRoom);
  const upperDoor = roomDoorPoint(upperRoom, lowerRoom);
  const stairSpec = edge.stairSpec || null;
  const style = normalizeStairStyle(stairSpec?.style);
  const run = Math.max(6, Math.round(stairSpec?.length || Math.ceil(FLOOR_HEIGHT / 0.5)));
  const width = snapStairWidth(stairSpec?.width || (edge.isCritical ? 3 : 2));
  // Width editing persists a lateral center offset. Moving that offset by half
  // the width delta keeps the opposite edge fixed for one-sided resizing.
  const lateralCenterOffset=stairLateralCenterOffset(width,stairSpec?.lateralCenterOffset);
  const landingDepth = Math.max(1, Math.round(stairSpec?.landingDepth || 2));
  const stepRise = 0.25;
  const stepCount = Math.max(8, Math.round(FLOOR_HEIGHT / stepRise));
  const directions = {
    east: { x: 1, y: 0, name: 'east' },
    west: { x: -1, y: 0, name: 'west' },
    south: { x: 0, y: 1, name: 'south' },
    north: { x: 0, y: -1, name: 'north' }
  };
  const pinnedDirection = directions[stairSpec?.direction];
  const hasStableAnchor = Number.isFinite(stairSpec?.anchor?.x) && Number.isFinite(stairSpec?.anchor?.y) && pinnedDirection;
  const generatedCandidates = [
    ...overlappingRoomCandidates(lowerRoom, upperRoom, W, H, run, width, landingDepth, style, lateralCenterOffset),
    ...connectorCandidates(lowerDoor, upperDoor, W, H, run, width, landingDepth, style, lateralCenterOffset)
  ];
  const candidates = (hasStableAnchor
    ? [{ lower:snapStairGridPoint(stairSpec.anchor), direction:pinnedDirection }]
    : generatedCandidates)
    .sort((a, b) => {
      const endpoint=candidate=>{
        if(candidate.upper) return candidate.upper;
        return buildStairContract(W,H,candidate.lower,candidate.direction,run,width,landingDepth,0,style,lateralCenterOffset)?.upper
          || candidate.lower;
      };
      const aUpper=endpoint(a), bUpper=endpoint(b);
      const scoreA = Math.abs(lowerDoor.x - a.lower.x) + Math.abs(lowerDoor.y - a.lower.y)
        + Math.abs(upperDoor.x - aUpper.x) + Math.abs(upperDoor.y - aUpper.y);
      const scoreB = Math.abs(lowerDoor.x - b.lower.x) + Math.abs(lowerDoor.y - b.lower.y)
        + Math.abs(upperDoor.x - bUpper.x) + Math.abs(upperDoor.y - bUpper.y);
      return Number(!!b.sharedRoomOverlap)-Number(!!a.sharedRoomOverlap)
        || scoreA - scoreB || a.lower.x - b.lower.x || a.lower.y - b.lower.y || a.direction.name.localeCompare(b.direction.name);
    })
    .slice(0, hasStableAnchor ? 1 : 48);
  const legal = [];
  const wallMode=stairSpec?.wallMode || 'wall-backed';
  // Automatic placement first looks for a complete rectangular stairwell that
  // touches only the linked rooms. Dense layouts may have no strict socket, so
  // a second pass can reshape ordinary structure, while still reserving the
  // whole rectangle instead of carving a local L-shaped notch. An anchored
  // editor stair goes directly through the adaptation pass by user intent.
  const adaptationPasses=hasStableAnchor ? [true] : [false,true];
  for(const allowStructureAdaptation of adaptationPasses){
    const passLegal=[];
    for (const candidate of candidates) {
      // A strict automatic candidate keeps one service tile around the stair.
      // If a dense layout needs structural adaptation, drop only that optional
      // margin before touching rooms; the actual stair and rectangular envelope
      // remain complete. Manually positioned stairs may also sit flush to walls.
      const sideClearance = hasStableAnchor || allowStructureAdaptation ? 0 : 1;
      const contract = buildStairContract(W, H, candidate.lower, candidate.direction, run, width, landingDepth, sideClearance, style, lateralCenterOffset);
      if (!contract || !stairContractClear(lowerLayer, upperLayer, contract, lowerRoom, upperRoom, W, allowStructureAdaptation)) continue;
      const structurePlan=classifyStairStructure(contract,wallMode,W,hasStableAnchor);
      // Locked/editor stairs may reshape ordinary room structure, but they may
      // never place a stair wall over an already carved corridor or another
      // stair's landing/clearance. Without this check a later locked stair
      // could visually cut through the access route of an earlier stair while
      // the global BFS still found a detour and incorrectly reported success.
      if(!stairWallPlanClear(lowerLayer,upperLayer,structurePlan)) continue;
      const lowerBlocked=new Set(uniqueCells(contract.sharedFootprintCells,contract.lowerApproachCells,
        structurePlan.doubleHeightWallCells,structurePlan.lowerSingleHeightWallCells));
      const upperBlocked=new Set(uniqueCells(contract.sharedFootprintCells,contract.upperApproachCells,contract.slabOpeningCells,
        structurePlan.doubleHeightWallCells,structurePlan.upperSingleHeightWallCells));
      const lowerRouteCore = routeAStar(lowerLayer, lowerDoor, contract.lowerApproachRouteCell, {
        W, H, startRoomId: lowerRoom.id, goalRoomId: lowerRoom.id,
        preferredRoomId:lowerRoom.id, blockedCells:lowerBlocked
      });
      const upperRouteCore = routeAStar(upperLayer, contract.upperApproachRouteCell, upperDoor, {
        W, H, startRoomId: upperRoom.id, goalRoomId: upperRoom.id,
        preferredRoomId:upperRoom.id, blockedCells:upperBlocked
      });
      const lowerRoute=routeWithForcedSocketCell(lowerRouteCore,contract.lowerApproachGate,W,H,true);
      const upperRoute=routeWithForcedSocketCell(upperRouteCore,contract.upperApproachGate,W,H,false);
      if (!lowerRoute || !upperRoute) continue;
      const lowerStructureWalls=new Set(uniqueCells(
        structurePlan.doubleHeightWallCells,structurePlan.lowerSingleHeightWallCells
      ));
      const upperStructureWalls=new Set(uniqueCells(
        structurePlan.doubleHeightWallCells,structurePlan.upperSingleHeightWallCells
      ));
      // The candidate's own access route must not terminate at or pass through
      // one of its generated walls. Stacked rooms can share the same nominal
      // door point, so checking only the pre-stair raster is insufficient.
      if(lowerRoute.cells.some(cell=>lowerStructureWalls.has(cell))
        ||upperRoute.cells.some(cell=>upperStructureWalls.has(cell))) continue;
      let overlapPenalty = 0;
      for (const cell of lowerRoute.cells) if (lowerLayer.corridor[cell]) overlapPenalty -= 0.4;
      for (const cell of upperRoute.cells) if (upperLayer.corridor[cell]) overlapPenalty -= 0.4;
      const sharedRoomOverlap=contract.sharedFootprintCells.every(cell=>{
        const lowerOwner=lowerLayer.roomId[cell], upperOwner=upperLayer.roomId[cell];
        return lowerOwner===lowerRoom.id && upperOwner===upperRoom.id;
      });
      let structurePenalty=0;
      if(!hasStableAnchor) for(const cell of contract.sharedFootprintCells){
        const lowerOwner=lowerLayer.roomId[cell], upperOwner=upperLayer.roomId[cell];
        if(lowerOwner>=0&&lowerOwner!==lowerRoom.id) structurePenalty+=12;
        if(upperOwner>=0&&upperOwner!==upperRoom.id) structurePenalty+=12;
      }
      const score = lowerRoute.cost + upperRoute.cost + run + landingDepth * 2 + overlapPenalty
        + structurePenalty - (sharedRoomOverlap ? 1000 : 0);
      passLegal.push({ ...candidate, contract, structurePlan, lowerRoute, upperRoute, sharedRoomOverlap, score, structureAdapted:allowStructureAdaptation });
    }
    if(passLegal.length){
      legal.push(...passLegal);
      break;
    }
  }
  legal.sort((a,b)=>a.score-b.score || a.lower.x-b.lower.x || a.lower.y-b.lower.y || a.direction.name.localeCompare(b.direction.name));
  const candidateIndex=hasStableAnchor ? 0 : Math.max(0,Math.round(stairSpec?.candidateIndex || 0));
  const best=legal.length ? legal[candidateIndex%legal.length] : null;
  if (!best) return null;

  const structureAdaptationRoutes=best.structureAdapted
    ? buildStructureAdaptationRoutes({
      contract:best.contract,lowerLayer,upperLayer,lowerRoom,upperRoom,rooms,W,H,tiles
    }) : [];

  const structurePlan=best.structurePlan || classifyStairStructure(best.contract,wallMode,W);

  // Stair approaches inherit the stair width. Using the generic critical-path
  // width here widened a two-tile stair to three tiles and punched through the
  // wall beside an otherwise valid wall-flush placement.
  const widthToCarve = width;
  carveCells(lowerLayer, best.lowerRoute.cells, W, H, widthToCarve, edge.id, tiles);
  carveCells(upperLayer, best.upperRoute.cells, W, H, widthToCarve, edge.id, tiles);
  for(const adaptation of structureAdaptationRoutes){
    carveCells(adaptation.layer,adaptation.route.cells,W,H,1,edge.id,tiles);
  }
  reserveStair(lowerLayer, upperLayer, best.contract, structurePlan, connectorId, tiles);
  markDoor(lowerLayer, W, H, lowerDoor);
  markDoor(upperLayer, W, H, upperDoor);
  lowerLayer.doorway[idx2(W, best.contract.lower.x, best.contract.lower.y)] = 1;
  upperLayer.doorway[idx2(W, best.contract.upper.x, best.contract.upper.y)] = 1;

  const connector = {
    id: connectorId,
    edgeId: edge.id,
    kind: 'stairs',
    style,
    fromFloor: lowerRoom.floor,
    toFloor: upperRoom.floor,
    lower: { ...best.contract.lower },
    turn: best.contract.turn ? { ...best.contract.turn } : null,
    upper: { ...best.contract.upper },
    lowerApproach: { ...best.contract.lowerApproach },
    upperApproach: { ...best.contract.upperApproach },
    lowerApproachGate:{...best.contract.lowerApproachGate},
    upperApproachGate:{...best.contract.upperApproachGate},
    lowerApproachRouteCell:{...best.contract.lowerApproachRouteCell},
    upperApproachRouteCell:{...best.contract.upperApproachRouteCell},
    direction: best.direction.name,
    directionVector: { x: best.direction.x, y: best.direction.y },
    secondDirection:best.contract.secondDirection.name,
    secondDirectionVector:{x:best.contract.secondDirection.x,y:best.contract.secondDirection.y},
    width,
    lateralCenterOffset,
    length: run,
    firstRun:best.contract.firstRun,
    secondRun:best.contract.secondRun,
    rise: FLOOR_HEIGHT,
    stepCount,
    firstFlightSteps:style==='straight'?stepCount:Math.floor(stepCount/2),
    secondFlightSteps:style==='straight'?0:stepCount-Math.floor(stepCount/2),
    stepRise,
    treadDepth: run / stepCount,
    landingDepth,
    sideClearance:best.contract.sideClearance,
    mode:stairSpec?.mode || 'stable-auto',
    candidateIndex:legal.indexOf(best),
    candidateCount:legal.length,
    structureAdapted:best.structureAdapted,
    structureAdaptationRoutes:structureAdaptationRoutes.map(adaptation=>({
      floor:adaptation.layer.floor,roomId:adaptation.roomId,points:adaptation.route.points
    })),
    openingPolicy:'headroom-tight-upper-slab-only',
    requiredHeadroom:STAIR_REQUIRED_HEADROOM,
    wallMode,
    wallReservationPolicy:hasStableAnchor?'locked-external-wall':'reserved-footprint-only',
    wallGeneration:'stair-contract',
    wallHeightPolicy:'opening-span-classified',
    stairFootprintCells:[...best.contract.stairFootprintCells],
    headroomCells:[...best.contract.headroomCells],
    sweptClearanceCells:best.contract.sweptClearanceCells.map(record=>({...record})),
    openingCells: [...best.contract.slabOpeningCells],
    floorOpeningCells:[...best.contract.slabOpeningCells],
    openingMetrics:{...structurePlan.openingMetrics,bounds:structurePlan.openingMetrics.bounds?{...structurePlan.openingMetrics.bounds}:null},
    doubleHeightWallCells:[...structurePlan.doubleHeightWallCells],
    lowerSingleHeightWallCells:[...structurePlan.lowerSingleHeightWallCells],
    upperSingleHeightWallCells:[...structurePlan.upperSingleHeightWallCells],
    lowerNoWallCells:[...structurePlan.lowerNoWallCells],
    upperNoWallCells:[...structurePlan.upperNoWallCells],
    openingBoundaryEdges:best.contract.openingBoundaryEdges.map(edge=>({...edge})),
    openingAccessEdges:best.contract.openingAccessEdges.map(edge=>({...edge})),
    openingStairPassageEdges:best.contract.openingStairPassageEdges.map(edge=>({...edge})),
    openingGuardSegments:[],
    openingWallSegments:[],
    stairwellBoundaryEdges:best.contract.stairwellBoundaryEdges.map(edge=>({...edge,normal:{...edge.normal}})),
    stairwellLowerAccessEdges:best.contract.stairwellLowerAccessEdges.map(edge=>({...edge,normal:{...edge.normal}})),
    stairwellUpperAccessEdges:best.contract.stairwellUpperAccessEdges.map(edge=>({...edge,normal:{...edge.normal}})),
    stairwellLowerWallSegments:[],
    stairwellUpperWallSegments:[],
    stairwellLowerGuardSegments:[],
    stairwellUpperGuardSegments:[],
    stairwellInteriorCells:[...best.contract.stairwellInteriorCells],
    lightingPolicy:'required-themed',
    minimumLightCount:2,
    lightingAnchors:best.contract.lightingAnchors.map(anchor=>({...anchor,direction:{...anchor.direction}})),
    lowerApproachCells:[...best.contract.lowerApproachCells],
    upperApproachCells:[...best.contract.upperApproachCells],
    sharedFootprintCells:[...best.contract.sharedFootprintCells],
    sharedFootprintKind:best.sharedRoomOverlap?'room-overlap':'rectangular-stairwell-pad',
    clearVolume: {
      floorFrom: lowerRoom.floor,
      floorTo: upperRoom.floor,
      start: { ...best.contract.lower },
      end: { ...best.contract.upper },
      width,
      height: FLOOR_HEIGHT
    },
    lowerRoute: best.lowerRoute.points,
    upperRoute: best.upperRoute.points,
    lowerRouteCells:[...best.lowerRoute.cells],
    upperRouteCells:[...best.upperRoute.cells]
  };
  edge.connectorId = connectorId;
  edge.lowerRoute = connector.lowerRoute;
  edge.upperRoute = connector.upperRoute;
  edge.route = null;
  edge.carvedWidth = widthToCarve;
  return connector;
}

function stairTransitionWallExclusions(connectors,floor){
  const excluded=new Set();
  for(const connector of connectors || []){
    const isLower=connector.fromFloor===floor;
    const isUpper=connector.toFloor===floor;
    if(!isLower&&!isUpper) continue;
    for(const cell of isLower ? (connector.lowerNoWallCells || []) : (connector.upperNoWallCells || [])) excluded.add(cell);
  }
  return excluded;
}

function buildWalls(layer, W, H, tiles, excludedWallCells = new Set()) {
  for(const cell of excludedWallCells){
    if(layer.grid[cell]===tiles.WALL) layer.grid[cell]=tiles.VOID;
  }
  const floorCells = [];
  for (let cell = 0; cell < layer.grid.length; cell++) if (layer.grid[cell] === tiles.FLOOR) floorCells.push(cell);
  for (const cell of floorCells) {
    const x = cell % W;
    const y = Math.floor(cell / W);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const nx = x + ox;
        const ny = y + oy;
        if (!inBounds(W, H, nx, ny)) continue;
        const neighbor = idx2(W, nx, ny);
        if (layer.grid[neighbor] === tiles.VOID && !layer.slabOpening[neighbor]
            && !excludedWallCells.has(neighbor)) layer.grid[neighbor] = tiles.WALL;
      }
    }
  }
}

function inferFloor(record, layers, rooms, W, H, preferWall = false) {
  if (Number.isInteger(record.floor) && layers[record.floor]) return record.floor;
  if (Number.isInteger(record.roomId) && record.roomId >= 0 && rooms[record.roomId]) return rooms[record.roomId].floor;
  const x = Math.round(record.x);
  const y = Math.round(record.y);
  if (!inBounds(W, H, x, y)) return 0;
  /* Wall details carry the direction from the wall into the room. Prefer
     that adjacent cell before the broad coordinate fallback, since floors
     may intentionally overlap in x/z. */
  if (Number.isFinite(record.dx) && Number.isFinite(record.dy) && (record.dx || record.dy)) {
    const nx = x + Math.round(record.dx);
    const ny = y + Math.round(record.dy);
    if (inBounds(W, H, nx, ny)) {
      const neighbor = idx2(W, nx, ny);
      for (const layer of layers) if (layer.roomId[neighbor] >= 0) return layer.floor;
    }
  }
  const cell = idx2(W, x, y);
  for (const layer of layers) if (layer.roomId[cell] >= 0) return layer.floor;
  for (const layer of layers) if (layer.corridor[cell]) return layer.floor;
  if (preferWall) {
    for (const layer of layers) {
      if (layer.grid[cell] !== DEFAULT_TILES.WALL) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(W, H, nx, ny) && layer.grid[idx2(W, nx, ny)] === DEFAULT_TILES.FLOOR) return layer.floor;
      }
    }
  }
  return 0;
}

function spatialFloorCandidates(record, layers, W, H, preferWall = false) {
  const x = Math.round(record.x);
  const y = Math.round(record.y);
  if (!inBounds(W, H, x, y)) return [];
  const cell = idx2(W, x, y);
  const directed = Number.isFinite(record.dx) && Number.isFinite(record.dy)
    && (record.dx || record.dy);
  const nx = directed ? x + Math.round(record.dx) : x;
  const ny = directed ? y + Math.round(record.dy) : y;
  const result = [];
  for (const layer of layers) {
    let supported = layer.roomId[cell] >= 0
      || layer.corridor[cell]
      || layer.grid[cell] === DEFAULT_TILES.POOL;
    if (!supported && preferWall && layer.grid[cell] === DEFAULT_TILES.WALL) {
      if (directed && inBounds(W, H, nx, ny)) {
        const neighbor = idx2(W, nx, ny);
        supported = layer.grid[neighbor] === DEFAULT_TILES.FLOOR
          || layer.roomId[neighbor] >= 0 || layer.corridor[neighbor];
      } else {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ax = x + dx;
          const ay = y + dy;
          if (!inBounds(W, H, ax, ay)) continue;
          const neighbor = idx2(W, ax, ay);
          if (layer.grid[neighbor] === DEFAULT_TILES.FLOOR
              || layer.roomId[neighbor] >= 0 || layer.corridor[neighbor]) {
            supported = true;
            break;
          }
        }
      }
    }
    if (supported) result.push(layer.floor);
  }
  return result;
}

function distribute(records, key, layers, rooms, W, H, preferWall = false) {
  for (const record of records || []) {
    /* A legacy prop may have been authored while two floors shared the same
       x/z cell. Keep it on every spatially valid layer rather than trusting a
       room id from the old union grid, which would render it floating on the
       other layer. Single-floor layouts still produce exactly one candidate. */
    const candidates = Number.isInteger(record.floor) && layers[record.floor]
      ? [record.floor]
      : spatialFloorCandidates(record, layers, W, H, preferWall);
    const floors = candidates.length ? candidates : [inferFloor(record, layers, rooms, W, H, preferWall)];
    for (const floor of floors) layers[floor][key].push({ ...record, floor });
  }
}

function transferLegacyDetails({ layers, rooms, W, H, legacy, tiles }) {
  distribute(legacy.props, 'props', layers, rooms, W, H, true);
  distribute(legacy.spawns, 'spawns', layers, rooms, W, H);
  distribute(legacy.torches, 'torches', layers, rooms, W, H, true);
  /* Door frames are rebuilt from the final resolved edge endpoints below.
     Legacy arches were authored before the multi-floor raster was rebuilt and
     can therefore float into a wall after A* or floor splitting. */
  distribute(legacy.pools, 'pools', layers, rooms, W, H, true);
  distribute(legacy.lakeCells, 'lakeCells', layers, rooms, W, H);
  for (const layer of layers) {
    const outsideConnector = record => {
      const x = Math.round(record.x);
      const y = Math.round(record.y);
      if (!inBounds(W, H, x, y)) return false;
      const cell = idx2(W, x, y);
      return !layer.stairMask[cell] && !layer.stairClearance[cell] && !layer.stairLanding[cell] && !layer.slabOpening[cell];
    };
    for (const key of ['props', 'spawns', 'torches', 'arches', 'pools', 'lakeCells']) {
      layer[key] = layer[key].filter(outsideConnector);
    }
    for (const cell of layer.lakeCells) {
      if (inBounds(W, H, cell.x, cell.y)) layer.lakeMask[idx2(W, cell.x, cell.y)] = 1;
    }
    for (const pool of layer.pools) {
      if (!inBounds(W, H, pool.x, pool.y)) continue;
      const cell = idx2(W, pool.x, pool.y);
      if (!layer.stairMask[cell] && !layer.stairClearance[cell] && !layer.stairLanding[cell] && !layer.slabOpening[cell]) {
        layer.grid[cell] = tiles.POOL;
      }
    }
  }
}

function roomAccessCell(room, layer, W, H, tiles) {
  if (!room || !layer) return null;
  const cx = Math.max(0, Math.min(W - 1, Math.round(room.cx)));
  const cy = Math.max(0, Math.min(H - 1, Math.round(room.cy)));
  const center = idx2(W, cx, cy);
  if (layer.grid[center] === tiles.FLOOR && !layer.slabOpening[center]) return center;

  let best = null;
  let bestDistance = Infinity;
  for (let cell = 0; cell < layer.grid.length; cell++) {
    if (layer.grid[cell] !== tiles.FLOOR || layer.slabOpening[cell]) continue;
    if (layer.roomId[cell] !== room.id) continue;
    const x = cell % W;
    const y = Math.floor(cell / W);
    const distance = Math.abs(x - cx) + Math.abs(y - cy);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  if (best !== null) return best;

  // A compact dedicated stair room can be consumed almost entirely by the
  // opening. Its landing is still a valid representative point for reachability.
  const x0 = Math.max(0, Math.floor(room.cx - room.w / 2));
  const x1 = Math.min(W - 1, Math.ceil(room.cx + room.w / 2));
  const y0 = Math.max(0, Math.floor(room.cy - room.h / 2));
  const y1 = Math.min(H - 1, Math.ceil(room.cy + room.h / 2));
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const cell = idx2(W, x, y);
    if (layer.grid[cell] !== tiles.FLOOR || layer.slabOpening[cell]) continue;
    const distance = Math.abs(x - cx) + Math.abs(y - cy);
    if (distance < bestDistance) {
      best = cell;
      bestDistance = distance;
    }
  }
  return best;
}

function stairConnectorContractValid(connector, W, H, lowerLayer, upperLayer, tiles) {
  if(!connector?.lower || !connector?.upper || !connector?.directionVector) return false;
  const rebuilt=buildStairContract(
    W,H,connector.lower,connector.directionVector,connector.length,connector.width,
    connector.landingDepth,connector.sideClearance,connector.style,connector.lateralCenterOffset
  );
  if(!rebuilt) return false;
  const samePoint=(a,b)=>!!a===!!b && (!a || (a.x===b.x && a.y===b.y));
  const sameCells=(actual,expected)=>{
    if(!Array.isArray(actual) || actual.length!==expected.length) return false;
    const set=new Set(actual);
    return set.size===expected.length && expected.every(cell=>set.has(cell));
  };
  const edgeKey=edge=>[
    edge.x1,edge.y1,edge.x2,edge.y2,
    Number(!!edge.lowerAccess),Number(!!edge.upperAccess),Number(!!edge.structuralSpine)
  ].join(',');
  const sameEdges=(actual,expected)=>{
    if(!Array.isArray(actual) || actual.length!==expected.length) return false;
    const set=new Set(actual.map(edgeKey));
    return set.size===expected.length && expected.every(edge=>set.has(edgeKey(edge)));
  };
  const anchorKey=anchor=>[
    anchor.id,anchor.x,anchor.y,anchor.elevationFraction,anchor.direction?.x,anchor.direction?.y
  ].join(',');
  const sameAnchors=(actual,expected)=>{
    if(!Array.isArray(actual) || actual.length!==expected.length) return false;
    const set=new Set(actual.map(anchorKey));
    return set.size===expected.length && expected.every(anchor=>set.has(anchorKey(anchor)));
  };
  const clearanceKey=record=>[
    record.cell,record.treadElevation,record.clearanceTop,Number(!!record.intersectsUpperSlab)
  ].join(',');
  const sameClearance=(actual,expected)=>{
    if(!Array.isArray(actual)||actual.length!==expected.length) return false;
    const set=new Set(actual.map(clearanceKey));
    return set.size===expected.length&&expected.every(record=>set.has(clearanceKey(record)));
  };
  const routeDirectionValid=(cells,gate,routeCell,direction,atEnd)=>{
    if(!Array.isArray(cells)||cells.length<2) return false;
    const gateCell=idx2(W,gate.x,gate.y),outsideCell=idx2(W,routeCell.x,routeCell.y);
    const from=atEnd?cells[cells.length-2]:cells[0];
    const to=atEnd?cells[cells.length-1]:cells[1];
    return (atEnd ? from===outsideCell&&to===gateCell : from===gateCell&&to===outsideCell)
      && (to%W)-(from%W)===direction.x
      && Math.floor(to/W)-Math.floor(from/W)===direction.y;
  };
  const stepsValid=Number.isInteger(connector.stepCount) && connector.stepCount>0
    && Number.isInteger(connector.firstFlightSteps) && Number.isInteger(connector.secondFlightSteps)
    && connector.firstFlightSteps+connector.secondFlightSteps===connector.stepCount
    && Math.abs(connector.stepRise*connector.stepCount-connector.rise)<1e-9;
  const wallMode=connector.wallMode || 'wall-backed';
  const structurePlan=classifyStairStructure(rebuilt,wallMode,W,connector.wallReservationPolicy==='locked-external-wall');
  const lowerWallCells=new Set([...structurePlan.doubleHeightWallCells,...structurePlan.lowerSingleHeightWallCells]);
  const upperWallCells=new Set([...structurePlan.doubleHeightWallCells,...structurePlan.upperSingleHeightWallCells]);
  const ownsLowerWall=edge=>edge.neighborCell>=0&&lowerWallCells.has(edge.neighborCell)
    &&lowerLayer?.grid[edge.neighborCell]===tiles.WALL;
  const ownsUpperWall=edge=>edge.neighborCell>=0&&upperWallCells.has(edge.neighborCell)
    &&upperLayer?.grid[edge.neighborCell]===tiles.WALL;
  const expectedLowerWalls=rebuilt.stairwellBoundaryEdges.filter(edge=>!edge.lowerAccess&&ownsLowerWall(edge));
  const expectedUpperWalls=rebuilt.stairwellBoundaryEdges.filter(edge=>!edge.upperAccess&&ownsUpperWall(edge));
  const expectedLowerGuards=rebuilt.stairwellBoundaryEdges.filter(edge=>!edge.lowerAccess&&!ownsLowerWall(edge));
  const expectedUpperGuards=rebuilt.stairwellBoundaryEdges.filter(edge=>!edge.upperAccess&&!ownsUpperWall(edge));
  const expectedOpeningWalls=rebuilt.openingBoundaryEdges.filter(edge=>!edge.access&&!edge.stairPassage
    && edge.neighborCell>=0&&upperLayer?.grid[edge.neighborCell]===tiles.WALL);
  const expectedOpeningGuards=rebuilt.openingBoundaryEdges.filter(edge=>!edge.access&&!edge.stairPassage
    && !(edge.neighborCell>=0&&upperLayer?.grid[edge.neighborCell]===tiles.WALL));
  return normalizeStairStyle(connector.style)===rebuilt.style
    && connector.width===snapStairWidth(connector.width)
    && connector.firstRun===rebuilt.firstRun
    && connector.secondRun===rebuilt.secondRun
    && connector.length===rebuilt.run
    && samePoint(connector.turn,rebuilt.turn)
    && samePoint(connector.upper,rebuilt.upper)
    && samePoint(connector.lowerApproachGate,rebuilt.lowerApproachGate)
    && samePoint(connector.upperApproachGate,rebuilt.upperApproachGate)
    && samePoint(connector.lowerApproachRouteCell,rebuilt.lowerApproachRouteCell)
    && samePoint(connector.upperApproachRouteCell,rebuilt.upperApproachRouteCell)
    && connector.secondDirectionVector?.x===rebuilt.secondDirection.x
    && connector.secondDirectionVector?.y===rebuilt.secondDirection.y
    && sameCells(connector.stairFootprintCells,rebuilt.stairFootprintCells)
    && sameCells(connector.headroomCells,rebuilt.headroomCells)
    && sameClearance(connector.sweptClearanceCells,rebuilt.sweptClearanceCells)
    && sameCells(connector.openingCells,rebuilt.slabOpeningCells)
    && sameCells(connector.floorOpeningCells,rebuilt.slabOpeningCells)
    && connector.openingMetrics?.cellCount===structurePlan.openingMetrics.cellCount
    && connector.openingMetrics?.area===structurePlan.openingMetrics.area
    && sameCells(connector.doubleHeightWallCells,structurePlan.doubleHeightWallCells)
    && sameCells(connector.lowerSingleHeightWallCells,structurePlan.lowerSingleHeightWallCells)
    && sameCells(connector.upperSingleHeightWallCells,structurePlan.upperSingleHeightWallCells)
    && sameCells(connector.lowerNoWallCells,structurePlan.lowerNoWallCells)
    && sameCells(connector.upperNoWallCells,structurePlan.upperNoWallCells)
    && sameCells(connector.lowerApproachCells,rebuilt.lowerApproachCells)
    && sameCells(connector.upperApproachCells,rebuilt.upperApproachCells)
    && sameCells(connector.sharedFootprintCells,rebuilt.sharedFootprintCells)
    && sameCells(connector.stairwellInteriorCells,rebuilt.stairwellInteriorCells)
    && ['open','wall-backed','enclosed'].includes(wallMode)
    && ['locked-external-wall','reserved-footprint-only'].includes(connector.wallReservationPolicy)
    && connector.wallGeneration==='stair-contract'
    && connector.wallHeightPolicy==='opening-span-classified'
    && connector.lightingPolicy==='required-themed'
    && Number.isInteger(connector.minimumLightCount) && connector.minimumLightCount>=2
    && connector.lightingAnchors?.length>=connector.minimumLightCount
    && sameAnchors(connector.lightingAnchors,rebuilt.lightingAnchors)
    && sameEdges(connector.openingAccessEdges,rebuilt.openingAccessEdges)
    && sameEdges(connector.openingStairPassageEdges,rebuilt.openingStairPassageEdges)
    && sameEdges(connector.openingWallSegments,expectedOpeningWalls)
    && sameEdges(connector.openingGuardSegments,expectedOpeningGuards)
    && sameEdges(connector.stairwellBoundaryEdges,rebuilt.stairwellBoundaryEdges)
    && sameEdges(connector.stairwellLowerWallSegments,expectedLowerWalls)
    && sameEdges(connector.stairwellUpperWallSegments,expectedUpperWalls)
    && sameEdges(connector.stairwellLowerGuardSegments,expectedLowerGuards)
    && sameEdges(connector.stairwellUpperGuardSegments,expectedUpperGuards)
    && routeDirectionValid(connector.lowerRouteCells,rebuilt.lowerApproachGate,rebuilt.lowerApproachRouteCell,rebuilt.direction,true)
    && routeDirectionValid(connector.upperRouteCells,rebuilt.upperApproachGate,rebuilt.upperApproachRouteCell,rebuilt.secondDirection,false)
    && stepsValid;
}

function stairAuditEdgeKey(edge) {
  return [edge?.x1,edge?.y1,edge?.x2,edge?.y2].join(',');
}

function stairBoundaryProtectionComplete(boundary, accessField, walls, guards, mandatoryOpenField = null) {
  if(!Array.isArray(boundary)||!Array.isArray(walls)||!Array.isArray(guards)) return false;
  const wallKeys=new Set(walls.map(stairAuditEdgeKey));
  const guardKeys=new Set(guards.map(stairAuditEdgeKey));
  return boundary.every(edge=>{
    const key=stairAuditEdgeKey(edge);
    if(edge[accessField]||(mandatoryOpenField&&edge[mandatoryOpenField])){
      return !wallKeys.has(key)&&!guardKeys.has(key);
    }
    return Number(wallKeys.has(key))+Number(guardKeys.has(key))===1;
  });
}

/**
 * Performs the per-stair acceptance pass used after every generation.
 * This is deliberately layer-aware: rebuilding the connector contract alone
 * cannot detect a later stair wall cutting through an earlier access route, or
 * an unrelated slab hole appearing inside the reserved stairwell.
 */
export function auditStairConnector({connector,W,H,lowerLayer,upperLayer,tiles=DEFAULT_TILES}) {
  const issues=[];
  const addIssue=(code,message)=>{
    if(!issues.some(issue=>issue.code===code)) issues.push({code,message});
  };
  const total=W*H;
  const cellsMatch=(cells,predicate,requireNonEmpty=true)=>Array.isArray(cells)
    &&(!requireNonEmpty||cells.length>0)
    &&cells.every(cell=>Number.isInteger(cell)&&cell>=0&&cell<total&&predicate(cell));
  const openingSet=new Set(connector?.openingCells || []);

  const layersPresent=!!lowerLayer&&!!upperLayer;
  const contractComplete=layersPresent
    &&stairConnectorContractValid(connector,W,H,lowerLayer,upperLayer,tiles);
  if(!contractComplete) addIssue('contract-mismatch','楼梯几何、尺寸或结构契约不一致');

  const lowerLandingCell=connector?.lower ? idx2(W,connector.lower.x,connector.lower.y) : -1;
  const upperLandingCell=connector?.upper ? idx2(W,connector.upper.x,connector.upper.y) : -1;
  const landingsWalkable=layersPresent
    &&lowerLandingCell>=0&&upperLandingCell>=0
    &&lowerLayer.grid[lowerLandingCell]===tiles.FLOOR
    &&upperLayer.grid[upperLandingCell]===tiles.FLOOR
    &&!!lowerLayer.stairLanding[lowerLandingCell]
    &&!!upperLayer.stairLanding[upperLandingCell]
    &&cellsMatch(connector.lowerApproachCells,cell=>lowerLayer.grid[cell]===tiles.FLOOR
      &&!!lowerLayer.stairLanding[cell]&&!lowerLayer.slabOpening[cell])
    &&cellsMatch(connector.upperApproachCells,cell=>upperLayer.grid[cell]===tiles.FLOOR
      &&!!upperLayer.stairLanding[cell]&&!upperLayer.slabOpening[cell]);
  if(!landingsWalkable) addIssue('landing-blocked','楼梯上下落脚区被墙体、洞口或非地面单元阻断');

  const routesWalkable=layersPresent
    &&cellsMatch(connector.lowerRouteCells,cell=>lowerLayer.grid[cell]===tiles.FLOOR&&!lowerLayer.slabOpening[cell])
    &&cellsMatch(connector.upperRouteCells,cell=>upperLayer.grid[cell]===tiles.FLOOR&&!upperLayer.slabOpening[cell]);
  if(!routesWalkable) addIssue('access-route-blocked','楼梯接入路线穿过墙体或楼板洞口');

  const treadVolumeWalkable=layersPresent
    &&cellsMatch(connector.stairFootprintCells,cell=>lowerLayer.grid[cell]===tiles.FLOOR
      &&!!lowerLayer.stairMask[cell]&&!!lowerLayer.stairClearance[cell]
      &&!lowerLayer.slabOpening[cell]);
  if(!treadVolumeWalkable) addIssue('tread-volume-blocked','下层踏步占地存在墙体、空洞或净空缺失');

  const floorRelationValid=layersPresent
    &&connector.toFloor-connector.fromFloor===1
    &&connector.rise===FLOOR_HEIGHT;
  if(!floorRelationValid) addIssue('floor-relation-invalid','楼梯没有连接相邻楼层或层高不一致');
  const traversable=landingsWalkable&&routesWalkable&&treadVolumeWalkable&&floorRelationValid;

  const openingCellsValid=layersPresent&&openingSet.size>0
    &&openingSet.size===(connector.openingCells || []).length
    &&[...openingSet].every(cell=>Number.isInteger(cell)&&cell>=0&&cell<total
      &&!!upperLayer.slabOpening[cell]&&!!upperLayer.stairClearance[cell]
      &&upperLayer.grid[cell]===tiles.VOID);
  const lowerSlabSolid=layersPresent&&cellsMatch(connector.sharedFootprintCells,cell=>!lowerLayer.slabOpening[cell]);
  const upperOpeningExact=layersPresent&&cellsMatch(connector.sharedFootprintCells,cell=>
    !!upperLayer.slabOpening[cell]===openingSet.has(cell));
  const upperRemainderSolid=layersPresent&&cellsMatch(connector.stairFootprintCells,cell=>
    openingSet.has(cell)||(upperLayer.grid[cell]!==tiles.VOID&&!upperLayer.slabOpening[cell]));
  const slabsComplete=openingCellsValid&&lowerSlabSolid&&upperOpeningExact&&upperRemainderSolid;
  if(!slabsComplete) addIssue('slab-hole-invalid','上下层楼板存在漏开、误开或未封闭的空洞');

  const segmentBackedByWall=(segments,layer)=>Array.isArray(segments)&&segments.every(edge=>
    Number.isInteger(edge.neighborCell)&&edge.neighborCell>=0&&edge.neighborCell<total
    &&layer.grid[edge.neighborCell]===tiles.WALL);
  const wallCellsComplete=layersPresent
    &&cellsMatch(connector.doubleHeightWallCells,cell=>lowerLayer.grid[cell]===tiles.WALL&&upperLayer.grid[cell]===tiles.WALL,false)
    &&cellsMatch(connector.lowerSingleHeightWallCells,cell=>lowerLayer.grid[cell]===tiles.WALL,false)
    &&cellsMatch(connector.upperSingleHeightWallCells,cell=>upperLayer.grid[cell]===tiles.WALL,false)
    &&cellsMatch(connector.lowerNoWallCells,cell=>lowerLayer.grid[cell]!==tiles.WALL,false)
    &&cellsMatch(connector.upperNoWallCells,cell=>upperLayer.grid[cell]!==tiles.WALL,false);
  const boundaryProtectionComplete=layersPresent
    &&stairBoundaryProtectionComplete(connector.openingBoundaryEdges,'access',connector.openingWallSegments,
      connector.openingGuardSegments,'stairPassage')
    &&stairBoundaryProtectionComplete(connector.stairwellBoundaryEdges,'lowerAccess',connector.stairwellLowerWallSegments,connector.stairwellLowerGuardSegments)
    &&stairBoundaryProtectionComplete(connector.stairwellBoundaryEdges,'upperAccess',connector.stairwellUpperWallSegments,connector.stairwellUpperGuardSegments)
    &&segmentBackedByWall(connector.openingWallSegments,upperLayer)
    &&segmentBackedByWall(connector.stairwellLowerWallSegments,lowerLayer)
    &&segmentBackedByWall(connector.stairwellUpperWallSegments,upperLayer);
  const wallsComplete=wallCellsComplete&&boundaryProtectionComplete;
  if(!wallsComplete) addIssue('wall-protection-incomplete','楼梯墙体或临空护栏不完整，或入口被错误封闭');

  return {
    connectorId:connector?.id ?? null,
    edgeId:connector?.edgeId ?? null,
    pass:contractComplete&&traversable&&slabsComplete&&wallsComplete,
    contractComplete,
    traversable,
    reachable:false,
    wallsComplete,
    slabsComplete,
    issues
  };
}

export function validateDungeon3D({ layers, rooms, connectors, entrance, W, H, tiles = DEFAULT_TILES }) {
  const totalPerFloor = W * H;
  const total = totalPerFloor * layers.length;
  const distance = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const transitions = new Map();
  const invalidConnectors = [];
  const stairAudits = [];
  const addTransition = (from, to) => {
    const list = transitions.get(from) || [];
    list.push(to);
    transitions.set(from, list);
  };
  for (const connector of connectors) {
    const lowerLayer = layers[connector.fromFloor];
    const upperLayer = layers[connector.toFloor];
    const audit=auditStairConnector({connector,W,H,lowerLayer,upperLayer,tiles});
    stairAudits.push(audit);
    const spatiallyValid=audit.pass;
    if (!spatiallyValid) invalidConnectors.push(connector.id);
    const lower = connector.fromFloor * totalPerFloor + idx2(W, connector.lower.x, connector.lower.y);
    const upper = connector.toFloor * totalPerFloor + idx2(W, connector.upper.x, connector.upper.y);
    // A stair that failed its own physical audit must not make the global BFS
    // appear connected by contributing a synthetic cross-floor transition.
    if(spatiallyValid){
      addTransition(lower, upper);
      addTransition(upper, lower);
    }
  }
  const startRoom = rooms[entrance];
  const startLocal = startRoom ? roomAccessCell(startRoom, layers[startRoom.floor], W, H, tiles) : null;
  const start = startLocal === null ? -1 : startRoom.floor * totalPerFloor + startLocal;
  let head = 0;
  let tail = 0;
  let reach = 0;
  if (start >= 0) {
    queue[tail++] = start;
    distance[start] = 0;
    while (head < tail) {
      const current = queue[head++];
      reach++;
      const floor = Math.floor(current / totalPerFloor);
      const local = current % totalPerFloor;
      const x = local % W;
      const y = Math.floor(local / W);
      const nextDistance = distance[current] + 1;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(W, H, nx, ny)) continue;
        const nextLocal = idx2(W, nx, ny);
        const next = floor * totalPerFloor + nextLocal;
        if (distance[next] >= 0 || layers[floor].grid[nextLocal] !== tiles.FLOOR) continue;
        distance[next] = nextDistance;
        queue[tail++] = next;
      }
      for (const next of transitions.get(current) || []) {
        if (distance[next] >= 0) continue;
        distance[next] = nextDistance;
        queue[tail++] = next;
      }
    }
  }

  const unreachableRooms = [];
  for (const room of rooms) {
    if (room.roleHint === 'secret') continue;
    const local = roomAccessCell(room, layers[room.floor], W, H, tiles);
    const point = local === null ? -1 : room.floor * totalPerFloor + local;
    if (point < 0 || distance[point] < 0) unreachableRooms.push(room.id);
  }
  const unreachableConnectors = connectors.filter(connector => {
    const lower = connector.fromFloor * totalPerFloor + idx2(W, connector.lower.x, connector.lower.y);
    const upper = connector.toFloor * totalPerFloor + idx2(W, connector.upper.x, connector.upper.y);
    return distance[lower] < 0 || distance[upper] < 0;
  }).map(connector => connector.id);
  for(const audit of stairAudits){
    audit.reachable=!unreachableConnectors.includes(audit.connectorId);
    if(!audit.reachable&&!audit.issues.some(issue=>issue.code==='unreachable')){
      audit.issues.push({code:'unreachable',message:'楼梯上下层不能从场景入口正常通行'});
    }
    audit.pass=audit.pass&&audit.reachable;
  }

  layers.forEach(layer => {
    const offset = layer.floor * totalPerFloor;
    let max = 0;
    for (let cell = 0; cell < totalPerFloor; cell++) {
      layer.bfs[cell] = distance[offset + cell];
      if (layer.bfs[cell] > max) max = layer.bfs[cell];
    }
    layer.maxBfs = max;
  });
  return {
    valid: unreachableRooms.length === 0 && unreachableConnectors.length === 0
      && invalidConnectors.length === 0 && stairAudits.every(audit=>audit.pass),
    distance,
    reach,
    unreachableRooms,
    unreachableConnectors,
    invalidConnectors,
    stairAudits
  };
}

export function buildMultiFloorLayout({
  W,
  H,
  floorCount,
  rooms,
  edges,
  entrance,
  tiles = DEFAULT_TILES,
  legacy = {}
}) {
  const layers = Array.from({ length: floorCount }, (_, floor) => createLayerData(floor, W, H));
  rasterizeRooms(layers, rooms, W, H, tiles);
  const classified = classifyEdgesByFloor(rooms, edges);
  const errors = [...classified.errors];
  const connectors = [];
  const stairFailures = [];
  const addStairFailure = (edge, reason) => {
    const stairId = edge?.stairSpec?.id || null;
    if (stairFailures.some(failure => failure.edgeId === edge?.id && failure.reason === reason)) return;
    stairFailures.push({ stairId, edgeId: edge?.id ?? null, reason });
  };
  const ordered = [...classified.edges].sort((a, b) => edgePriority(a) - edgePriority(b) || a.id - b.id);
  for (const edge of ordered) {
    const roomA = rooms[edge.a];
    const roomB = rooms[edge.b];
    if (edge.kind === 'corridor') {
      const layer = layers[edge.floor];
      const defaultStart = roomDoorPoint(roomA, roomB, 0);
      const defaultGoal = roomDoorPoint(roomB, roomA, 0);
      const requestedStart = edge.hasCustomDoorA && Number.isFinite(edge.ax) && Number.isFinite(edge.ay)
        ? { x: Math.round(edge.ax), y: Math.round(edge.ay), side: edge.aside || defaultStart.side }
        : defaultStart;
      const requestedGoal = edge.hasCustomDoorB && Number.isFinite(edge.bx) && Number.isFinite(edge.by)
        ? { x: Math.round(edge.bx), y: Math.round(edge.by), side: edge.bside || defaultGoal.side }
        : defaultGoal;
      const requestedWidth = normalizeCorridorWidth(edge.visualWidth || (edge.isCritical ? 3 : 2));
      let width = 0, start = null, goal = null;
      // A constrained door may not have enough tangent cells for the desired
      // corridor width. Find the widest width that both door sockets can
      // actually accept, then use that one width for the whole corridor.
      for(let candidate=requestedWidth; candidate>=CORRIDOR_WIDTH_MIN; candidate-=CORRIDOR_WIDTH_STEP){
        const candidateStart = resolveWallDoor(layer, W, H, roomA, requestedStart, defaultStart, candidate, !edge.hasCustomDoorA);
        const candidateGoal = resolveWallDoor(layer, W, H, roomB, requestedGoal, defaultGoal, candidate, !edge.hasCustomDoorB);
        if(candidateStart && candidateGoal){
          width = candidate;
          start = candidateStart;
          goal = candidateGoal;
          break;
        }
      }
      if (!start || !goal) {
        errors.push(`edge ${edge.id} has no legal wall door`);
        continue;
      }
      edge.requestedWidth = requestedWidth;
      edge.widthAdapted = width !== requestedWidth;
      edge.visualWidth = width;
      /* Door points are boundary cells with a verified open cell immediately
         outside the room. Extend the route through that wall normal before
         A* starts, so a door cannot be punched from the room interior or
         enter a wall sideways. */
      const startApproach = doorApproach(start);
      const goalApproach = doorApproach(goal);
      if (edge.useEditorRoute && Array.isArray(edge.route) && edge.route.length >= 2) {
        const middle = edge.route.slice(1, -1);
        edge.route = [{ ...start }, startApproach, ...middle, goalApproach, { ...goal }];
        carvePolyline(layer, edge.route, W, H, width, edge.id, tiles);
      } else {
        const route = routeAStar(layer, startApproach, goalApproach, { W, H, startRoomId: roomA.id, goalRoomId: roomB.id });
        if (!route) {
          errors.push(`edge ${edge.id} has no A* route`);
          continue;
        }
        edge.route = [{ x: start.x, y: start.y }, ...route.points, { x: goal.x, y: goal.y }];
        carvePolyline(layer, edge.route, W, H, width, edge.id, tiles);
      }
      edge.ax = start.x;
      edge.ay = start.y;
      edge.aside = start.side;
      edge.bx = goal.x;
      edge.by = goal.y;
      edge.bside = goal.side;
      edge.carvedWidth = width;
      markDoor(layer, W, H, start, width);
      markDoor(layer, W, H, goal, width);
      addResolvedArch(layer, roomA, start, width, W, H);
      addResolvedArch(layer, roomB, goal, width, W, H);
    } else {
      const connector = placeConnector({
        edge,
        rooms,
        layers,
        W,
        H,
        connectorId: connectors.length,
        tiles
      });
      if (connector) connectors.push(connector);
      else {
        const reason = `edge ${edge.id} has no legal stair candidate`;
        errors.push(reason);
        addStairFailure(edge, reason);
      }
    }
  }
  for (const layer of layers) buildWalls(layer,W,H,tiles,stairTransitionWallExclusions(connectors,layer.floor));
  finalizeOpeningProtection(connectors,layers,tiles);
  transferLegacyDetails({ layers, rooms, W, H, legacy, tiles });
  const validation = validateDungeon3D({ layers, rooms, connectors, entrance, W, H, tiles });
  errors.push(...validation.unreachableRooms.map(id => `room ${id} is unreachable`));
  errors.push(...validation.unreachableConnectors.map(id => `connector ${id} is unreachable`));
  errors.push(...validation.stairAudits.filter(audit=>!audit.pass).map(audit=>
    `connector ${audit.connectorId} stair audit failed: ${audit.issues.map(issue=>issue.message).join('; ')}`));
  for (const connectorId of validation.unreachableConnectors) {
    const connector = connectors.find(item => item.id === connectorId);
    const edge = classified.edges.find(item => item.id === connector?.edgeId);
    if (edge) addStairFailure(edge, `connector ${connectorId} is unreachable`);
  }
  for (const connectorId of validation.invalidConnectors) {
    const connector = connectors.find(item => item.id === connectorId);
    const edge = classified.edges.find(item => item.id === connector?.edgeId);
    const audit=validation.stairAudits.find(item=>item.connectorId===connectorId);
    if (edge) addStairFailure(edge, audit?.issues?.[0]?.message || `connector ${connectorId} violates stair spatial contract`);
  }
  return {
    layers,
    edges: classified.edges,
    connectors,
    removedEdges: classified.removed,
    bfs3: validation.distance,
    reach: validation.reach,
    valid: errors.length === 0 && validation.valid,
    errors,
    stairFailures,
    stairAudits:validation.stairAudits
  };
}

export function structuralHash(dungeon) {
  let hash = 2166136261;
  const feed = value => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 16777619);
    hash ^= (value >>> 8) & 0xff;
    hash = Math.imul(hash, 16777619);
  };
  for (const room of dungeon.rooms) {
    feed(room.id);
    feed(room.floor);
    feed(Math.round(room.cx));
    feed(Math.round(room.cy));
  }
  for (const edge of dungeon.edges) {
    feed(edge.a);
    feed(edge.b);
    feed(edge.kind === 'stairs' ? 1 : 0);
  }
  for (const connector of dungeon.connectors || []) {
    feed(connector.style === 'straight' ? 2 : 1);
    feed(connector.fromFloor);
    feed(connector.toFloor);
    feed(connector.lower.x);
    feed(connector.lower.y);
    feed(connector.turn?.x ?? 0);
    feed(connector.turn?.y ?? 0);
    feed(connector.upper.x);
    feed(connector.upper.y);
    feed(Math.round(connector.width * 4));
    feed(Math.round((connector.lateralCenterOffset || 0) * 4));
    feed(connector.length);
    feed(connector.firstRun || 0);
    feed(connector.secondRun || 0);
    feed(connector.stepCount);
    feed(connector.firstFlightSteps || 0);
    feed(connector.secondFlightSteps || 0);
    feed(connector.landingDepth);
    feed(connector.sideClearance || 0);
  }
  for (const layer of dungeon.layers || []) {
    for (const value of layer.grid) feed(value);
    for (const value of layer.corridor) feed(value);
    for (const value of layer.stairMask) feed(value);
    for (const value of layer.stairwellMask || []) feed(value);
    for (const value of layer.stairClearance) feed(value);
    for (const value of layer.stairLanding) feed(value);
    for (const value of layer.slabOpening) feed(value);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

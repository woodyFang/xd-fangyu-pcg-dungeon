export const FLOOR_HEIGHT = 4;

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
  const gScore = new Float64Array(total);
  gScore.fill(Infinity);
  gScore[startIndex] = 0;
  const parent = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
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
  // Existing corridors cost 0.3, so the heuristic must use the same lower
  // bound. A unit Manhattan heuristic would overestimate and make A* miss
  // cheaper reused-corridor routes.
  const heuristic = (x, y) => (Math.abs(x - gx) + Math.abs(y - gy)) * 0.3;
  push(startIndex, heuristic(sx, sy));
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found = false;
  let guardCount = 0;
  while (heap.length && guardCount++ < total * 4) {
    const current = pop().node;
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === goalIndex) {
      found = true;
      break;
    }
    const cx = current % W;
    const cy = Math.floor(current / W);
    for (const [dx, dy] of directions) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inBounds(W, H, nx, ny)) continue;
      const next = idx2(W, nx, ny);
      const stairRestricted = layer.stairMask[next] || layer.stairClearance?.[next] || layer.stairLanding?.[next] || layer.slabOpening?.[next];
      if (closed[next] || (!allowStairs && stairRestricted && next !== goalIndex && next !== startIndex)) continue;
      const roomId = layer.roomId[next];
      let step = layer.corridor[next] ? 0.3 : 1;
      if (roomId >= 0 && roomId !== startRoomId && roomId !== goalRoomId) step += 25;
      else if (roomId >= 0) step += 2.5;
      if (Math.abs(nx - sx) + Math.abs(ny - sy) <= 4 || Math.abs(nx - gx) + Math.abs(ny - gy) <= 4) {
        step = Math.max(0.35, step - 0.4);
      }
      const nextScore = gScore[current] + step;
      if (nextScore < gScore[next]) {
        gScore[next] = nextScore;
        parent[next] = current;
        push(next, nextScore + heuristic(nx, ny));
      }
    }
  }
  if (!found) return null;
  const cells = [];
  for (let current = goalIndex; current >= 0; current = parent[current]) {
    cells.push(current);
    if (current === startIndex) break;
  }
  if (cells[cells.length - 1] !== startIndex) return null;
  cells.reverse();
  return { cells, points: simplifyCells(cells, W), cost: gScore[goalIndex] };
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

function widthOffsets(width) {
  if (width <= 1) return [0];
  if (width === 2) return [0, 1];
  return [-1, 0, 1];
}

function stampCell(layer, W, H, x, y, width, owner, tiles) {
  for (const ox of widthOffsets(width)) {
    for (const oy of widthOffsets(width)) {
      const nx = x + ox;
      const ny = y + oy;
      if (!inBounds(W, H, nx, ny)) continue;
      const cell = idx2(W, nx, ny);
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

function markDoor(layer, W, H, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (!inBounds(W, H, x, y)) return;
  layer.doorway[idx2(W, x, y)] = 1;
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
  if (edge.isManual) return 3;
  if (edge.isCritical) return 0;
  if (!edge.isLoop) return 1;
  return 2;
}

function stairStripCells(W, H, from, direction, firstStep, lastStep, width) {
  const cells = [];
  const perpendicular = { x: -direction.y, y: direction.x };
  for (let step = firstStep; step <= lastStep; step++) {
    for (const offset of widthOffsets(width)) {
      const x = from.x + direction.x * step + perpendicular.x * offset;
      const y = from.y + direction.y * step + perpendicular.y * offset;
      if (!inBounds(W, H, x, y)) return null;
      cells.push(idx2(W, x, y));
    }
  }
  return cells;
}

function buildStairContract(W, H, lower, direction, run, width, landingDepth) {
  const upper = { x: lower.x + direction.x * run, y: lower.y + direction.y * run };
  const lowerApproach = { x: lower.x - direction.x * landingDepth, y: lower.y - direction.y * landingDepth };
  const upperApproach = { x: upper.x + direction.x * landingDepth, y: upper.y + direction.y * landingDepth };
  const shaftCells = stairStripCells(W, H, lower, direction, 1, run - 1, width);
  const lowerLandingCells = stairStripCells(W, H, lower, direction, -landingDepth, 0, width);
  const upperLandingCells = stairStripCells(W, H, upper, direction, 0, landingDepth, width);
  if (!shaftCells || !lowerLandingCells || !upperLandingCells) return null;
  return {
    lower: { ...lower },
    upper,
    lowerApproach,
    upperApproach,
    direction: { ...direction },
    run,
    width,
    landingDepth,
    shaftCells,
    lowerLandingCells,
    upperLandingCells
  };
}

function stairContractClear(lowerLayer, upperLayer, contract, lowerRoomId, upperRoomId) {
  const blocked = (layer, cell) => layer.stairMask[cell] || layer.stairClearance[cell] || layer.stairLanding[cell] || layer.slabOpening[cell];
  for (const cell of contract.shaftCells) {
    if (blocked(lowerLayer, cell) || blocked(upperLayer, cell)) return false;
    if (lowerLayer.corridor[cell] || upperLayer.corridor[cell]) return false;
    const lowerOwner = lowerLayer.roomId[cell];
    const upperOwner = upperLayer.roomId[cell];
    // The inclined run lives in circulation space, never inside a room. Only
    // the flat landing may touch the room that owns its approach corridor.
    if (lowerOwner >= 0 || upperOwner >= 0) return false;
  }
  for (const cell of contract.lowerLandingCells) {
    if (blocked(lowerLayer, cell)) return false;
    const owner = lowerLayer.roomId[cell];
    if (owner >= 0 && owner !== lowerRoomId) return false;
  }
  for (const cell of contract.upperLandingCells) {
    if (blocked(upperLayer, cell)) return false;
    const owner = upperLayer.roomId[cell];
    if (owner >= 0 && owner !== upperRoomId) return false;
  }
  return true;
}

function reserveStair(lowerLayer, upperLayer, contract, connectorId, tiles) {
  for (const cell of contract.lowerLandingCells) {
    lowerLayer.grid[cell] = tiles.FLOOR;
    lowerLayer.corridor[cell] = 1;
    lowerLayer.corridorOwner[cell] = connectorId;
    lowerLayer.stairLanding[cell] = 1;
  }
  for (const cell of contract.upperLandingCells) {
    upperLayer.grid[cell] = tiles.FLOOR;
    upperLayer.corridor[cell] = 1;
    upperLayer.corridorOwner[cell] = connectorId;
    upperLayer.stairLanding[cell] = 1;
  }
  for (const cell of contract.shaftCells) {
    lowerLayer.grid[cell] = tiles.FLOOR;
    lowerLayer.corridor[cell] = 1;
    lowerLayer.corridorOwner[cell] = connectorId;
    lowerLayer.stairMask[cell] = 1;
    lowerLayer.stairClearance[cell] = 1;

    // The upper layer owns the actual slab opening and headroom. Keeping this
    // as VOID lets wall generation form a clean stairwell rim around it.
    upperLayer.grid[cell] = tiles.VOID;
    upperLayer.corridor[cell] = 0;
    upperLayer.corridorOwner[cell] = connectorId;
    upperLayer.slabOpening[cell] = 1;
    upperLayer.stairClearance[cell] = 1;
  }
}

function stairRouteAlignmentPenalty(route, W, direction, atEnd) {
  if (!route?.cells || route.cells.length < 2) return 0;
  const from = atEnd ? route.cells[route.cells.length - 2] : route.cells[0];
  const to = atEnd ? route.cells[route.cells.length - 1] : route.cells[1];
  const dx = (to % W) - (from % W);
  const dy = Math.floor(to / W) - Math.floor(from / W);
  return dx === direction.x && dy === direction.y ? 0 : 6;
}

function connectorCandidates(aDoor, bDoor, W, H, run) {
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
        const upper = { x: anchor.x + direction.x * run, y: anchor.y + direction.y * run };
        if (inBounds(W, H, anchor.x, anchor.y) && inBounds(W, H, upper.x, upper.y)) {
          out.push({ lower: anchor, upper, direction });
        }
      }
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
  const run = Math.max(6, Math.ceil(FLOOR_HEIGHT / 0.5));
  const width = edge.isCritical ? 3 : 2;
  const landingDepth = 2;
  const stepRise = 0.25;
  const stepCount = Math.max(8, Math.round(FLOOR_HEIGHT / stepRise));
  let best = null;
  const candidates = connectorCandidates(lowerDoor, upperDoor, W, H, run)
    .sort((a, b) => {
      const scoreA = Math.abs(lowerDoor.x - a.lower.x) + Math.abs(lowerDoor.y - a.lower.y)
        + Math.abs(upperDoor.x - a.upper.x) + Math.abs(upperDoor.y - a.upper.y);
      const scoreB = Math.abs(lowerDoor.x - b.lower.x) + Math.abs(lowerDoor.y - b.lower.y)
        + Math.abs(upperDoor.x - b.upper.x) + Math.abs(upperDoor.y - b.upper.y);
      return scoreA - scoreB || a.lower.x - b.lower.x || a.lower.y - b.lower.y || a.direction.name.localeCompare(b.direction.name);
    })
    .slice(0, 48);
  for (const candidate of candidates) {
    const contract = buildStairContract(W, H, candidate.lower, candidate.direction, run, width, landingDepth);
    if (!contract || !stairContractClear(lowerLayer, upperLayer, contract, lowerRoom.id, upperRoom.id)) continue;
    const lowerRoute = routeAStar(lowerLayer, lowerDoor, contract.lowerApproach, {
      W, H, startRoomId: lowerRoom.id, goalRoomId: lowerRoom.id
    });
    const upperRoute = routeAStar(upperLayer, contract.upperApproach, upperDoor, {
      W, H, startRoomId: upperRoom.id, goalRoomId: upperRoom.id
    });
    if (!lowerRoute || !upperRoute) continue;
    let overlapPenalty = 0;
    for (const cell of lowerRoute.cells) if (lowerLayer.corridor[cell]) overlapPenalty -= 0.4;
    for (const cell of upperRoute.cells) if (upperLayer.corridor[cell]) overlapPenalty -= 0.4;
    const alignmentPenalty = stairRouteAlignmentPenalty(lowerRoute, W, candidate.direction, true)
      + stairRouteAlignmentPenalty(upperRoute, W, candidate.direction, false);
    const score = lowerRoute.cost + upperRoute.cost + run + landingDepth * 2 + alignmentPenalty + overlapPenalty;
    if (!best || score < best.score) best = { ...candidate, contract, lowerRoute, upperRoute, score };
  }
  if (!best) return null;

  const widthToCarve = edge.isCritical ? 3 : 2;
  carveCells(lowerLayer, best.lowerRoute.cells, W, H, widthToCarve, edge.id, tiles);
  carveCells(upperLayer, best.upperRoute.cells, W, H, widthToCarve, edge.id, tiles);
  reserveStair(lowerLayer, upperLayer, best.contract, connectorId, tiles);
  markDoor(lowerLayer, W, H, lowerDoor);
  markDoor(upperLayer, W, H, upperDoor);
  lowerLayer.doorway[idx2(W, best.contract.lower.x, best.contract.lower.y)] = 1;
  upperLayer.doorway[idx2(W, best.contract.upper.x, best.contract.upper.y)] = 1;

  const connector = {
    id: connectorId,
    edgeId: edge.id,
    kind: 'stairs',
    fromFloor: lowerRoom.floor,
    toFloor: upperRoom.floor,
    lower: { ...best.contract.lower },
    upper: { ...best.contract.upper },
    lowerApproach: { ...best.contract.lowerApproach },
    upperApproach: { ...best.contract.upperApproach },
    direction: best.direction.name,
    directionVector: { x: best.direction.x, y: best.direction.y },
    width,
    length: run,
    rise: FLOOR_HEIGHT,
    stepCount,
    stepRise,
    treadDepth: run / stepCount,
    landingDepth,
    openingCells: [...best.contract.shaftCells],
    clearVolume: {
      floorFrom: lowerRoom.floor,
      floorTo: upperRoom.floor,
      start: { ...best.contract.lower },
      end: { ...best.contract.upper },
      width,
      height: FLOOR_HEIGHT
    },
    lowerRoute: best.lowerRoute.points,
    upperRoute: best.upperRoute.points
  };
  edge.connectorId = connectorId;
  edge.lowerRoute = connector.lowerRoute;
  edge.upperRoute = connector.upperRoute;
  edge.route = null;
  edge.carvedWidth = widthToCarve;
  return connector;
}

function buildWalls(layer, W, H, tiles) {
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
        if (layer.grid[neighbor] === tiles.VOID && !layer.slabOpening[neighbor]) layer.grid[neighbor] = tiles.WALL;
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
  distribute(legacy.arches, 'arches', layers, rooms, W, H, true);
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

export function validateDungeon3D({ layers, rooms, connectors, entrance, W, H, tiles = DEFAULT_TILES }) {
  const totalPerFloor = W * H;
  const total = totalPerFloor * layers.length;
  const distance = new Int32Array(total).fill(-1);
  const queue = new Int32Array(total);
  const transitions = new Map();
  const invalidConnectors = [];
  const addTransition = (from, to) => {
    const list = transitions.get(from) || [];
    list.push(to);
    transitions.set(from, list);
  };
  for (const connector of connectors) {
    const lowerLayer = layers[connector.fromFloor];
    const upperLayer = layers[connector.toFloor];
    const horizontalRun = Math.abs(connector.upper.x - connector.lower.x) + Math.abs(connector.upper.y - connector.lower.y);
    let spatiallyValid = !!lowerLayer && !!upperLayer
      && connector.toFloor - connector.fromFloor === 1
      && horizontalRun === connector.length
      && connector.rise === FLOOR_HEIGHT;
    if (spatiallyValid) {
      const lowerLocal = idx2(W, connector.lower.x, connector.lower.y);
      const upperLocal = idx2(W, connector.upper.x, connector.upper.y);
      spatiallyValid = !!lowerLayer.stairLanding[lowerLocal] && !!upperLayer.stairLanding[upperLocal]
        && lowerLayer.grid[lowerLocal] === tiles.FLOOR && upperLayer.grid[upperLocal] === tiles.FLOOR;
      for (const cell of connector.openingCells || []) {
        if (!lowerLayer.stairMask[cell] || !upperLayer.slabOpening[cell] || !upperLayer.stairClearance[cell]) {
          spatiallyValid = false;
          break;
        }
      }
    }
    if (!spatiallyValid) invalidConnectors.push(connector.id);
    const lower = connector.fromFloor * totalPerFloor + idx2(W, connector.lower.x, connector.lower.y);
    const upper = connector.toFloor * totalPerFloor + idx2(W, connector.upper.x, connector.upper.y);
    addTransition(lower, upper);
    addTransition(upper, lower);
  }
  const startRoom = rooms[entrance];
  const start = startRoom.floor * totalPerFloor + idx2(W, Math.round(startRoom.cx), Math.round(startRoom.cy));
  let head = 0;
  let tail = 0;
  let reach = 0;
  if (startRoom && layers[startRoom.floor].grid[start % totalPerFloor] === tiles.FLOOR) {
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
    const point = room.floor * totalPerFloor + idx2(W, Math.round(room.cx), Math.round(room.cy));
    if (distance[point] < 0) unreachableRooms.push(room.id);
  }
  const unreachableConnectors = connectors.filter(connector => {
    const lower = connector.fromFloor * totalPerFloor + idx2(W, connector.lower.x, connector.lower.y);
    const upper = connector.toFloor * totalPerFloor + idx2(W, connector.upper.x, connector.upper.y);
    return distance[lower] < 0 || distance[upper] < 0;
  }).map(connector => connector.id);

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
    valid: unreachableRooms.length === 0 && unreachableConnectors.length === 0 && invalidConnectors.length === 0,
    distance,
    reach,
    unreachableRooms,
    unreachableConnectors,
    invalidConnectors
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
  const ordered = [...classified.edges].sort((a, b) => edgePriority(a) - edgePriority(b) || a.id - b.id);
  for (const edge of ordered) {
    const roomA = rooms[edge.a];
    const roomB = rooms[edge.b];
    if (edge.kind === 'corridor') {
      const layer = layers[edge.floor];
      const start = roomDoorPoint(roomA, roomB);
      const goal = roomDoorPoint(roomB, roomA);
      const width = Math.max(1, Math.min(3, Math.round(edge.visualWidth || (edge.isCritical ? 3 : 2))));
      if (edge.useEditorRoute && Array.isArray(edge.route) && edge.route.length >= 2) {
        carvePolyline(layer, edge.route, W, H, width, edge.id, tiles);
      } else {
        const route = routeAStar(layer, start, goal, { W, H, startRoomId: roomA.id, goalRoomId: roomB.id });
        if (!route) {
          errors.push(`edge ${edge.id} has no A* route`);
          continue;
        }
        edge.route = route.points;
        carveCells(layer, route.cells, W, H, width, edge.id, tiles);
      }
      edge.ax = start.x;
      edge.ay = start.y;
      edge.aside = start.side;
      edge.bx = goal.x;
      edge.by = goal.y;
      edge.bside = goal.side;
      edge.carvedWidth = width;
      markDoor(layer, W, H, start);
      markDoor(layer, W, H, goal);
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
      else errors.push(`edge ${edge.id} has no legal stair candidate`);
    }
  }
  for (const layer of layers) buildWalls(layer, W, H, tiles);
  transferLegacyDetails({ layers, rooms, W, H, legacy, tiles });
  const validation = validateDungeon3D({ layers, rooms, connectors, entrance, W, H, tiles });
  errors.push(...validation.unreachableRooms.map(id => `room ${id} is unreachable`));
  errors.push(...validation.unreachableConnectors.map(id => `connector ${id} is unreachable`));
  errors.push(...validation.invalidConnectors.map(id => `connector ${id} violates stair spatial contract`));
  return {
    layers,
    edges: classified.edges,
    connectors,
    removedEdges: classified.removed,
    bfs3: validation.distance,
    reach: validation.reach,
    valid: errors.length === 0 && validation.valid,
    errors
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
    feed(connector.fromFloor);
    feed(connector.toFloor);
    feed(connector.lower.x);
    feed(connector.lower.y);
    feed(connector.upper.x);
    feed(connector.upper.y);
    feed(connector.width);
    feed(connector.length);
    feed(connector.stepCount);
    feed(connector.landingDepth);
  }
  for (const layer of dungeon.layers || []) {
    for (const value of layer.grid) feed(value);
    for (const value of layer.corridor) feed(value);
    for (const value of layer.stairMask) feed(value);
    for (const value of layer.stairClearance) feed(value);
    for (const value of layer.stairLanding) feed(value);
    for (const value of layer.slabOpening) feed(value);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

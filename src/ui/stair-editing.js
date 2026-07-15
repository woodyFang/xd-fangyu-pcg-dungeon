export function adjacentFloorTargets(floor, floorCount) {
  const current = Math.round(Number(floor));
  const count = Math.max(1, Math.round(Number(floorCount) || 1));
  const targets = [];
  if (current + 1 < count) targets.push(current + 1);
  if (current - 1 >= 0) targets.push(current - 1);
  return targets;
}

export function chooseStairTargetFloor(floor, floorCount, preferredDelta = 1) {
  const targets = adjacentFloorTargets(floor, floorCount);
  const preferred = Math.round(Number(floor)) + Math.sign(preferredDelta || 1);
  return targets.includes(preferred) ? preferred : (targets[0] ?? null);
}

export function stairPairError(source, target) {
  if (!source || !target) return '请选择楼梯两端的区域。';
  if (source.id === target.id) return '楼梯两端不能是同一个区域。';
  if (Math.abs((source.floor || 0) - (target.floor || 0)) !== 1) return '楼梯只能连接相邻楼层。';
  return '';
}

function overlapSpan(aCenter, aSize, bCenter, bSize) {
  return Math.max(0, Math.min(aCenter + aSize / 2, bCenter + bSize / 2)
    - Math.max(aCenter - aSize / 2, bCenter - bSize / 2));
}

export function matchingStairRooms(source, rooms, targetFloor, stairRun = 8, stairWidth = 3) {
  if (!source) return [];
  const floor = Math.round(Number(targetFloor));
  const flightRun=Math.max(3,Math.floor(stairRun/2));
  return (rooms || []).filter(room => {
    if (!room || room.id === source.id || (room.floor || 0) !== floor) return false;
    const overlapX = overlapSpan(source.x, source.w, room.x, room.w);
    const overlapY = overlapSpan(source.y, source.h, room.y, room.h);
    return overlapX >= flightRun + stairWidth - 1
      && overlapY >= flightRun + stairWidth - 1;
  }).sort((a, b) => {
    const areaA = overlapSpan(source.x, source.w, a.x, a.w) * overlapSpan(source.y, source.h, a.y, a.h);
    const areaB = overlapSpan(source.x, source.w, b.x, b.w) * overlapSpan(source.y, source.h, b.y, b.h);
    return areaB - areaA || Math.hypot(a.x - source.x, a.y - source.y) - Math.hypot(b.x - source.x, b.y - source.y);
  });
}

export function alignedStairRoomPlacement(source, rooms, targetFloor) {
  if (!source) return null;
  const width = Math.max(8, Math.min(12, Math.round((source.w || 10) * 0.6)));
  const height = Math.max(8, Math.min(12, Math.round((source.h || 10) * 0.6)));
  const occupied = (rooms || []).filter(room => room && (room.floor || 0) === targetFloor);
  const offsets = [];
  for (let y = -12; y <= 12; y += 2) {
    for (let x = -12; x <= 12; x += 2) offsets.push({ x, y });
  }
  offsets.sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y)
    || Math.abs(a.y) - Math.abs(b.y) || a.x - b.x || a.y - b.y);
  for (const offset of offsets) {
    const candidate = { x: source.x + offset.x, y: source.y + offset.y, w: width, h: height };
    if (overlapSpan(source.x, source.w, candidate.x, candidate.w) < 4
      || overlapSpan(source.y, source.h, candidate.y, candidate.h) < 4) continue;
    const blocked = occupied.some(room => Math.abs(candidate.x - room.x) < (candidate.w + room.w) / 2 + 2
      && Math.abs(candidate.y - room.y) < (candidate.h + room.h) / 2 + 2);
    if (!blocked) return candidate;
  }
  return null;
}

function roomPlacementClear(candidate, rooms, floor) {
  return !(rooms || []).some(room => room && (room.floor || 0) === floor
    && Math.abs(candidate.x - room.x) < (candidate.w + room.w) / 2 + 2
    && Math.abs(candidate.y - room.y) < (candidate.h + room.h) / 2 + 2);
}

export function pairedStairRoomPlacement(source, rooms, targetFloor) {
  if (!source) return null;
  const sourceFloor = source.floor || 0;
  const sideOffsets = [0, -4, 4, -8, 8, -12, 12];
  const sides = [
    { side: 'east', w: 14, h: 10, x: source.x + source.w / 2 + 10, y: source.y, axis: 'x' },
    { side: 'west', w: 14, h: 10, x: source.x - source.w / 2 - 10, y: source.y, axis: 'x' },
    { side: 'south', w: 10, h: 14, x: source.x, y: source.y + source.h / 2 + 10, axis: 'y' },
    { side: 'north', w: 10, h: 14, x: source.x, y: source.y - source.h / 2 - 10, axis: 'y' }
  ];
  for (const side of sides) {
    for (const offset of sideOffsets) {
      const candidate = {
        x: Math.round(side.x + (side.axis === 'x' ? 0 : offset)),
        y: Math.round(side.y + (side.axis === 'x' ? offset : 0)),
        w: side.w,
        h: side.h,
        side: side.side
      };
      if (roomPlacementClear(candidate, rooms, sourceFloor)
        && roomPlacementClear(candidate, rooms, targetFloor)) return candidate;
    }
  }
  return null;
}

function shiftedPoint(point, delta) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  return {
    x: point.x + (Number.isFinite(delta?.x) ? delta.x : 0),
    y: point.y + (Number.isFinite(delta?.y) ? delta.y : 0)
  };
}

export function translateStairPlacement(stair, visual, delta) {
  const fallback = visual?.lower || null;
  const anchor = shiftedPoint(stair?.anchor || stair?.previewAnchor || fallback, delta);
  const previewAnchor = shiftedPoint(stair?.previewAnchor || stair?.anchor || fallback, delta);
  const movedVisual = visual ? {
    ...visual,
    lower: shiftedPoint(visual.lower, delta),
    turn: shiftedPoint(visual.turn, delta),
    upper: shiftedPoint(visual.upper, delta),
    lowerApproach: shiftedPoint(visual.lowerApproach, delta),
    upperApproach: shiftedPoint(visual.upperApproach, delta)
  } : null;
  return { anchor, previewAnchor, visual: movedVisual };
}

const STAIR_DIRECTIONS = {
  east: { x: 1, y: 0, next: 'south' },
  south: { x: 0, y: 1, next: 'west' },
  west: { x: -1, y: 0, next: 'north' },
  north: { x: 0, y: -1, next: 'east' }
};

function stairLShape(directionName, length, anchor) {
  const first=STAIR_DIRECTIONS[directionName];
  if(!first || !anchor) return null;
  const firstRun=Math.max(3,Math.floor(length/2));
  const secondRun=Math.max(3,length-firstRun);
  const secondName=first.next;
  const second=STAIR_DIRECTIONS[secondName];
  const lower={...anchor};
  const turn={x:lower.x+first.x*firstRun,y:lower.y+first.y*firstRun};
  const upper={x:turn.x+second.x*secondRun,y:turn.y+second.y*secondRun};
  return {lower,turn,upper,first,second,firstRun,secondRun,secondName};
}

function stairShapeCenter(shape) {
  const points=[shape.lower,shape.turn,shape.upper];
  return {
    x:(Math.min(...points.map(point=>point.x))+Math.max(...points.map(point=>point.x)))/2,
    y:(Math.min(...points.map(point=>point.y))+Math.max(...points.map(point=>point.y)))/2
  };
}

export function rotateStairPlacement90(stair, visual) {
  const currentName = stair?.previewDirection || stair?.direction || visual?.direction;
  const current = STAIR_DIRECTIONS[currentName];
  if (!current) return null;
  const nextName = current.next;
  const lower = visual?.lower || stair?.previewAnchor || stair?.anchor;
  const upper = visual?.upper;
  const length = Math.max(1, Math.round(stair?.previewLength || stair?.length
    || (lower && upper ? Math.hypot(upper.x - lower.x, upper.y - lower.y) : 8)));
  if (!lower) return null;
  const currentShape=visual?.turn
    ? {lower,turn:visual.turn,upper}
    : stairLShape(currentName,length,lower);
  const center=stairShapeCenter(currentShape);
  const nextAtOrigin=stairLShape(nextName,length,{x:0,y:0});
  const nextCenter=stairShapeCenter(nextAtOrigin);
  return {
    anchor: {
      x: Math.round(center.x-nextCenter.x),
      y: Math.round(center.y-nextCenter.y)
    },
    direction: nextName,
    length
  };
}

export function stairRotationFromPointer(stair, visual, pointer) {
  const lower = visual?.lower || stair?.previewAnchor || stair?.anchor;
  const upper = visual?.upper;
  if (!lower || !pointer) return null;
  const currentName = stair?.previewDirection || stair?.direction || visual?.direction || 'east';
  const current = STAIR_DIRECTIONS[currentName] || STAIR_DIRECTIONS.east;
  const length = Math.max(1, Math.round(stair?.previewLength || stair?.length
    || (upper ? Math.hypot(upper.x - lower.x, upper.y - lower.y) : 8)));
  const currentShape=visual?.turn
    ? {lower,turn:visual.turn,upper}
    : stairLShape(currentName,length,lower);
  const center=stairShapeCenter(currentShape);
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (Math.hypot(dx, dy) < 0.5) return null;
  const direction = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'east' : 'west')
    : (dy >= 0 ? 'south' : 'north');
  const nextAtOrigin=stairLShape(direction,length,{x:0,y:0});
  const nextCenter=stairShapeCenter(nextAtOrigin);
  return {
    anchor: {
      x: Math.round(center.x-nextCenter.x),
      y: Math.round(center.y-nextCenter.y)
    },
    direction,
    length
  };
}

export function stairVisualForRotation(visual, stair, rotated) {
  const direction = STAIR_DIRECTIONS[rotated?.direction];
  if (!visual || !direction || !rotated?.anchor) return visual || null;
  const length = Math.max(1, Math.round(rotated.length || stair?.previewLength || stair?.length || 8));
  const landingDepth = Math.max(1, Math.round(stair?.previewLandingDepth || stair?.landingDepth || 2));
  const shape=stairLShape(rotated.direction,length,rotated.anchor);
  const {lower,turn,upper,second,secondName,firstRun,secondRun}=shape;
  return {
    ...visual,
    lower,
    turn,
    upper,
    lowerApproach:{x:lower.x-direction.x*landingDepth,y:lower.y-direction.y*landingDepth},
    upperApproach:{x:upper.x+second.x*landingDepth,y:upper.y+second.y*landingDepth},
    direction:rotated.direction,
    secondDirection:secondName,
    directionVector:{x:direction.x,y:direction.y},
    secondDirectionVector:{x:second.x,y:second.y},
    firstRun,
    secondRun,
    length
  };
}

export function adaptRoomToRotatedStair(room, stair, rotated) {
  const direction = STAIR_DIRECTIONS[rotated?.direction];
  if (!room || !direction || !rotated?.anchor) return room ? { ...room } : null;
  const length = Math.max(1, Math.round(rotated.length || stair?.previewLength || stair?.length || 8));
  const landingDepth = Math.max(1, Math.round(stair?.previewLandingDepth || stair?.landingDepth || 2));
  const stairWidth = Math.max(1, Math.round(stair?.previewWidth || stair?.width || 2));
  const shape=stairLShape(rotated.direction,length,rotated.anchor);
  const lowerApproach={x:shape.lower.x-direction.x*landingDepth,y:shape.lower.y-direction.y*landingDepth};
  const upperApproach={x:shape.upper.x+shape.second.x*landingDepth,y:shape.upper.y+shape.second.y*landingDepth};
  const firstOffset = stairWidth <= 1 ? 0 : (stairWidth === 2 ? 0 : -Math.floor(stairWidth / 2));
  const lastOffset = firstOffset + stairWidth - 1;
  const segmentCorners=(start,end,segmentDirection)=>{
    const perpendicular={x:-segmentDirection.y,y:segmentDirection.x};
    return [start,end].flatMap(point=>[firstOffset,lastOffset].map(offset=>({
      x:point.x+perpendicular.x*offset,
      y:point.y+perpendicular.y*offset
    })));
  };
  const corners=[
    ...segmentCorners(lowerApproach,shape.turn,shape.first),
    ...segmentCorners(shape.turn,upperApproach,shape.second)
  ];
  const minX=Math.min(...corners.map(point=>point.x)), maxX=Math.max(...corners.map(point=>point.x));
  const minY=Math.min(...corners.map(point=>point.y)), maxY=Math.max(...corners.map(point=>point.y));
  const center={x:(minX+maxX)/2,y:(minY+maxY)/2};

  if (room.stairRoom) {
    return { ...room, x: Math.round(center.x), y: Math.round(center.y),
      w:Math.max(8,Math.ceil(maxX-minX+2)),h:Math.max(8,Math.ceil(maxY-minY+2)) };
  }

  const inside = Math.abs(center.x - room.x) <= room.w / 2 + 1
    && Math.abs(center.y - room.y) <= room.h / 2 + 1;
  if (!inside) return { ...room };

  // Normal rooms fit the actual tread and landing cells, without an invisible
  // side buffer. A stair already inside the room may therefore sit flush with
  // one wall without making the room frame grow away from the rendered room.
  const halfWidth = Math.max(room.w / 2, room.x-minX, maxX-room.x);
  const halfHeight = Math.max(room.h / 2, room.y-minY, maxY-room.y);
  return { ...room, w: Math.ceil(halfWidth * 2), h: Math.ceil(halfHeight * 2) };
}

export function stairRemovalDisconnectsRooms(rooms, links, removedLink) {
  const active = (rooms || []).filter(room => room && room.roleHint !== 'secret');
  if (active.length < 2) return false;
  const ids = new Set(active.map(room => room.id));
  const adjacency = new Map(active.map(room => [room.id, []]));
  for (const link of links || []) {
    if (link === removedLink || !ids.has(link.a) || !ids.has(link.b)) continue;
    adjacency.get(link.a).push(link.b);
    adjacency.get(link.b).push(link.a);
  }
  const start = active.find(room => room.roleHint === 'entrance') || active[0];
  const seen = new Set([start.id]);
  const queue = [start.id];
  for (let head = 0; head < queue.length; head++) {
    for (const next of adjacency.get(queue[head]) || []) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return active.some(room => !seen.has(room.id));
}

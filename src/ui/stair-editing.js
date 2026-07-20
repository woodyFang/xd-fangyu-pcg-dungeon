import {
  STAIR_DIRECTIONS,
  STAIR_WIDTH,
  normalizeStairStyle,
  snapStairGridPoint,
  snapStairWidth,
  stairLateralCenterOffset,
  stairShape,
  stairTurnPlatformMetrics
} from '../domain/stair-contract.js';

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

export function directStairPlacement(point, style = 'l-turn', length = 8) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const normalizedStyle = style === 'straight' ? 'straight' : 'l-turn';
  const run = Math.max(4, Math.round(Number(length) || 8));
  const {x,y}=snapStairGridPoint(point);
  if (normalizedStyle === 'straight') {
    return { anchor: { x: x - Math.round(run / 2), y }, direction: 'east', length: run, style: normalizedStyle };
  }
  const firstRun = Math.max(3, Math.floor(run / 2));
  const secondRun = Math.max(3, run - firstRun);
  return {
    anchor: { x: x - Math.round(firstRun / 2), y: y - Math.round(secondRun / 2) },
    direction: 'east',
    length: run,
    style: normalizedStyle
  };
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
  return snapStairGridPoint({
    x: point.x + (Number.isFinite(delta?.x) ? delta.x : 0),
    y: point.y + (Number.isFinite(delta?.y) ? delta.y : 0)
  });
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

function stairShapeCenter(shape) {
  const points=[shape.lower,shape.turn,shape.upper].filter(Boolean);
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
  const style=normalizeStairStyle(stair?.previewStyle || stair?.style || visual?.style);
  const currentShape=style==='l-turn' && visual?.turn
    ? {lower,turn:visual.turn,upper}
    : stairShape(style,currentName,length,lower);
  const center=stairShapeCenter(currentShape);
  const nextAtOrigin=stairShape(style,nextName,length,{x:0,y:0});
  const nextCenter=stairShapeCenter(nextAtOrigin);
  return {
    anchor: {
      x: Math.round(center.x-nextCenter.x),
      y: Math.round(center.y-nextCenter.y)
    },
    direction: nextName,
    length,
    style
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
  const style=normalizeStairStyle(stair?.previewStyle || stair?.style || visual?.style);
  const currentShape=style==='l-turn' && visual?.turn
    ? {lower,turn:visual.turn,upper}
    : stairShape(style,currentName,length,lower);
  const center=stairShapeCenter(currentShape);
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  if (Math.hypot(dx, dy) < 0.5) return null;
  const direction = Math.abs(dx) >= Math.abs(dy)
    ? (dx >= 0 ? 'east' : 'west')
    : (dy >= 0 ? 'south' : 'north');
  const nextAtOrigin=stairShape(style,direction,length,{x:0,y:0});
  const nextCenter=stairShapeCenter(nextAtOrigin);
  return {
    anchor: {
      x: Math.round(center.x-nextCenter.x),
      y: Math.round(center.y-nextCenter.y)
    },
    direction,
    length,
    style
  };
}

export function changeStairStyle(stair, visual, requestedStyle) {
  const style=normalizeStairStyle(requestedStyle);
  const currentStyle=normalizeStairStyle(stair?.previewStyle || stair?.style || visual?.style);
  const direction=stair?.previewDirection || stair?.direction || visual?.direction || 'east';
  const lower=visual?.lower || stair?.previewAnchor || stair?.anchor;
  const upper=visual?.upper;
  if(!lower || !STAIR_DIRECTIONS[direction]) return null;
  const length=Math.max(1,Math.round(stair?.previewLength || stair?.length
    || (upper ? Math.hypot(upper.x-lower.x,upper.y-lower.y) : 8)));
  const currentShape=currentStyle==='l-turn' && visual?.turn
    ? {lower,turn:visual.turn,upper}
    : stairShape(currentStyle,direction,length,lower);
  const center=stairShapeCenter(currentShape);
  const nextAtOrigin=stairShape(style,direction,length,{x:0,y:0});
  const nextCenter=stairShapeCenter(nextAtOrigin);
  return {
    anchor:{x:Math.round(center.x-nextCenter.x),y:Math.round(center.y-nextCenter.y)},
    direction,
    length,
    style
  };
}

export function stairVisualForRotation(visual, stair, rotated) {
  const direction = STAIR_DIRECTIONS[rotated?.direction];
  if (!visual || !direction || !rotated?.anchor) return visual || null;
  const length = Math.max(1, Math.round(rotated.length || stair?.previewLength || stair?.length || 8));
  const landingDepth = Math.max(1, Math.round(stair?.previewLandingDepth || stair?.landingDepth || 2));
  const style=normalizeStairStyle(rotated.style || stair?.previewStyle || stair?.style || visual?.style);
  const shape=stairShape(style,rotated.direction,length,rotated.anchor);
  const {lower,turn,upper,second,secondName,firstRun,secondRun}=shape;
  return {
    ...visual,
    style,
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
  const visualWidth = Math.max(1, Number(stair?.previewWidth || stair?.width || 2));
  const stairWidth = Math.max(1, Math.ceil(visualWidth));
  const lateralCenterOffset=Number.isFinite(Number(stair?.previewLateralCenterOffset))
    ? Number(stair.previewLateralCenterOffset)
    : (Number.isFinite(Number(stair?.lateralCenterOffset)) ? Number(stair.lateralCenterOffset) : null);
  const style=normalizeStairStyle(rotated.style || stair?.previewStyle || stair?.style);
  const shape=stairShape(style,rotated.direction,length,rotated.anchor);
  const lowerApproach={x:shape.lower.x-direction.x*landingDepth,y:shape.lower.y-direction.y*landingDepth};
  const upperApproach={x:shape.upper.x+shape.second.x*landingDepth,y:shape.upper.y+shape.second.y*landingDepth};
  const firstOffset = lateralCenterOffset===null
    ? -Math.floor((stairWidth-1)/2)
    : Math.round(lateralCenterOffset-(stairWidth-1)/2);
  const lastOffset = firstOffset + stairWidth - 1;
  const segmentCorners=(start,end,segmentDirection)=>{
    const perpendicular={x:-segmentDirection.y,y:segmentDirection.x};
    return [start,end].flatMap(point=>[firstOffset,lastOffset].map(offset=>({
      x:point.x+perpendicular.x*offset,
      y:point.y+perpendicular.y*offset
    })));
  };
  let corners;
  if(shape.turn){
    const platform=stairTurnPlatformMetrics({
      ...shape,width:visualWidth,lateralCenterOffset,
      directionVector:shape.first,secondDirectionVector:shape.second
    });
    const half=visualWidth/2;
    const visualSegmentCorners=(start,end,segmentDirection)=>{
      const perpendicular={x:-segmentDirection.y,y:segmentDirection.x};
      return [start,end].flatMap(point=>[-half,half].map(offset=>({
        x:point.x+perpendicular.x*offset,
        y:point.y+perpendicular.y*offset
      })));
    };
    const firstApproach={
      x:platform.first.start.x-shape.first.x*landingDepth,
      y:platform.first.start.y-shape.first.y*landingDepth
    };
    const secondApproach={
      x:platform.second.end.x+shape.second.x*landingDepth,
      y:platform.second.end.y+shape.second.y*landingDepth
    };
    corners=[
      ...visualSegmentCorners(firstApproach,platform.entry,shape.first),
      ...visualSegmentCorners(platform.exit,secondApproach,shape.second),
      {x:platform.center.x-half,y:platform.center.y-half},
      {x:platform.center.x+half,y:platform.center.y-half},
      {x:platform.center.x+half,y:platform.center.y+half},
      {x:platform.center.x-half,y:platform.center.y+half}
    ];
  }else{
    corners=segmentCorners(lowerApproach,upperApproach,shape.first);
  }
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
  const halfWidth = Math.max(room.w / 2, room.x-minX+.5, maxX-room.x+.5);
  const halfHeight = Math.max(room.h / 2, room.y-minY+.5, maxY-room.y+.5);
  return { ...room, w: Math.ceil(halfWidth * 2), h: Math.ceil(halfHeight * 2) };
}

export function stairWidthFromPointer(stair, visual, pointer, {
  min=STAIR_WIDTH.min,max=STAIR_WIDTH.max,step=STAIR_WIDTH.step,handleGap=1
}={}) {
  const start=visual?.lower || stair?.previewAnchor || stair?.anchor;
  const end=visual?.turn || visual?.upper;
  if(!start || !end || !pointer) return null;
  const dx=end.x-start.x, dy=end.y-start.y, length=Math.hypot(dx,dy);
  if(length<0.001) return null;
  const perpendicular={x:-dy/length,y:dx/length};
  const center={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
  const distance=Math.abs((pointer.x-center.x)*perpendicular.x+(pointer.y-center.y)*perpendicular.y);
  const rawWidth=Math.max(0,distance-handleGap)*2;
  return snapStairWidth(rawWidth,{min,max,step});
}

export function stairWidthResizeFromPointer(stair, visual, pointer, {
  min=STAIR_WIDTH.min,max=STAIR_WIDTH.max,step=STAIR_WIDTH.step,handleGap=1,startPointer=null
}={}) {
  const start=visual?.lower || stair?.previewAnchor || stair?.anchor;
  const end=visual?.turn || visual?.upper;
  if(!start || !end || !pointer) return null;
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
  if(length<0.001) return null;
  const perpendicular={x:-dy/length,y:dx/length};
  const startWidth=snapStairWidth(visual?.width || stair?.previewWidth || stair?.width || 2,{min,max,step});
  const rawStartOffset=Number.isFinite(Number(visual?.lateralCenterOffset))
    ? Number(visual.lateralCenterOffset)
    : (Number.isFinite(Number(stair?.previewLateralCenterOffset))
      ? Number(stair.previewLateralCenterOffset)
      : (Number.isFinite(Number(stair?.lateralCenterOffset)) ? Number(stair.lateralCenterOffset) : 0));
  const startOffset=stairLateralCenterOffset(startWidth,rawStartOffset);
  const rawCenter={
    x:(start.x+end.x)/2,
    y:(start.y+end.y)/2
  };
  const fixedEdge={
    x:rawCenter.x+perpendicular.x*(startOffset-startWidth/2),
    y:rawCenter.y+perpendicular.y*(startOffset-startWidth/2)
  };
  // Real canvas drags use their pointer-down position as the baseline. This
  // keeps the resize responsive even when the user grabs the enlarged hit
  // area a few pixels away from the exact handle centre. Direct callers may
  // still provide only the current pointer and use the absolute edge formula.
  const dragDelta=startPointer
    ? (pointer.x-startPointer.x)*perpendicular.x+(pointer.y-startPointer.y)*perpendicular.y
    : null;
  const pointerDistance=(pointer.x-fixedEdge.x)*perpendicular.x+(pointer.y-fixedEdge.y)*perpendicular.y;
  const rawWidth=Math.max(0,dragDelta===null ? pointerDistance-handleGap : startWidth+dragDelta);
  const width=snapStairWidth(rawWidth,{min,max,step});
  return {
    width,
    lateralCenterOffset:stairLateralCenterOffset(width,startOffset+(width-startWidth)/2)
  };
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

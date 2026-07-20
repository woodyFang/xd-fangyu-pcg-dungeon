export const STAIR_WIDTH = Object.freeze({ min:1, max:5, step:1, defaultValue:2 });
export const STAIR_PLACEMENT_GRID = 1;

export function snapStairGridValue(value, grid = STAIR_PLACEMENT_GRID) {
  const numeric=Number(value);
  const step=Number.isFinite(Number(grid))&&Number(grid)>0 ? Number(grid) : STAIR_PLACEMENT_GRID;
  if(!Number.isFinite(numeric)) return null;
  const snapped=Math.round(numeric/step)*step;
  return Object.is(snapped,-0) ? 0 : Number(snapped.toFixed(6));
}

export function snapStairGridPoint(point, grid = STAIR_PLACEMENT_GRID) {
  if(!point) return null;
  const x=snapStairGridValue(point.x,grid),y=snapStairGridValue(point.y,grid);
  return x===null||y===null ? null : {...point,x,y};
}

export const STAIR_DIRECTIONS = Object.freeze({
  east: Object.freeze({ x:1, y:0, name:'east', next:'south' }),
  south:Object.freeze({ x:0, y:1, name:'south', next:'west' }),
  west: Object.freeze({ x:-1,y:0, name:'west', next:'north' }),
  north:Object.freeze({ x:0, y:-1,name:'north', next:'east' })
});

export function normalizeStairStyle(style) {
  return style === 'straight' ? 'straight' : 'l-turn';
}

export function snapStairWidth(width, {
  min=STAIR_WIDTH.min,max=STAIR_WIDTH.max,step=STAIR_WIDTH.step
}={}) {
  const value=Number.isFinite(Number(width))?Number(width):STAIR_WIDTH.defaultValue;
  const snapped=Math.round(value/step)*step;
  return Number(Math.max(min,Math.min(max,snapped)).toFixed(4));
}

export function stairGridSpan(width = 1) {
  return snapStairWidth(width);
}

export function stairLateralCenterOffset(width = 1, preservedOffset) {
  const normalizedWidth=snapStairWidth(width);
  const base=normalizedWidth%2===0?.5:0;
  if(!Number.isFinite(Number(preservedOffset))) return base;
  return base+Math.round((Number(preservedOffset)-base)/STAIR_PLACEMENT_GRID)*STAIR_PLACEMENT_GRID;
}

export function stairRunCenter(point, direction, width = 1, preservedOffset) {
  const offset=stairLateralCenterOffset(width,preservedOffset);
  return {
    x:point.x-direction.y*offset,
    y:point.y+direction.x*offset
  };
}

export function stairTurnDirection(direction) {
  const sourceName=direction?.name || Object.keys(STAIR_DIRECTIONS)
    .find(name=>STAIR_DIRECTIONS[name].x===direction?.x && STAIR_DIRECTIONS[name].y===direction?.y);
  const nextName=STAIR_DIRECTIONS[sourceName]?.next;
  if(nextName) return { ...STAIR_DIRECTIONS[nextName] };
  return { x:-direction.y, y:direction.x, name:null, next:null };
}

export function stairShape(style, directionName, length, anchor) {
  const first=STAIR_DIRECTIONS[directionName];
  if(!first || !anchor) return null;
  const normalizedStyle=normalizeStairStyle(style);
  const lower=snapStairGridPoint(anchor);
  if(!lower) return null;
  if(normalizedStyle==='straight'){
    const upper={x:lower.x+first.x*length,y:lower.y+first.y*length};
    return {style:normalizedStyle,lower,turn:null,upper,first,second:first,
      firstRun:length,secondRun:0,secondName:directionName};
  }
  const firstRun=Math.max(3,Math.floor(length/2));
  const secondRun=Math.max(3,length-firstRun);
  const secondName=first.next;
  const second=STAIR_DIRECTIONS[secondName];
  const turn={x:lower.x+first.x*firstRun,y:lower.y+first.y*firstRun};
  const upper={x:turn.x+second.x*secondRun,y:turn.y+second.y*secondRun};
  return {style:normalizedStyle,lower,turn,upper,first,second,firstRun,secondRun,secondName};
}

export function stairEndpoints(lower, direction, run, style = 'l-turn') {
  const snappedLower=snapStairGridPoint(lower);
  if(!snappedLower) return null;
  const directionName=direction?.name || Object.keys(STAIR_DIRECTIONS)
    .find(name=>STAIR_DIRECTIONS[name].x===direction?.x && STAIR_DIRECTIONS[name].y===direction?.y);
  const shape=stairShape(style,directionName,run,snappedLower);
  if(shape){
    return {
      turn:shape.turn,
      upper:shape.upper,
      secondDirection:{...shape.second},
      firstRun:shape.firstRun,
      secondRun:shape.secondRun
    };
  }
  const normalizedStyle=normalizeStairStyle(style);
  if(normalizedStyle==='straight'){
    return {turn:null,upper:{x:snappedLower.x+direction.x*run,y:snappedLower.y+direction.y*run},
      secondDirection:{...direction},firstRun:run,secondRun:0};
  }
  const firstRun=Math.max(3,Math.floor(run/2));
  const secondRun=Math.max(3,run-firstRun);
  const secondDirection=stairTurnDirection(direction);
  const turn={x:snappedLower.x+direction.x*firstRun,y:snappedLower.y+direction.y*firstRun};
  return {turn,upper:{x:turn.x+secondDirection.x*secondRun,y:turn.y+secondDirection.y*secondRun},
    secondDirection,firstRun,secondRun};
}

export function resolveStairStructure({
  lower,
  direction,
  run,
  width=STAIR_WIDTH.defaultValue,
  style='l-turn',
  lateralCenterOffset
}) {
  const snappedLower=snapStairGridPoint(lower);
  const normalizedWidth=snapStairWidth(width);
  const normalizedLateralOffset=stairLateralCenterOffset(normalizedWidth,lateralCenterOffset);
  const normalizedStyle=normalizeStairStyle(style);
  const endpoints=stairEndpoints(snappedLower,direction,run,normalizedStyle);
  const platform=normalizedStyle==='l-turn' ? stairTurnPlatformMetrics({
    lower:snappedLower,
    turn:endpoints.turn,
    upper:endpoints.upper,
    firstRun:endpoints.firstRun,
    secondRun:endpoints.secondRun,
    width:normalizedWidth,
    lateralCenterOffset:normalizedLateralOffset,
    directionVector:direction,
    secondDirectionVector:endpoints.secondDirection
  }) : null;
  return {
    style:normalizedStyle,
    lower:{...snappedLower},
    turn:endpoints.turn ? {...endpoints.turn} : null,
    anchorUpper:{...endpoints.upper},
    direction:{...direction},
    secondDirection:{...endpoints.secondDirection},
    firstRun:endpoints.firstRun,
    secondRun:endpoints.secondRun,
    width:normalizedWidth,
    lateralCenterOffset:normalizedLateralOffset,
    platform,
    visualUpper:platform ? {...platform.second.end} : stairRunCenter(
      endpoints.upper,endpoints.secondDirection,normalizedWidth,normalizedLateralOffset
    )
  };
}

export function stairTurnPlatformMetrics(connector) {
  if(!connector?.turn) return null;
  const firstRun=Number.isFinite(Number(connector.firstRun))
    ? Math.max(0,Number(connector.firstRun))
    : (connector.lower ? Math.hypot(connector.turn.x-connector.lower.x,connector.turn.y-connector.lower.y) : 0);
  const secondRun=Number.isFinite(Number(connector.secondRun))
    ? Math.max(0,Number(connector.secondRun))
    : (connector.upper ? Math.hypot(connector.upper.x-connector.turn.x,connector.upper.y-connector.turn.y) : 0);
  const inferredFirst=connector?.lower
    ? {x:connector.turn.x-connector.lower.x,y:connector.turn.y-connector.lower.y}
    : {x:1,y:0};
  const inferredFirstLength=Math.max(.001,Math.hypot(inferredFirst.x,inferredFirst.y));
  const first=connector.directionVector || {x:inferredFirst.x/inferredFirstLength,y:inferredFirst.y/inferredFirstLength};
  const inferredSecond=connector?.upper
    ? {x:connector.upper.x-connector.turn.x,y:connector.upper.y-connector.turn.y}
    : {x:-first.y,y:first.x};
  const inferredSecondLength=Math.max(.001,Math.hypot(inferredSecond.x,inferredSecond.y));
  const second=connector.secondDirectionVector || {x:inferredSecond.x/inferredSecondLength,y:inferredSecond.y/inferredSecondLength};
  const visualWidth=snapStairWidth(connector.width);
  const offset=stairLateralCenterOffset(visualWidth,connector.lateralCenterOffset);
  const firstStart=stairRunCenter(connector.lower || connector.turn,first,visualWidth,offset);
  const entry={x:firstStart.x+first.x*firstRun,y:firstStart.y+first.y*firstRun};
  const center={x:entry.x+first.x*visualWidth/2,y:entry.y+first.y*visualWidth/2};
  const exit={x:center.x+second.x*visualWidth/2,y:center.y+second.y*visualWidth/2};
  const secondEnd={x:exit.x+second.x*secondRun,y:exit.y+second.y*secondRun};
  return {
    center,entry,exit,
    first:{start:firstStart,end:entry,direction:first,length:firstRun},
    second:{start:exit,end:secondEnd,direction:second,length:secondRun},
    visualSpan:visualWidth,
    gridSpan:stairGridSpan(visualWidth),
    offset
  };
}

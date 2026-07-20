export function dungeonEditorOffset(dungeon) {
  const fallback={x:(dungeon?.W || 0)/2-.5,y:(dungeon?.H || 0)/2-.5};
  const source=dungeon?.editorOffset;
  return {
    x:Number.isFinite(source?.x)?source.x:fallback.x,
    y:Number.isFinite(source?.y)?source.y:fallback.y
  };
}

export function dungeonLayerShift(dungeon) {
  const offset=dungeonEditorOffset(dungeon);
  return {
    x:(dungeon.W || 0)/2-.5-offset.x,
    y:(dungeon.H || 0)/2-.5-offset.y
  };
}

export function gridToEditorPoint(dungeon,point) {
  const offset=dungeonEditorOffset(dungeon);
  return {...point,x:point.x-offset.x,y:point.y-offset.y};
}

export function editorToGridPoint(dungeon,point) {
  const offset=dungeonEditorOffset(dungeon);
  return {...point,x:point.x+offset.x,y:point.y+offset.y};
}

export function corridorCenterOffset(width) {
  return Math.round(width)%2===0?.5:0;
}

// A width-two corridor occupies [cell, cell + 1], so its centre is shifted
// half a cell only across the corridor, not along it. At a turn both
// perpendicular shifts meet at the same corner point.
export function corridorCenterShiftAt(points,index,width) {
  const off=corridorCenterOffset(width);
  if(!off || !Array.isArray(points) || index<0 || index>=points.length) return {x:0,y:0};
  const shifts=[];
  const add=(a,b)=>{
    if(!a || !b || (a.x===b.x && a.y===b.y)) return;
    if(a.y===b.y) shifts.push({x:0,y:off});
    else if(a.x===b.x) shifts.push({x:off,y:0});
    else shifts.push({x:off,y:off});
  };
  add(points[index-1],points[index]);
  add(points[index],points[index+1]);
  return {
    x:shifts.some(s=>s.x!==0)?off:0,
    y:shifts.some(s=>s.y!==0)?off:0
  };
}

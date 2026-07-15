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
  return Math.round(width)===2?.5:0;
}

const CELL_FIELDS = ['grid', 'corridor', 'doorway', 'bfs', 'lakeMask'];
const DETAIL_FIELDS = ['props', 'spawns', 'torches', 'pools', 'lakeCells', 'arches'];
const SEMANTIC_FIELDS = ['type', 'depth', 'difficulty', 'lake', 'grave'];

function offsetOf(dungeon) {
  return dungeon?.editorOffset || { x:(dungeon?.W || 0) / 2, y:(dungeon?.H || 0) / 2 };
}

function roomKey(room, offset) {
  return [room.floor || 0, Math.round(room.cx - offset.x), Math.round(room.cy - offset.y), room.w, room.h].join(':');
}

function stairCell(layer, cell) {
  return !!(layer.stairMask?.[cell] || layer.stairClearance?.[cell] || layer.stairLanding?.[cell] || layer.slabOpening?.[cell]);
}

function protectAround(protectedCells, W, H, x, y, radius = 2) {
  for (let oy = -radius; oy <= radius; oy++) for (let ox = -radius; ox <= radius; ox++) {
    const nx=x+ox, ny=y+oy;
    if(nx>=0 && ny>=0 && nx<W && ny<H) protectedCells.add(ny*W+nx);
  }
}

function cloneTyped(source, fallback, fill) {
  const result = source?.slice ? source.slice() : new fallback();
  if(fill !== undefined && !source) result.fill(fill);
  return result;
}

function remapLayer(previousDungeon, nextDungeon, previousLayer, nextLayer, roomIdMap) {
  const oldOffset=offsetOf(previousDungeon), newOffset=offsetOf(nextDungeon);
  const oldW=previousDungeon.W, oldH=previousDungeon.H, newW=nextDungeon.W, newH=nextDungeon.H;
  const result={...nextLayer};
  result.grid=cloneTyped(nextLayer.grid,Uint8Array);
  result.roomId=cloneTyped(nextLayer.roomId,Int16Array,-1);
  result.corridor=cloneTyped(nextLayer.corridor,Uint8Array);
  result.corridorOwner=cloneTyped(nextLayer.corridorOwner,Int32Array,-1);
  result.doorway=cloneTyped(nextLayer.doorway,Uint8Array);
  result.stairMask=cloneTyped(nextLayer.stairMask,Uint8Array);
  result.stairClearance=cloneTyped(nextLayer.stairClearance,Uint8Array);
  result.stairLanding=cloneTyped(nextLayer.stairLanding,Uint8Array);
  result.slabOpening=cloneTyped(nextLayer.slabOpening,Uint8Array);
  result.bfs=cloneTyped(nextLayer.bfs,Int32Array,-1);
  result.lakeMask=cloneTyped(nextLayer.lakeMask,Uint8Array);

  const protectedCells=new Set();
  for(let cell=0;cell<nextLayer.grid.length;cell++) if(stairCell(nextLayer,cell)) protectAround(protectedCells,newW,newH,cell%newW,Math.floor(cell/newW));
  for(let cell=0;cell<previousLayer.grid.length;cell++) if(stairCell(previousLayer,cell)) {
    const oldX=cell%oldW, oldY=Math.floor(cell/oldW);
    const x=Math.round(oldX-oldOffset.x+newOffset.x), y=Math.round(oldY-oldOffset.y+newOffset.y);
    if(x>=0 && y>=0 && x<newW && y<newH) protectAround(protectedCells,newW,newH,x,y);
  }

  for(let oldY=0;oldY<oldH;oldY++) for(let oldX=0;oldX<oldW;oldX++) {
    const x=Math.round(oldX-oldOffset.x+newOffset.x), y=Math.round(oldY-oldOffset.y+newOffset.y);
    if(x<0 || y<0 || x>=newW || y>=newH) continue;
    const from=oldY*oldW+oldX, to=y*newW+x;
    if(protectedCells.has(to)) continue;
    for(const field of CELL_FIELDS) if(previousLayer[field] && result[field]) result[field][to]=previousLayer[field][from];
    const previousRoomId=previousLayer.roomId?.[from] ?? -1;
    result.roomId[to]=previousRoomId>=0 ? (roomIdMap.get(previousRoomId) ?? -1) : -1;
  }

  const translateRecord=record=>{
    const x=Math.round(record.x-oldOffset.x+newOffset.x), y=Math.round(record.y-oldOffset.y+newOffset.y);
    if(x<0 || y<0 || x>=newW || y>=newH || protectedCells.has(y*newW+x)) return null;
    const roomId=Number.isInteger(record.roomId) && record.roomId>=0 ? (roomIdMap.get(record.roomId) ?? -1) : record.roomId;
    return {...record,x,y,roomId,floor:nextLayer.floor};
  };
  for(const field of DETAIL_FIELDS) result[field]=(previousLayer[field] || []).map(translateRecord).filter(Boolean);
  result.maxBfs=previousLayer.maxBfs;
  result.targetRoomCount=nextLayer.targetRoomCount;
  result.generatedRoomCount=nextLayer.generatedRoomCount;
  result.loopChance=nextLayer.loopChance;
  result.decorDensity=nextLayer.decorDensity;
  return result;
}

export function preserveUneditedFloors(previousDungeon, nextDungeon, editedFloors) {
  if(!previousDungeon || !nextDungeon || !Array.isArray(previousDungeon.layers) || !Array.isArray(nextDungeon.layers)) return nextDungeon;
  const edited=new Set(editedFloors || []);
  const oldOffset=offsetOf(previousDungeon), newOffset=offsetOf(nextDungeon);
  const nextRoomsByKey=new Map(nextDungeon.rooms.map(room=>[roomKey(room,newOffset),room]));
  const roomIdMap=new Map();
  for(const oldRoom of previousDungeon.rooms){
    const nextRoom=nextRoomsByKey.get(roomKey(oldRoom,oldOffset));
    if(!nextRoom) continue;
    roomIdMap.set(oldRoom.id,nextRoom.id);
    if(!edited.has(oldRoom.floor||0)) for(const field of SEMANTIC_FIELDS){
      if(field in oldRoom) nextRoom[field]=oldRoom[field]; else delete nextRoom[field];
    }
  }
  for(let floor=0;floor<nextDungeon.layers.length;floor++){
    if(edited.has(floor) || !previousDungeon.layers[floor]) continue;
    nextDungeon.layers[floor]=remapLayer(previousDungeon,nextDungeon,previousDungeon.layers[floor],nextDungeon.layers[floor],roomIdMap);
  }
  const base=nextDungeon.layers[0];
  if(base){
    for(const field of ['grid','roomId','corridor','doorway','bfs','maxBfs','props','spawns','torches','pools','lakeCells','lakeMask','arches']) nextDungeon[field]=base[field];
  }
  return nextDungeon;
}

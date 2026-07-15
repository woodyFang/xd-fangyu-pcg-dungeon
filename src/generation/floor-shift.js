export const FLOOR_ALIGNMENT_OFFSETS = Object.freeze([
  { x:4, y:0 }, { x:-4, y:0 }, { x:0, y:4 }, { x:0, y:-4 },
  { x:8, y:0 }, { x:-8, y:0 }, { x:0, y:8 }, { x:0, y:-8 },
  { x:6, y:6 }, { x:-6, y:6 }, { x:6, y:-6 }, { x:-6, y:-6 }
]);

export function translateFloorLayout(rooms, links, floor, dx, dy) {
  const floorById = new Map((rooms || []).map(room => [room.id, room.floor || 0]));
  const translatedRooms = (rooms || []).map(room => (room.floor || 0) === floor
    ? { ...room, x:room.x + dx, y:room.y + dy }
    : { ...room });
  const translatedLinks = (links || []).map(link => {
    const sameFloor = floorById.get(link.a) === floor && floorById.get(link.b) === floor;
    if (!sameFloor || !Array.isArray(link.bends) || !link.bends.length) return { ...link };
    return { ...link, bends:link.bends.map(point => ({ ...point, x:point.x + dx, y:point.y + dy })) };
  });
  return { rooms:translatedRooms, links:translatedLinks };
}

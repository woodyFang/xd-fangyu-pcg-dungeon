export function snapRouteControlPoint(point, targets, tolerance, snap = value => value) {
  let x = point.x;
  let y = point.y;
  let distanceX = tolerance;
  let distanceY = tolerance;
  for (const target of targets || []) {
    const dx = Math.abs(point.x - target.x);
    const dy = Math.abs(point.y - target.y);
    if (dx < distanceX) {
      distanceX = dx;
      x = target.x;
    }
    if (dy < distanceY) {
      distanceY = dy;
      y = target.y;
    }
  }
  return {
    x: snap(x),
    y: snap(y),
    snappedX: distanceX < tolerance,
    snappedY: distanceY < tolerance
  };
}

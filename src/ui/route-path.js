export function simplifyRoutePoints(points, epsilon = 1e-6) {
  const compact = [];
  for (const point of points || []) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const previous = compact[compact.length - 1];
    if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) <= epsilon) continue;
    compact.push(point);
  }

  let changed = true;
  while (changed && compact.length > 2) {
    changed = false;
    for (let i = 1; i < compact.length - 1; i++) {
      const a = compact[i - 1];
      const b = compact[i];
      const c = compact[i + 1];
      const sameX = Math.abs(a.x - b.x) <= epsilon && Math.abs(b.x - c.x) <= epsilon;
      const sameY = Math.abs(a.y - b.y) <= epsilon && Math.abs(b.y - c.y) <= epsilon;
      const continuesX = sameX && (b.y - a.y) * (c.y - b.y) >= -epsilon;
      const continuesY = sameY && (b.x - a.x) * (c.x - b.x) >= -epsilon;
      if (!continuesX && !continuesY) continue;
      compact.splice(i, 1);
      changed = true;
      break;
    }
  }
  return compact;
}

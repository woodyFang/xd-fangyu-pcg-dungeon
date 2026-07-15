function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

export function adaptRouteBends(bends, fromStart, fromEnd, toStart, toEnd) {
  if (!Array.isArray(bends) || !bends.length) return [];
  if (![fromStart, fromEnd, toStart, toEnd].every(finitePoint)) return bends.map(point => ({ ...point }));

  const path = [fromStart, ...bends, fromEnd];
  const cumulative = new Float64Array(path.length);
  for (let index = 1; index < path.length; index++) {
    cumulative[index] = cumulative[index - 1]
      + Math.hypot(path[index].x - path[index - 1].x, path[index].y - path[index - 1].y);
  }
  const total = cumulative[cumulative.length - 1];
  const startDelta = { x: toStart.x - fromStart.x, y: toStart.y - fromStart.y };
  const endDelta = { x: toEnd.x - fromEnd.x, y: toEnd.y - fromEnd.y };

  return bends.map((point, index) => {
    const weight = total > 1e-6 ? cumulative[index + 1] / total : (index + 1) / (bends.length + 1);
    return {
      ...point,
      x: point.x + startDelta.x * (1 - weight) + endDelta.x * weight,
      y: point.y + startDelta.y * (1 - weight) + endDelta.y * weight
    };
  });
}

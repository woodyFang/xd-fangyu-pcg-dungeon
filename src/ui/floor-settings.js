function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  const resolved = Number.isFinite(number) ? number : fallback;
  return Math.max(min, Math.min(max, Math.round(resolved)));
}

export function normalizeFloorValues(values, count, { fallback, min, max }) {
  const wanted = Math.max(1, Math.min(6, Math.round(Number(count) || 1)));
  const source = Array.isArray(values) ? values : [];
  const result = source.slice(0, wanted).map(value => boundedInteger(value, fallback, min, max));
  while (result.length < wanted) result.push(result[result.length - 1] ?? fallback);
  return result;
}

export function updateFloorValue(values, floor, value, options) {
  const index = Math.max(0, Math.round(Number(floor) || 0));
  const result = normalizeFloorValues(values, Math.max(values?.length || 0, index + 1), options);
  result[index] = boundedInteger(value, options.fallback, options.min, options.max);
  return result;
}

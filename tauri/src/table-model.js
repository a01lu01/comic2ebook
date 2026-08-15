export const DEFAULT_ORDER = ["comic", "status", "progress", "formats", "actions"];

export const DEFAULT_WIDTHS = {
  comic: 240,
  status: 110,
  progress: 160,
  formats: 300,
  actions: 180,
};

export const MIN_WIDTHS = {
  comic: 120,
  status: 90,
  progress: 120,
  formats: 160,
  actions: 140,
};

export function clampWidths(widths = {}) {
  const out = {};
  for (const key of Object.keys(MIN_WIDTHS)) {
    out[key] = Math.max(MIN_WIDTHS[key], widths[key] || DEFAULT_WIDTHS[key]);
  }
  return out;
}

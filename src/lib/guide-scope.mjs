const clean = value => String(value ?? '').trim();

/** Capture-all uses a deterministic Workbench country/crop/season, not a stale cookie. */
export function resolveGuideScope(args = {}, config = {}) {
  if (args.noGuideScope === true) return null;
  const defaultScope = config.coverage?.scope ?? {};
  const season = clean(args.season ?? defaultScope.season);
  const crop = clean(args.crop ?? defaultScope.crop);
  const country = clean(args.country ?? defaultScope.country);
  if (![season, crop, country].some(Boolean)) return null;
  if (!/^\d{4}$/.test(season)) throw new Error('Guide scope needs --season YYYY (for example 2027).');
  if (!/^[A-Za-z][A-Za-z0-9_-]{1,30}$/.test(crop) || !/^[A-Za-z]{2,30}$/.test(country)) {
    throw new Error('Guide scope needs valid --crop and --country values.');
  }
  return { season, crop, country };
}

export function isWorkbenchCaptureUrl(url, config = {}) {
  try {
    const target = new URL(url);
    const base = new URL(config.baseUrl);
    const path = config.map?.workbenchPath ?? '/arcgis/orchard-workbench';
    return target.origin === base.origin && target.pathname === path;
  } catch {
    return false;
  }
}

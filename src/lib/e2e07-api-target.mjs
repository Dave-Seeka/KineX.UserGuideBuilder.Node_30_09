/**
 * Named API environment selection for E2E-07. This is intentionally separate
 * from the Guide Builder's browser baseUrl (the KineX.WEB host).
 */
export function validateApiTarget(baseUrl) {
  let url;
  try { url = new URL(baseUrl); }
  catch { throw new Error('API target baseUrl must be an absolute HTTP(S) origin.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('API target baseUrl must be an HTTP(S) origin without credentials, path, query or fragment.');
  }
  const hostname = url.hostname.toLowerCase();
  if (!(hostname === 'localhost' || hostname === '127.0.0.1' || hostname.endsWith('.test'))) {
    throw new Error('API target refuses non-test hosts; use localhost, 127.0.0.1 or *.test.');
  }
  if (url.protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error('Nonlocal test APIs require HTTPS.');
  }
  return { baseUrl: url.origin, approvedTestHost: hostname };
}

export function listApiTargets(guideConfig) {
  const entries = guideConfig?.apiTargets;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) {
    throw new Error('Guide config must define apiTargets as a named object.');
  }
  return Object.entries(entries).map(([name, target]) => {
    if (!/^[a-z][a-z0-9-]{0,40}$/.test(name)) {
      throw new Error(`Invalid API target name '${name}'. Use lower-case letters, digits and hyphens.`);
    }
    if (!target || typeof target !== 'object' || Array.isArray(target)
        || typeof target.baseUrl !== 'string') {
      throw new Error(`API target '${name}' must contain baseUrl.`);
    }
    return { name, ...validateApiTarget(target.baseUrl) };
  });
}

export function selectApiTarget(guideConfig, targetName, scenario) {
  if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) {
    throw new Error('A scenario object is required to select an API target.');
  }
  const target = listApiTargets(guideConfig).find(entry => entry.name === targetName);
  if (!target) {
    throw new Error(`Unknown API target '${targetName}'. Run --targets to list configured targets.`);
  }
  // Copy: a target switch must update the E2E-07 fingerprint, but must never
  // silently rewrite the user's saved scenario or alter the browser baseUrl.
  return { ...scenario, apiBaseUrl: target.baseUrl, approvedTestHost: target.approvedTestHost };
}

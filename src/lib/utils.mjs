import fs from 'node:fs/promises';

export function absoluteUrl(baseUrl, pathOrUrl) {
  if (!pathOrUrl) return baseUrl;
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    return new URL(pathOrUrl, ensureTrailingSlash(baseUrl)).toString();
  }
}

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function ensureTrailingSlash(value) {
  return value.endsWith('/') ? value : `${value}/`;
}

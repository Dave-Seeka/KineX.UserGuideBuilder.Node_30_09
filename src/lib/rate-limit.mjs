export function isRateLimitSkip(message) {
  const normalized = String(message ?? '').toLowerCase();
  return normalized.includes('rate limit') ||
    normalized.includes('rate limited') ||
    normalized.includes('temporarily unavailable');
}

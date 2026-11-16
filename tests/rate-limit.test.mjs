import test from 'node:test';
import assert from 'node:assert/strict';
import { isRateLimitSkip } from '../src/lib/rate-limit.mjs';

test('isRateLimitSkip detects throttling and temporary create availability', () => {
  assert.equal(isRateLimitSkip('Create-form options are temporarily rate limited.'), true);
  assert.equal(isRateLimitSkip('Create Orchard is temporarily unavailable for the current session.'), true);
  assert.equal(isRateLimitSkip('No Orchard with Blocks is available.'), false);
});

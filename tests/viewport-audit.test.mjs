import test from 'node:test';
import assert from 'node:assert/strict';
import { auditViewport, resolveViewport } from '../src/lib/viewport-audit.mjs';

const config = {
  viewport: { width: 1440, height: 900 },
  viewports: { laptop: { width: 1366, height: 768 } },
  viewportAudit: {
    enabled: true,
    horizontalOverflowTolerance: 2,
    overlayTolerance: 3,
    overlaySelectors: ["[role='dialog']"]
  },
  coverage: { profile: 'full' }
};

test('laptop profiles override flow-specific desktop viewports', () => {
  const flow = { viewport: { width: 1600, height: 1000 } };
  assert.deepEqual(resolveViewport(flow, config, { profile: 'laptop' }), {
    width: 1366,
    height: 768
  });
  assert.deepEqual(resolveViewport(flow, config, { profile: 'laptop-mutation' }), {
    width: 1366,
    height: 768
  });
});

test('normal profiles retain the flow viewport', () => {
  const flow = { viewport: { width: 1440, height: 900 } };
  assert.deepEqual(resolveViewport(flow, config, { profile: 'full' }), {
    width: 1440,
    height: 900
  });
});

test('laptop audit records viewport checks when the page fits', async () => {
  const page = fakePage({ documentWidth: 1366, overlays: [] });
  const checks = await auditViewport(page, config, { profile: 'laptop' });
  assert.deepEqual(checks.map((check) => check.type), [
    'assertViewport',
    'assertNoHorizontalOverflow',
    'assertOverlaysWithinViewport'
  ]);
});

test('laptop audit fails on horizontal page overflow', async () => {
  const page = fakePage({ documentWidth: 1380, overlays: [] });
  await assert.rejects(
    auditViewport(page, config, { profile: 'laptop' }),
    /14px of horizontal page overflow/
  );
});

test('laptop audit fails when a visible dialog extends below the viewport', async () => {
  const page = fakePage({
    documentWidth: 1366,
    overlays: [{ x: 900, y: 40, width: 450, height: 750 }]
  });
  await assert.rejects(
    auditViewport(page, config, { profile: 'laptop' }),
    /Visible overlay extends outside/
  );
});

function fakePage({ documentWidth, overlays }) {
  const candidates = overlays.map((box, index) => ({
    isVisible: async () => true,
    elementHandle: async () => ({
      evaluate: async () => `overlay-${index}`
    }),
    boundingBox: async () => box,
    evaluate: async () => ({
      tag: 'section',
      guide: null,
      role: 'dialog',
      text: `Dialog ${index + 1}`
    })
  }));

  return {
    viewportSize: () => ({ width: 1366, height: 768 }),
    evaluate: async () => ({
      innerWidth: 1366,
      innerHeight: 768,
      documentWidth,
      documentHeight: 1200
    }),
    locator: () => ({
      count: async () => candidates.length,
      nth: (index) => candidates[index]
    })
  };
}

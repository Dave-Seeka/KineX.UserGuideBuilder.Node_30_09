import test from 'node:test';
import assert from 'node:assert/strict';
import { assessFixtureMapHit } from '../src/lib/fixture-e2e.mjs';

const base = {
  x: 300, y: 300, viewportWidth: 1440, viewportHeight: 900,
  surfaceRect: { left: 100, top: 100, right: 1100, bottom: 780 },
  hitTag: 'CANVAS', hitClass: '', insideSurface: true, blockedUi: false
};

test('viewport-aware map hit accepts a real MapView pixel', () => {
  assert.deepEqual(assessFixtureMapHit(base), { valid: true });
});

test('a null elementFromPoint outside the viewport is not a toolbar blockage', () => {
  const result = assessFixtureMapHit({ ...base, x: -500, hitTag: 'none' });
  assert.equal(result.valid, false);
  assert.match(result.reason, /outside browser viewport 1440x900/);
  assert.doesNotMatch(result.reason, /obscured|blocked by/);
});

test('a projected point off the active canvas is not treated as a UI overlay', () => {
  const result = assessFixtureMapHit({ ...base, x: 105, hitTag: 'DIV' });
  assert.match(result.reason, /outside active MapView canvas/);
});

test('a toolbar covering an otherwise valid map pixel is identified', () => {
  const result = assessFixtureMapHit({ ...base, hitTag: 'BUTTON', hitClass: 'esri-ui', blockedUi: true });
  assert.match(result.reason, /obscured by BUTTON \(esri-ui\)/);
});

test('a null hit inside the map has a distinct diagnostic', () => {
  const result = assessFixtureMapHit({ ...base, hitTag: 'none' });
  assert.match(result.reason, /no DOM element at screen point/);
});

test('zero-size MapView is rejected before Playwright clicks', () => {
  const result = assessFixtureMapHit({ ...base, surfaceRect: { left:0, top:0, right:0, bottom:0 } });
  assert.match(result.reason, /no displayed bounds/);
});

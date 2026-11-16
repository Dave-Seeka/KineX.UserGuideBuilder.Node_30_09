import { createHash } from 'node:crypto';

// KineX's continuous batch exposes the ordinal in the GeometryTaskPanel body.
// Its toolbar Done state is not an indicator that the next capture is ready.
export function matchesFixtureBatchTask(panelText, blockNumber, batchSize) {
  if (!Number.isInteger(blockNumber) || blockNumber < 1
    || !Number.isInteger(batchSize) || batchSize < blockNumber) return false;
  const text = String(panelText ?? '').replace(/\s+/g, ' ');
  const expression = new RegExp(`(?:^|[^A-Za-z0-9])Block\\s+${blockNumber}\\s+of\\s+${batchSize}(?![0-9])`, 'i');
  return expression.test(text);
}

// Allow a valid successor only when the prior geometry task has actually exited.
// In particular, the same still-visible task is never evidence of completion.
export function detectGeometryTransition({ after, taskVisible, choiceVisible,
  currentText = '', currentLabel = '', previousText = '', previousLabel = '',
  nextDoneDisabled = false, expectedNextEntity = null,
  expectedNextBlockNumber = null, batchSize = null, successorSessionReady = false }) {
  if (after === 'complete') return taskVisible || choiceVisible ? 'pending' : 'complete';
  if (!taskVisible && choiceVisible) return after === 'next-geometry' ? 'pending' : 'ready';
  if (after === 'choice') return 'pending';
  if (!taskVisible) return 'pending';
  const identityChanged = Boolean((currentLabel && previousLabel && currentLabel !== previousLabel)
    || (currentText && previousText && currentText !== previousText));
  if (!identityChanged) return 'pending';
  if (after === 'next-geometry' && expectedNextBlockNumber !== null) {
    // Match KineX's actual batch step and a fresh, active capture. The toolbar
    // button can be enabled/absent even though the successor task is correct.
    return matchesFixtureBatchTask(currentText, expectedNextBlockNumber, batchSize)
      && successorSessionReady ? 'ready' : 'pending';
  }
  if (!nextDoneDisabled) return 'pending';
  if (expectedNextEntity) {
    const expected = String(expectedNextEntity).toLowerCase();
    const description = `${currentLabel} ${currentText}`.toLowerCase();
    if (!description.includes(expected)) return 'pending';
  }
  return 'ready';
}

export function fixtureRunOffset(runId) {
  const digest = createHash('sha256').update(String(runId)).digest();
  // Seven-by-seven 1.3km cells centred on a known test region, rather than
  // sending runs up to 15km northeast of their source geometry. The same
  // displacement applies to Property, Orchard and every Block.
  return { x: ((digest.readUInt16BE(0) % 7) - 3) * 1300,
    y: ((digest.readUInt16BE(2) % 7) - 3) * 1300 };
}

export function fixturePlacementOffset(fixture, runId) {
  const e2e = fixture?.e2e;
  if (e2e?.placementMode === 'fixed') {
    // CSV-sourced geometry is used at its original NZTM coordinates. A new
    // runId must never shift a potentially real Property to another location.
    if (Number(e2e.spatialReferenceWkid) !== 2193) {
      throw new Error('Fixed fixture requires NZTM2000 (EPSG:2193).');
    }
    return { x: 0, y: 0 };
  }
  if (e2e?.placementMode && e2e.placementMode !== 'translated') {
    throw new Error(`Unsupported fixture placement mode '${e2e.placementMode}'.`);
  }
  const target = e2e?.targetPlacement;
  const property = e2e?.property?.geometry;
  if (!target || Number(e2e.spatialReferenceWkid) !== 2193
    || Number(target.wkid) !== 2193 || !Array.isArray(property) || property.length < 4) {
    throw new Error('Block hectare fixture requires an NZTM2000 targetPlacement and Property ring.');
  }
  const xs = property.map((p) => Number(p[0]));
  const ys = property.map((p) => Number(p[1]));
  if ([...xs, ...ys, target.x, target.y].some((v) => !Number.isFinite(Number(v)))) {
    throw new Error('Block hectare fixture contains non-finite source or target coordinates.');
  }
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  const run = fixtureRunOffset(runId);
  return { x: target.x - centerX + run.x, y: target.y - centerY + run.y };
}

export function placedFixtureRing(fixture, geometryPath, runId) {
  const pieces = String(geometryPath).split('.');
  let ring = fixture;
  for (const part of pieces) ring = ring?.[part];
  if (!Array.isArray(ring) || ring.length < 4) {
    throw new Error(`Fixture ${geometryPath} needs a closed polygon ring.`);
  }
  const offset = fixturePlacementOffset(fixture, runId);
  const placed = ring.map((p) => [Number(p[0]) + offset.x, Number(p[1]) + offset.y]);
  const bounds = fixture.e2e.targetPlacement.bounds;
  if (!bounds || placed.some(([x, y]) => !Number.isFinite(x) || !Number.isFinite(y)
    || x < bounds.xmin || x > bounds.xmax || y < bounds.ymin || y > bounds.ymax)) {
    throw new Error(`Fixture ${geometryPath} is outside the permitted fixture extent `
      + `(NZTM2000). Refusing to navigate the MapView.`);
  }
  return placed;
}

// Classify screen coordinates before Playwright sends a real map click.
// A null elementFromPoint outside the viewport is not a toolbar collision.
export function assessFixtureMapHit({ x, y, viewportWidth, viewportHeight,
  surfaceRect, insideSurface = false, blockedUi = false,
  hitTag = 'none', hitClass = '' }) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { valid: false, reason: 'map projection returned non-finite screen coordinates' };
  }
  const pixel = `(${Math.round(x)}, ${Math.round(y)})`;
  if (!(viewportWidth > 0 && viewportHeight > 0)) {
    return { valid: false, reason: 'browser viewport has zero width or height' };
  }
  if (x < 0 || y < 0 || x >= viewportWidth || y >= viewportHeight) {
    return { valid: false, reason: `screen point ${pixel} is outside browser viewport ${viewportWidth}x${viewportHeight}` };
  }
  if (!surfaceRect || !(surfaceRect.right > surfaceRect.left && surfaceRect.bottom > surfaceRect.top)) {
    return { valid: false, reason: 'active MapView canvas has no displayed bounds' };
  }
  if (x < surfaceRect.left + 8 || y < surfaceRect.top + 8
    || x > surfaceRect.right - 8 || y > surfaceRect.bottom - 8) {
    const bounds = [surfaceRect.left, surfaceRect.top, surfaceRect.right, surfaceRect.bottom]
      .map(Math.round).join(',');
    return { valid: false, reason: `screen point ${pixel} is outside active MapView canvas [${bounds}]` };
  }
  if (hitTag === 'none') {
    return { valid: false, reason: `no DOM element at screen point ${pixel} inside the active MapView` };
  }
  if (!insideSurface || blockedUi) {
    return { valid: false, reason: `screen point ${pixel} is obscured by ${hitTag} (${String(hitClass).slice(0, 100)})` };
  }
  return { valid: true };
}

// Build an explicit Esri polygon for the existing KineX completion contract.
// The fixture is Esri/NZTM JSON coordinates, not a binary .shp file.
export function fixtureEsriPolygon(fixture, geometryPath, runId) {
  const wkid = Number(fixture?.e2e?.spatialReferenceWkid);
  if (wkid !== 2193) throw new Error('Fixture JSON injection requires NZTM2000 (EPSG:2193).');
  const ring = placedFixtureRing(fixture, geometryPath, runId);
  const unique = new Set(ring.map(([x, y]) => `${x}:${y}`));
  if (unique.size < 3) throw new Error(`Geometry '${geometryPath}' needs three distinct vertices.`);
  const closed = ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]
    ? ring : [...ring, [...ring[0]]];
  const twiceArea = closed.slice(1).reduce((total, point, index) => {
    const previous = closed[index];
    return total + previous[0] * point[1] - point[0] * previous[1];
  }, 0);
  if (!Number.isFinite(twiceArea) || Math.abs(twiceArea) < 2) {
    throw new Error(`Geometry '${geometryPath}' has zero or negligible area.`);
  }
  return { rings: [closed], spatialReference: { wkid } };
}

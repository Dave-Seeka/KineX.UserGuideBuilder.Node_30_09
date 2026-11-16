import fs from 'node:fs/promises';
import path from 'node:path';

const LINKED_CLASS = 'workbench-business-form__spatial--linked';

export function linkedSpatialStatus({ classes = '', label = '', headerLinked = false }) {
  return Boolean(headerLinked) || (String(classes).split(/\s+/).includes(LINKED_CLASS)
    && /linked to an arcgis feature/i.test(String(label)));
}

// Interpret only the persisted spatial status exposed by KineX's UI or the
// server-driven transition to a successor after the preceding publish completes.
// A toast, a closed panel, or an arbitrary business form is never sufficient.
export function classifyFixturePublication(status) {
  const { entity, nextEntity, taskLabel = '', choiceLabel = '',
    parentPrerequisite = '', parentReady = false, parentBlocked = false,
    formEntity = '', spatialClasses = '', spatialLabel = '', headerLinked = false, error = '' } = status;
  if (error) return { ok: false, fatal: true, reason: error };
  if (entity === 'property') {
    if (!nextEntity) return { ok: false, fatal: true, reason: 'Property successor entity not specified' };
    if (parentPrerequisite && /required first/i.test(parentPrerequisite)) {
      return { ok: false, fatal: false, reason: 'Parent boundary prerequisite is still present' };
    }
    if (parentBlocked) return { ok: false, fatal: false, reason: 'Successor parent boundary is marked unlinked' };
    const successorTask = new RegExp(`\\b${nextEntity}\\b`, 'i').test(taskLabel);
    const successorChoice = new RegExp(`\\b${nextEntity}\\b`, 'i').test(choiceLabel);
    if (successorTask) return { ok: true, evidence: 'server-advanced-to-next-geometry-task' };
    if (successorChoice && parentReady) return { ok: true, evidence: 'successor-choice-parent-linked' };
    return { ok: false, fatal: false,
      reason: `Expected ${nextEntity} geometry task or parent-linked successor choice; task='${taskLabel}', choice='${choiceLabel}'` };
  }
  if (formEntity?.toLowerCase() !== entity) {
    return { ok: false, fatal: false, reason: `Expected ${entity} form; current '${formEntity || 'none'}'` };
  }
  if (linkedSpatialStatus({ classes: spatialClasses, label: spatialLabel, headerLinked })) {
    return { ok: true, evidence: 'selected-entity-spatial-status-linked' };
  }
  return { ok: false, fatal: false,
    reason: `${entity} is not confirmed linked: '${spatialLabel || spatialClasses || 'status not visible'}'` };
}

// Local-only failure artifacts; no cookies, URL query strings, localStorage,
// authentication headers, raw network traffic or portal tokens are captured.
export async function saveFixtureFailureDiagnostics(page, outputDir, runtime, currentStep, failure) {
  const dir = path.join(outputDir, 'fixture-runs');
  await fs.mkdir(dir, { recursive: true });
  const prefix = path.join(dir, `${runtime.runId}-failure`);
  const snapshot = await collectFixtureDiagnosticSnapshot(page).catch(error => ({ captureError: String(error) }));
  const report = {
    runId: runtime.runId, capturedAt: new Date().toISOString(),
    currentStep, currentAction: runtime.currentAction ?? null,
    checkpoints: runtime.geometryCheckpoints ?? [], failure, snapshot
  };
  const reportPath = `${prefix}.json`;
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  let screenshot = null;
  if (!page.isClosed?.()) {
    const screenshotPath = `${prefix}.png`;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: false, timeout: 8000 });
      screenshot = screenshotPath;
    } catch (error) {
      report.screenshotError = String(error);
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    }
  }
  return { report: reportPath, screenshot };
}

export async function collectFixtureDiagnosticSnapshot(page) {
  if (page.isClosed?.()) return { pageClosed: true };
  return await page.evaluate(async () => {
    const excerpt = (selector, max = 350) => [...document.querySelectorAll(selector)]
      .filter(el => el.getClientRects().length > 0)
      .map(el => (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, max)).filter(Boolean).slice(0, 5);
    const task = document.querySelector("[data-guide='geometry-task-panel']");
    const spatial = document.querySelector("[data-guide='business-form-shell'] [data-guide='business-spatial-status']");
    const choice = document.querySelector("[data-guide='geometry-choice']");
    const result = {
      mapReady: Boolean(document.querySelector("[data-guide='workbench-map'] .esri-view")),
      geometryTask: task ? { label: task.getAttribute('aria-label'), stage: task.getAttribute('data-guide-stage') } : null,
      geometryChoice: choice?.querySelector('h2')?.textContent?.trim() ?? null,
      parentPrerequisite: excerpt("[data-guide='geometry-parent-prerequisite']"),
      parentState: excerpt("[data-guide='geometry-parent-state']"),
      selectedFormEntity: document.querySelector("[data-guide='business-form-shell']")?.getAttribute('data-guide-entity') ?? null,
      spatialState: { label: spatial?.getAttribute('aria-label') ?? null,
        linked: Boolean(spatial?.classList.contains('workbench-business-form__spatial--linked')),
        headerLinked: Boolean(document.querySelector('.workbench-business-form__entity-dot--linked')) },
      geometryDoneDisabled: document.querySelector("[data-guide='geometry-done'] button")?.disabled ?? null,
      mapErrors: excerpt("[data-guide='map-error'], [data-guide='geometry-error'], [data-guide='create-error']"),
      notifications: excerpt("[role='alert'], [data-guide='toast']"),
      map: null, capture: null
    };
    try {
      const state = await import('/js/arcgis-map-state.js');
      const root = document.querySelector("[data-guide='workbench-map']");
      const pair = [...state.activeMapViews.entries()].find(([, candidate]) => root?.contains(candidate?.view?.container));
      const mapViewId = pair?.[0];
      const view = pair?.[1]?.view;
      if (view) {
        result.map = { wkid: view.spatialReference?.wkid, stationary: Boolean(view.stationary),
          scale: view.scale, zoom: view.zoom, updating: Boolean(view.updating),
          extent: view.extent ? { xmin: view.extent.xmin, ymin: view.extent.ymin,
            xmax: view.extent.xmax, ymax: view.extent.ymax } : null };
        const edit = [...state.activeGeometryEdits.values()].find(candidate => candidate?.mapViewId === mapViewId && candidate?.terminalIntent === null);
        if (edit) result.capture = { mode: edit.mode, vertexCount: edit.captureVertexCount ?? 0,
          terminalIntent: edit.terminalIntent ?? null };
      }
    } catch (error) {
      result.mapInspectionError = String(error?.message ?? error).slice(0, 200);
    }
    return result;
  });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOrchardPin } from '../src/lib/actions.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function loadFlow(file) {
  return JSON.parse(await fs.readFile(path.join(root, 'flows', file), 'utf8'));
}


test('Orchard create flows generate crop-length alphanumeric PINs', async () => {
  assert.equal(buildOrchardPin('UG-O-', '20261006085712', 'KIWIFRUIT'), 'UG12');
  assert.equal(buildOrchardPin('UG-O-', '20261006085712', 'AVOCADO'), 'UG12');
  assert.equal(buildOrchardPin('UG-O-', '20261006085712', 'APPLE'), 'UG712');
  assert.match(buildOrchardPin('GUIDE-ORCHARD', '20261006085712', 'KIWIFRUIT'), /^[A-Z0-9]{4}$/);
  assert.equal(buildOrchardPin('B', '202610060857120', '4b2e-crop-id-only', 4).length, 4);

  for (const file of [
    '090-create-orchard-existing-property.json',
    '100-create-orchard-new-property-manual-address.json',
    'latest-create/030-orchard-dual-temporal-policy.json',
    '300-mutation-create-orchard.json'
  ]) {
    const flow = await loadFlow(file);
    const actions = flow.steps.flatMap((step) => step.actions ?? []);
    const cropIndex = actions.findIndex((action) =>
      action.locator?.selector === "[data-guide='orchard-crop']"
      && ['selectFirstOption', 'selectFirstOptionIfEmpty'].includes(action.type));
    const pinIndex = actions.findIndex((action) => action.type === 'fillValidOrchardPin');

    assert.ok(cropIndex >= 0, `${file}: crop selection`);
    assert.ok(pinIndex > cropIndex, `${file}: PIN generated after crop selection`);
    assert.equal(actions[pinIndex].cropLocator?.selector, "[data-guide='orchard-crop']");
  }
});

test('Block-hectares E2E fixture pins Kiwifruit PIN length explicitly', async () => {
  const flow = await loadFlow('295-block-hectares-e2e-fixture.json');
  const action = flow.steps.flatMap((step) => step.actions ?? [])
    .find((candidate) => candidate.type === 'continueOrchardDetailsWithUniquePin');
  assert.equal(action?.pinLength, 4);
});


test('create-flow review checks use entity-specific hooks', async () => {
  const cases = [
    ['090-create-orchard-existing-property.json', "[data-guide='orchard-review-step']"],
    ['100-create-orchard-new-property-manual-address.json', "[data-guide='orchard-review-step']"],
    ['120-create-block.json', "[data-guide='block-review-step']"]
  ];

  for (const [file, expected] of cases) {
    const flow = await loadFlow(file);
    const reviewStep = flow.steps.at(-1);
    assert.equal(reviewStep.checks?.[0]?.locator?.selector, expected, file);
  }
});

test('create Orchard flows require the action before clicking it', async () => {
  for (const file of [
    '090-create-orchard-existing-property.json',
    '100-create-orchard-new-property-manual-address.json',
    '110-create-orchard-new-property-verified-address.json'
  ]) {
    const flow = await loadFlow(file);
    const actions = flow.steps[0].actions;
    const requireIndex = actions.findIndex((action) =>
      action.type === 'require'
      && action.locator?.selector === "[data-guide='create-orchard']:not(:disabled)");
    const clickIndex = actions.findIndex((action) =>
      action.type === 'click' && action.locator?.selector === "[data-guide='create-orchard']");
    assert.ok(requireIndex >= 0 && requireIndex < clickIndex, file);
  }
});


test('full coverage suite separates safe and guarded mutation profiles', async () => {
  const entries = (await fs.readdir(path.join(root, 'flows')))
    .filter((name) => /^\d{3}-.+\.json$/i.test(name))
    .sort();
  const flows = await Promise.all(entries.map(loadFlow));
  const safe = flows.filter((flow) => flow.profiles?.includes('full') && flow.mutation !== true);
  const mutations = flows.filter((flow) => flow.profiles?.includes('mutation') && flow.mutation === true);

  assert.equal(flows.length, 74);
  assert.equal(safe.length, 62);
  assert.equal(mutations.length, 9);
  assert.deepEqual(mutations.map((flow) => flow.id), [
    'mutation-create-orchard',
    'mutation-edit-orchard',
    'mutation-create-block',
    'mutation-edit-block',
    'mutation-edit-property',
    'mutation-split-pick',
    'mutation-select-pick',
    'mutation-delete-block',
    'mutation-delete-orchard'
  ]);
});


test('Block-hectares E2E fixture is isolated from the normal mutation profile', async () => {
  const flow = await loadFlow('295-block-hectares-e2e-fixture.json');
  assert.equal(flow.mutation, true);
  assert.deepEqual(flow.profiles, ['block-hectares-e2e']);
  const drawActions = flow.steps.flatMap((step) => step.actions ?? [])
    .filter((action) => action.type === 'injectFixturePolygon');
  assert.equal(drawActions.length, 6);
  assert.deepEqual(drawActions.map((action) => action.geometryPath), [
    'e2e.property.geometry',
    'e2e.orchard.geometry',
    'e2e.blocks.0.geometry',
    'e2e.blocks.1.geometry',
    'e2e.blocks.2.geometry',
    'e2e.blocks.3.geometry'
  ]);
  const actions = flow.steps.flatMap((step) => step.actions ?? []);
  assert.equal(actions.some((action) => action.type === 'continueOrchardDetailsWithUniquePin'), true);
  assert.equal(actions.some((action) => action.locator?.selector === "[data-guide='orchard-grower-supply-step']"), true);
  assert.equal(drawActions[0].after, 'choice-or-task');
  const orchardDraw = flow.steps
    .find((step) => step.heading === 'Publish the Property and Orchard boundaries')
    ?.actions.find((action) => action.locator?.selector === "[data-guide='geometry-draw']" && action.type === 'clickIfVisible');
  assert.ok(orchardDraw, 'Orchard geometry should tolerate KineX auto-advancing directly into drawing');
});


test('Property navigator flows use direct Property selection and stable recovery selectors', async () => {
  const navigator = await loadFlow('026-property-navigator.json');
  const search = await loadFlow('027-property-search.json');
  const filters = await loadFlow('028-property-boundary-filters.json');
  const details = await loadFlow('084-view-property-details.json');

  assert.equal(navigator.steps[0].actions.some((action) =>
    action.type === 'click' && action.locator?.role === 'tab' && action.locator?.name === 'Properties'), true);
  assert.equal(navigator.steps[1].actions.some((action) =>
    action.locator?.selector === ".workbench-property-row button[aria-label^='Select Property ']"), true);
  assert.equal(search.steps[1].actions.some((action) =>
    action.type === 'waitFor' && action.locator?.text === 'No Properties match this code, address, or location.'), true);
  assert.deepEqual(filters.steps.slice(0, 2).map((step) =>
    step.checks?.[0]?.matches), ['^Map:', '^No Map:']);
  assert.equal(details.steps[0].actions.some((action) =>
    action.type === 'clickFirst' && action.locator?.selector?.includes('Select Property')), true);
  assert.equal(navigator.steps[1].checks.some((check) =>
    check.locator?.selector === '.workbench-property-row--selected button'), true);
  assert.equal(details.steps[0].checks.some((check) =>
    check.locator?.selector === '.workbench-property-row--selected button'), true);
});


test('navigator flows use current tab titles and map-status popovers', async () => {
  const orchard = await loadFlow('030-orchard-navigator.json');
  const maturityAreas = await loadFlow('036-maturity-area-navigator.json');
  const orchardSerialized = JSON.stringify(orchard);
  const maSerialized = JSON.stringify(maturityAreas);

  assert.match(orchardSerialized, /orchard-link-filter-trigger/);
  assert.match(orchardSerialized, /orchard-filter-unlinked/);
  assert.match(orchardSerialized, /button\[role='tab'\]\[title='Orchards'\]/);
  assert.match(maSerialized, /button\[role='tab'\]\[title='Maturity Areas'\]/);
  assert.equal(maSerialized.includes('\"role\":\"tab\",\"name\":\"Maturity Areas\"'), false);
});

test('create guides follow the current split create-flow contracts', async () => {
  const existing = await loadFlow('090-create-orchard-existing-property.json');
  const navigation = await loadFlow('094-create-orchard-navigation.json');
  const manual = await loadFlow('100-create-orchard-new-property-manual-address.json');
  const addressModes = await loadFlow('102-manual-address-modes.json');
  const verified = await loadFlow('110-create-orchard-new-property-verified-address.json');

  for (const flow of [existing, navigation]) {
    const serialized = JSON.stringify(flow);
    assert.match(serialized, /property-search/);
    assert.match(serialized, /property-option/);
    assert.equal(flow.steps.flatMap((step) => step.actions ?? []).some((action) =>
      action.type === 'selectFirstOption'
      && action.locator?.selector === "[data-guide='property-selector']"), false);
  }

  for (const flow of [manual, verified]) {
    const serialized = JSON.stringify(flow);
    assert.doesNotMatch(serialized, /property-code/);
    assert.match(serialized, /selectFirstOptionIfEmpty/);
  }

  const addressModeActions = addressModes.steps[0].actions;
  assert.equal(addressModeActions.some((action) =>
    action.type === 'selectOption'
    && action.locator?.selector === "[data-guide='property-source']"
    && action.value === 'new'
    && action.label === 'Create new'), true);
  assert.equal(JSON.stringify(addressModes).includes('"role":"radio"'), false);
});

test('Block create guides wait for stable Orchard parent context', async () => {
  for (const file of [
    '120-create-block.json',
    '122-create-block-validation.json'
  ]) {
    const flow = await loadFlow(file);
    const actions = flow.steps[0].actions;
    const open = actions.find((action) => action.type === 'clickUntilVisible');

    assert.match(open?.locator?.selector ?? '', /data-guide-create-entity='block'/, file);
    assert.match(open?.locator?.selector ?? '', /data-guide-parent-id/, file);
    assert.equal(
      open?.successLocator?.selector,
      "[data-guide='entity-create-drawer'][data-guide-entity='block']",
      file
    );
  }
});

test('toolbar and geometry guides use current accessibility and boundary contracts', async () => {
  const basemap = await loadFlow('072-basemap-change.json');
  const layers = await loadFlow('074-layer-visibility.json');
  const boundary = await loadFlow('160-add-orchard-boundary.json');

  assert.equal(basemap.steps[0].actions.some((action) =>
    action.type === 'assertDisabled'
    && action.locator?.selector === "[data-guide='map-basemap-menu-button']"), true);
  assert.equal(JSON.stringify(basemap).includes('map-basemap-option-terrain'), false);
  assert.equal(layers.steps[0].actions.some((action) =>
    action.type === 'require'
    && action.locator?.selector === "[data-guide='map-layer-option-regions']"
    && /not configured/.test(action.message ?? '')), true);
  assert.equal(JSON.stringify(boundary).includes('geometry-link-unavailable'), false);
});


test('current Workbench flows avoid retired selectors', async () => {
  const entries = (await fs.readdir(path.join(root, 'flows')))
    .filter((name) => /^\d{3}-.+\.json$/i.test(name));
  const flows = await Promise.all(entries.map(loadFlow));
  const serialized = JSON.stringify(flows);
  for (const retired of [
    'context-edit-action',
    'edit-property',
    'select-visible-blocks',
    'multi-block-panel',
    'multi-block-summary-tab',
    'multi-block-blocks-tab',
    'multi-block-set-primary',
    'multi-block-remove',
    'block-season-context',
    'geometry-link-unavailable'
  ]) {
    assert.equal(serialized.includes("data-guide='" + retired + "'"), false, retired);
  }
});

test('Block create follows auto-code and required production/cover stages', async () => {
  const flow = await loadFlow('120-create-block.json');
  const serialized = JSON.stringify(flow);
  assert.equal(serialized.includes("[data-guide='block-code'] input"), false);
  assert.match(serialized, /Auto-generated code/);
  assert.match(serialized, /Production status \*/);
  assert.match(serialized, /Cover status \*/);
  assert.equal(flow.steps.at(-1).checks?.[0]?.locator?.selector, "[data-guide='block-review-step']");
});

test('multi-Block guides use the canonical Business Form views', async () => {
  for (const file of ['050-multi-block-selection.json', '052-multi-block-actions.json']) {
    const flow = await loadFlow(file);
    const serialized = JSON.stringify(flow);
    assert.match(serialized, /business-form-shell/);
    assert.match(serialized, /data-guide-entity='blocks'/);
    assert.match(serialized, /multi-block-allocation-list/);
    assert.doesNotMatch(serialized, /multi-block-panel/);
  }
});

test('Maturity Area safe flows stop before persistence and cover both Pick strategies', async () => {
  const create = await loadFlow('124-create-maturity-area.json');
  const splitPick = await loadFlow('174-split-pick.json');
  const selectPick = await loadFlow('176-pick-strategy-drawer.json');
  const reversal = await loadFlow('178-select-pick-history-reversal.json');

  assert.equal(create.steps.flatMap((step) => step.actions ?? []).some((action) =>
    action.type === 'click' && action.locator?.selector === "[data-guide='create-submit-action'] button"), false);
  assert.match(JSON.stringify(create), /ma-review-step/);

  assert.deepEqual(splitPick.profiles, ['core', 'full']);
  assert.match(JSON.stringify(splitPick), /data-guide-strategy='split'/);
  assert.match(JSON.stringify(splitPick), /split-pick-total/);
  assert.match(JSON.stringify(splitPick), /map--missing/);
  assert.match(JSON.stringify(splitPick), /multi-block-table-secondary-action/);
  assert.doesNotMatch(JSON.stringify(splitPick), /multi-block-table-secondary-action-menu/);
  const splitCandidate = splitPick.steps.flatMap((step) => step.actions ?? []).find((action) =>
    action.type === 'clickCandidateUntil');
  assert.equal(splitCandidate?.successLocator?.selector,
    "tr:has(.workbench-multi-block-table__map--missing) [data-guide='multi-block-table-secondary-action'][aria-label^='Split Pick ']:not(:disabled)");
  assert.equal(splitCandidate?.afterClickActions?.some((action) =>
    action.type === 'click' && action.locator?.role === 'tab' && action.locator?.name === 'Allocation'), true);

  assert.deepEqual(selectPick.profiles, ['core', 'full']);
  assert.match(JSON.stringify(selectPick), /data-guide-strategy='select'/);
  assert.match(JSON.stringify(selectPick), /select-pick-total/);
  assert.match(JSON.stringify(selectPick), /multi-block-table-additional-action/);
  assert.match(JSON.stringify(selectPick), /pick-strategy-selector/);
  assert.equal(JSON.stringify(selectPick).includes('Apply Select Pick'), false);
  const selectCandidate = selectPick.steps.flatMap((step) => step.actions ?? []).find((action) =>
    action.type === 'clickCandidateUntil');
  assert.equal(selectCandidate?.successLocator?.selector,
    "[data-guide='multi-block-table-additional-action'][aria-label^='Select Pick ']:not(:disabled)");
  assert.equal(selectCandidate?.afterClickActions?.some((action) =>
    action.type === 'waitFor' && action.locator?.selector === "[data-guide='ma-blocks-tab']"), true);

  assert.match(JSON.stringify(reversal), /select-pick-reversal-drawer/);
  assert.equal(reversal.steps.flatMap((step) => step.actions ?? []).some((action) =>
    action.type === 'click' && action.locator?.role === 'button' && action.locator?.name === 'Reverse Select Pick'), false);
});

test('guarded Pick mutation flows use current row actions and verify saved state', async () => {
  const splitPick = await loadFlow('326-mutation-split-pick.json');
  const selectPick = await loadFlow('328-mutation-select-pick.json');

  const cases = [
    {
      flow: splitPick,
      strategy: 'split',
      actionSelector: "tr:has(.workbench-multi-block-table__map--missing) [data-guide='multi-block-table-secondary-action'][aria-label^='Split Pick ']:not(:disabled)",
      applyLabel: 'Apply Split Pick',
      successText: 'Split Pick strategy applied.'
    },
    {
      flow: selectPick,
      strategy: 'select',
      actionSelector: "[data-guide='multi-block-table-additional-action'][aria-label^='Select Pick ']:not(:disabled)",
      applyLabel: 'Apply Select Pick',
      successText: 'Select Pick strategy applied.'
    }
  ];

  for (const { flow, strategy, actionSelector, applyLabel, successText } of cases) {
    assert.equal(flow.mutation, true);
    assert.deepEqual(flow.profiles, ['mutation']);

    const actions = flow.steps.flatMap((step) => step.actions ?? []);
    const candidate = actions.find((action) => action.type === 'clickCandidateUntil');
    assert.equal(candidate?.successLocator?.selector, actionSelector, flow.id);
    assert.equal(candidate?.afterClickActions?.some((action) =>
      action.type === 'click'
      && action.locator?.role === 'tab'
      && action.locator?.name === 'Allocation'), true, flow.id);

    assert.equal(actions.some((action) =>
      action.type === 'click'
      && action.locator?.role === 'button'
      && action.locator?.name === '+ Add allocation'), true, flow.id);
    assert.equal(actions.some((action) =>
      action.type === 'evaluate'
      && action.script?.includes('candidate.value !== first.value')), true, flow.id);
    assert.equal(actions.some((action) =>
      action.type === 'click'
      && action.locator?.role === 'button'
      && action.locator?.name === applyLabel), true, flow.id);
    assert.equal(actions.some((action) =>
      action.type === 'waitFor'
      && action.locator?.text === successText
      && action.locator?.exact === true), true, flow.id);
    assert.equal(actions.some((action) =>
      action.type === 'waitFor'
      && action.locator?.selector === `[data-guide='ma-block-pick-strategy-indicator'][data-strategy='${strategy}']`), true, flow.id);

    const saved = flow.steps.at(-1);
    assert.equal(saved.checks?.some((check) =>
      check.type === 'assertHidden'
      && check.locator?.selector === "[data-guide='ma-allocation-drawer']"), true, flow.id);
    assert.equal(saved.checks?.some((check) =>
      check.type === 'assertAttribute'
      && check.locator?.selector === "[data-guide='business-form-shell'][data-guide-entity='maturity area']"
      && check.name === 'data-guide-tab'
      && check.exact === 'allocation'), true, flow.id);
    assert.equal(saved.checks?.some((check) =>
      check.type === 'assertText'
      && check.locator?.text === successText
      && check.locator?.exact === true
      && check.exactText === successText), true, flow.id);
    assert.equal(saved.checks?.some((check) =>
      check.type === 'assertCount'
      && check.locator?.selector === `[data-guide='ma-block-pick-strategy-indicator'][data-strategy='${strategy}']`
      && check.min === 1), true, flow.id);
  }

  const selectActions = selectPick.steps.flatMap((step) => step.actions ?? []);
  assert.equal(selectActions.some((action) => action.type === 'fill' && action.value === 'B'), true);
  assert.equal(selectActions.some((action) => action.type === 'fill' && action.value === '3C'), true);
});

test('full Workbench guide flows cover current MA and Orchard interaction contracts', async () => {
  const createMa = await loadFlow('124-create-maturity-area.json');
  const orchardViews = await loadFlow('085-orchard-inspector-tabs.json');
  const indicators = await loadFlow('076-pick-strategy-map-indicators.json');

  const createActions = createMa.steps.flatMap((step) => step.actions ?? []);
  const eligibilitySummaryIndex = createActions.findIndex((action) =>
    action.type === 'clickFirst'
    && action.locator?.selector === "[data-guide='maturity-area-eligibility-group'] > summary");
  const blockRequireIndex = createActions.findIndex((action) =>
    action.type === 'require'
    && action.locator?.selector?.includes("maturity-area-block-list"));
  assert.ok(eligibilitySummaryIndex >= 0);
  assert.ok(blockRequireIndex > eligibilitySummaryIndex);

  const orchardSerialized = JSON.stringify(orchardViews);
  assert.match(orchardSerialized, /business-form-additional-tab-content/);
  assert.doesNotMatch(orchardSerialized, /business-form-secondary-additional-tab-content/);
  assert.doesNotMatch(orchardSerialized, /business-form-tertiary-additional-tab-content/);
  assert.match(orchardSerialized, /data-guide-tab/);
  assert.match(orchardSerialized, /maturity-areas/);
  assert.match(orchardSerialized, /grower-supplies/);
  assert.match(orchardSerialized, /variety-areas/);
  assert.match(orchardSerialized, /Grower supply/);
  assert.match(orchardSerialized, /Variety Areas/);

  assert.equal(indicators.cleanupActions?.[0]?.locator?.selector, "[data-guide='map-indicator-pick-strategies']");
  assert.equal(indicators.cleanupActions?.[1]?.locator?.selector, "[data-guide='map-layers-menu-button']");
});

test('effective-dated edit guides enter through the Business Form schedule modal', async () => {
  for (const file of [
    '130-edit-orchard.json',
    '140-edit-block.json',
    '144-edit-maturity-area.json',
    '150-edit-property.json'
  ]) {
    const flow = await loadFlow(file);
    const serialized = JSON.stringify(flow);
    assert.match(serialized, /business-edit-action/);
    assert.match(serialized, /schedule-change-modal/);
  }
});


test('safe create flows close drawers rather than leaving modal state for the next guide', async () => {
  for (const file of [
    '090-create-orchard-existing-property.json',
    '100-create-orchard-new-property-manual-address.json',
    '110-create-orchard-new-property-verified-address.json',
    '124-create-maturity-area.json'
  ]) {
    const flow = await loadFlow(file);
    assert.equal(flow.cleanupActions?.some((action) =>
      action.type === 'clickIfVisible'
      && action.locator?.selector === "[data-guide='create-cancel-action'] button"), true, file);
  }
});

test('Maturity Area and geometry entry flows retry navigator tabs through Workbench rerenders', async () => {
  for (const file of [
    '036-maturity-area-navigator.json',
    '089-maturity-area-details.json',
    '144-edit-maturity-area.json',
    '174-split-pick.json',
    '176-pick-strategy-drawer.json'
  ]) {
    const flow = await loadFlow(file);
    assert.equal(flow.steps.flatMap((step) => step.actions ?? []).some((action) =>
      action.type === 'clickUntilVisible'
      && action.locator?.selector === "button[role='tab'][title='Maturity Areas']"
      && action.successLocator?.selector === "[data-guide='maturity-area-navigator']"), true, file);
  }

  for (const file of [
    '160-add-orchard-boundary.json',
    '170-edit-linked-boundary.json'
  ]) {
    const flow = await loadFlow(file);
    assert.equal(flow.steps.flatMap((step) => step.actions ?? []).some((action) =>
      action.type === 'clickUntilVisible'
      && action.locator?.selector === "button[role='tab'][title='Orchards']"
      && action.successLocator?.selector === "[data-guide='orchard-navigator']"), true, file);
  }
});

test('current flow recovery treats optional create stages and GIS controls as data gates', async () => {
  const manual = await loadFlow('100-create-orchard-new-property-manual-address.json');
  const map = await loadFlow('070-map-basemap-layers.json');
  const createMa = await loadFlow('124-create-maturity-area.json');
  const orchard = await loadFlow('030-orchard-navigator.json');

  assert.equal(JSON.stringify(manual).includes('orchard-additional-step'), false);
  assert.equal(manual.steps.at(-1).actions.some((action) =>
    action.type === 'clickIfVisible'
    && action.locator?.selector === "[data-guide='create-continue-action'] button"), true);

  assert.equal(map.steps[0].actions.some((action) =>
    action.type === 'assertDisabled'
    && action.locator?.selector === "[data-guide='map-basemap-menu-button']"), true);
  assert.equal(JSON.stringify(map).includes('map-basemap-option-terrain'), false);

  const growerSupply = createMa.steps.flatMap((step) => step.actions ?? []).find((action) =>
    action.type === 'selectFirstOption'
    && action.locator?.selector === "[data-guide='maturity-area-grower-supply']");
  assert.match(growerSupply?.skipMessage ?? '', /Grower Supply/);
  assert.equal(JSON.stringify(createMa).includes("select option:not([value=''])"), false);

  assert.equal(orchard.steps.slice(1).flatMap((step) => step.capture?.highlights ?? []).some((highlight) =>
    highlight.locator?.selector === "[data-guide='orchard-link-filter-trigger']"), false);
});

test('mutation flows follow current Workbench HTML contracts', async () => {
  const createOrchard = await loadFlow('300-mutation-create-orchard.json');
  const editOrchard = await loadFlow('310-mutation-edit-orchard.json');
  const createBlock = await loadFlow('320-mutation-create-block.json');
  const editBlock = await loadFlow('322-mutation-edit-block.json');
  const editProperty = await loadFlow('324-mutation-edit-property.json');
  const deleteBlock = await loadFlow('330-mutation-delete-block.json');
  const deleteOrchard = await loadFlow('340-mutation-delete-orchard.json');

  const orchardCreate = JSON.stringify(createOrchard);
  assert.match(orchardCreate, /entity-create-drawer/);
  assert.match(orchardCreate, /data-guide-entity='orchard'/);
  assert.match(orchardCreate, /property-search/);
  assert.match(orchardCreate, /property-option/);
  assert.doesNotMatch(orchardCreate, /selectFirstOption.*property-selector/);

  const blockCreate = JSON.stringify(createBlock);
  assert.match(blockCreate, /data-guide-create-entity='block'/);
  assert.match(blockCreate, /data-guide-parent-id/);
  assert.match(blockCreate, /entity-create-drawer/);
  assert.match(blockCreate, /data-guide-entity='block'/);

  const propertyEdit = JSON.stringify(editProperty);
  assert.doesNotMatch(propertyEdit, /\[data-guide='property-code'\] input/);
  assert.match(propertyEdit, /Area hectares/);

  for (const flow of [editOrchard, createBlock, editBlock, deleteBlock, deleteOrchard]) {
    const serialized = JSON.stringify(flow);
    assert.match(serialized, /button\[role='tab'\]\[title='Orchards'\]/, flow.id);
    assert.match(serialized, /orchard-navigator/, flow.id);
  }

  assert.match(JSON.stringify(editOrchard), /orchard-name/);
  assert.match(JSON.stringify(editBlock), /block-name/);
  assert.match(JSON.stringify(deleteBlock), /context-delete-action/);
  assert.match(JSON.stringify(deleteBlock), /delete-dialog/);
  assert.match(JSON.stringify(deleteBlock), /delete-confirm/);
  assert.match(JSON.stringify(deleteOrchard), /context-delete-action/);
});

test('full safe collection contains every full non-mutation flow in order', async () => {
  const entries = (await fs.readdir(path.join(root, 'flows')))
    .filter((name) => /^\d{3}-.+\.json$/i.test(name))
    .sort();
  const flows = await Promise.all(entries.map(loadFlow));
  const expected = flows
    .filter((flow) => flow.mutation !== true && flow.profiles?.includes('full'))
    .sort((left, right) => left.order - right.order)
    .map((flow) => flow.id);
  const collection = JSON.parse(await fs.readFile(path.join(root, 'collections', 'orchard-workbench.json'), 'utf8'));
  assert.deepEqual(collection.guides, expected);
});


test('block-hectares completion awaits the correct form after geometry panel exit', async () => {
  const actionsSource = await fs.readFile(new URL('../src/lib/actions.mjs', import.meta.url), 'utf8');
  assert.match(actionsSource, /awaitFixtureGeometryTransition\(page/);
  assert.match(actionsSource, /restoreFixtureDetails\(page/);
  assert.match(actionsSource, /workbench-focus-toggle/);
  assert.match(actionsSource, /data-guide-entity='\$\{expectedEntity\}'/);
  assert.match(actionsSource, /selectCreatedOrchard/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runActions } from '../src/lib/actions.mjs';

// Reproduce the real Workbench shape: getByLabel() resolves to the SELECT,
// not to a surrounding label containing another SELECT.
function nativeSelectHarness(options) {
  const state = { value: '', chosen: [] };
  const select = {
    first() { return this; },
    nth() { return this; },
    count: async () => 1,
    isVisible: async () => true,
    waitFor: async () => {},
    evaluate: async (fn) => fn({ tagName: 'SELECT' }),
    locator(name) {
      if (name === 'select') return { count: async () => 0 };
      if (name !== 'option') throw new Error('Unexpected query: ' + name);
      return { evaluateAll: async (fn) => fn(options.map((option) => ({
        value: option.value,
        textContent: option.label,
        disabled: !!option.disabled
      }))) };
    },
    async selectOption(value) { state.chosen.push(value); state.value = value; },
    async inputValue() { return state.value; }
  };
  return { page: { getByLabel: () => select }, state };
}

const action = (extra = {}) => ({
  type: 'selectOptionByAliases', locator: { label: 'Production status *' },
  aliases: ['PROD'], timeoutMs: 1000, ...extra
});

const options = [
  { value: '', label: 'Select production status', disabled: true },
  { value: 'np-id', label: 'NP - Non Producing' },
  { value: 'prod-id', label: 'PROD - Producing' },
  { value: 'other-id', label: 'TENT - Tentative' }
];

test('native label locator selects PROD rather than treating select as a popup', async () => {
  const { page, state } = nativeSelectHarness(options);
  await runActions(page, [action()], {}, {});
  assert.deepEqual(state.chosen, ['prod-id']);
});

test('fixture-only fallback chooses enabled reference data when PROD is absent', async () => {
  const { page, state } = nativeSelectHarness(options.filter((o) => o.value !== 'prod-id'));
  const warn = console.warn;
  const warnings = [];
  try {
    console.warn = (s) => warnings.push(s);
    await runActions(page, [action({ fallback: 'firstEnabled' })], {}, {});
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(state.chosen, ['np-id']);
  assert.match(warnings.join(' '), /using 'NP - Non Producing'/);
});

test('other aliases fail closed with available labels when there is no fallback', async () => {
  const { page, state } = nativeSelectHarness(options.filter((o) => o.value !== 'prod-id'));
  await assert.rejects(runActions(page, [action()], {}, {}), /Available enabled options:.*NP - Non Producing/);
  assert.deepEqual(state.chosen, []);
});

test('disabled and placeholder options are never chosen as fallback', async () => {
  const { page, state } = nativeSelectHarness([
    { value: '', label: 'Select production status', disabled: true },
    { value: 'prod', label: 'PROD - Producing', disabled: true },
    { value: 'tent', label: 'TENT - Tentative' }
  ]);
  const warn = console.warn;
  try {
    console.warn = () => {};
    await runActions(page, [action({ fallback: 'firstEnabled' })], {}, {});
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(state.chosen, ['tent']);
});

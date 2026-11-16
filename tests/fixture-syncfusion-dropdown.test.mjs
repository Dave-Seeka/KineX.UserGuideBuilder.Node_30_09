import test from 'node:test';
import assert from 'node:assert/strict';
import { runActions } from '../src/lib/actions.mjs';

// KineX master uses UiDropdownField: #entity-create-type and #entity-create-country
// are read-only Syncfusion inputs. The nearest ancestor span[role=combobox]
// receives pointer events; Playwright cannot click the inner input normally.
function syncfusionHarness({ optionText = 'Company', hasWrapper = true } = {}) {
  const state = { inputClicks: 0, wrapperClicks: 0, opened: false, value: '', selected: null };
  const empty = { count: async () => 0 };
  const wrapper = {
    count: async () => hasWrapper ? 1 : 0,
    nth() { return this; },
    isVisible: async () => true,
    evaluate: async (fn) => fn({
      textContent: state.value,
      getAttribute: (name) => name === 'role' ? 'combobox' : null
    }),
    getAttribute: async () => null,
    scrollIntoViewIfNeeded: async () => {},
    focus: async () => {},
    async click() { state.wrapperClicks++; state.opened = true; },
    async press(key) {
      if (key === 'Enter' && state.opened) {
        state.value = optionText;
        state.selected = optionText;
      }
    }
  };
  const root = {
    first() { return this; },
    nth() { return this; },
    count: async () => 1,
    isVisible: async () => true,
    waitFor: async () => {},
    evaluate: async (fn) => fn({
      tagName: 'INPUT',
      matches: (selector) => selector.includes('input.e-dropdownlist'),
      value: state.value
    }),
    locator(selector) {
      if (selector.startsWith('xpath=ancestor::')) return hasWrapper ? wrapper : empty;
      return empty;
    },
    getByRole: () => empty,
    async click() {
      state.inputClicks++;
      throw new Error('Syncfusion wrapper intercepts pointer events');
    }
  };
  const option = {
    count: async () => state.opened ? 1 : 0,
    nth() { return this; },
    isVisible: async () => state.opened,
    evaluate: async (fn) => fn({
      textContent: optionText,
      hasAttribute: () => false,
      getAttribute: (name) => name === 'data-value' ? optionText : null,
      classList: { contains: () => false }
    }),
    scrollIntoViewIfNeeded: async () => {},
    async click() { state.selected = optionText; state.value = optionText; state.opened = false; }
  };
  const page = {
    locator(selector) {
      if (selector.startsWith('#entity-create-')) return root;
      if (selector.includes('.e-popup-open') || selector.includes('li.e-list-item')) return option;
      return empty;
    },
    waitForTimeout: async () => {}
  };
  return { page, state };
}

test('Entity type uses clickable Syncfusion ancestor, not intercepted readonly input', async () => {
  const { page, state } = syncfusionHarness({ optionText: 'Company' });
  await runActions(page, [{
    type: 'selectOptionByAliases',
    locator: { selector: '#entity-create-type' },
    aliases: ['Company', 'COMPANY'], timeoutMs: 1000
  }], {}, {});
  assert.equal(state.wrapperClicks, 1);
  assert.equal(state.inputClicks, 0);
  assert.equal(state.selected, 'Company');
});

test('Entity Country selection uses same wrapper for a specific option', async () => {
  const { page, state } = syncfusionHarness({ optionText: 'New Zealand' });
  await runActions(page, [{
    type: 'selectOption', locator: { selector: '#entity-create-country' },
    label: 'New Zealand', timeoutMs: 1000
  }], {}, {});
  assert.equal(state.wrapperClicks, 1);
  assert.equal(state.inputClicks, 0);
  assert.equal(state.selected, 'New Zealand');
});

test('first-option keyboard selection targets Syncfusion wrapper', async () => {
  const { page, state } = syncfusionHarness({ optionText: 'Company' });
  await runActions(page, [{
    type: 'selectFirstOption', locator: { selector: '#entity-create-type' }, timeoutMs: 1000
  }], {}, {});
  assert.ok(state.wrapperClicks >= 1);
  assert.equal(state.inputClicks, 0);
  assert.equal(state.selected, 'Company');
});

test('missing wrapper fails explicitly rather than repeatedly clicking readonly input', async () => {
  const { page, state } = syncfusionHarness({ hasWrapper: false });
  await assert.rejects(runActions(page, [{
    type: 'selectOptionByAliases', locator: { selector: '#entity-create-type' },
    aliases: ['Company'], timeoutMs: 1000
  }], {}, {}), /Syncfusion dropdown wrapper was not found/);
  assert.equal(state.inputClicks, 0);
});

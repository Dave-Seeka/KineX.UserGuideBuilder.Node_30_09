import test from 'node:test';
import assert from 'node:assert/strict';
import { runActions } from '../src/lib/actions.mjs';

const countryAction = (locator, aliases = ['NZ', 'New Zealand']) => ({
  type: 'selectOptionByAliases', locator, aliases, timeoutMs: 800
});

function nativeCountry(initialValue) {
  const state = { selected: initialValue, clicks: 0 };
  const options = [
    { value: '', label: 'Select country...', disabled: true },
    { value: 'country-nz-guid', label: 'NZ - New Zealand' },
    { value: 'country-au-guid', label: 'AU - Australia' }
  ];
  const select = {
    first() { return this; }, nth() { return this; }, count: async () => 1,
    isVisible: async () => true, waitFor: async () => {},
    evaluate: async (fn) => fn({tagName: 'SELECT'}),
    locator(selector) {
      if (selector === 'select') return {count: async () => 0};
      if (selector === 'option') return {evaluateAll: async (fn) => fn(options.map(o => ({
        value: o.value, textContent: o.label, disabled: !!o.disabled
      })))};
      throw Error('Unexpected native select lookup ' + selector);
    },
    inputValue: async () => state.selected,
    async selectOption(value) { state.clicks++; state.selected = value; }
  };
  return {page: {getByLabel: () => select}, state};
}

function syncfusionCountry({ initialValue = '', optionText = 'New Zealand', retain = true, visible = true } = {}) {
  const state = {value: initialValue, clicks: 0, inputClicks: 0, opened: false, waits: 0};
  const empty = {count: async () => 0};
  const wrapper = {
    count: async () => 1, nth() { return this; }, isVisible: async () => true,
    evaluate: async (fn) => fn({ getAttribute: k => k === 'role' ? 'combobox' : null }),
    getAttribute: async (key) => key === 'aria-controls' ? 'current-country-popup' : null,
    async click() {state.clicks++; state.opened = true;}
  };
  const input = {
    first() {return this;}, nth() {return this;}, count: async () => 1,
    isVisible: async () => true, waitFor: async () => {},
    evaluate: async (fn) => fn({
      tagName: 'INPUT', value: state.value,
      matches: q => q.includes('input.e-dropdownlist')
    }),
    locator: q => q.startsWith('xpath=ancestor::') ? wrapper : empty,
    getByRole: () => empty,
    async click() {state.inputClicks++; throw Error('Input is covered by wrapper');}
  };
  const option = {
    count: async () => state.opened && visible ? 1 : 0,
    nth() {return this;},
    evaluate: async (fn) => fn({
      textContent: optionText,
      getAttribute: key => key === 'data-value' ? optionText : null,
      classList: {contains: () => false}
    }),
    async click() {if (retain) state.value = optionText; state.opened = false;}
  };
  const page = {
    locator: (s) => {
      if (s === '#entity-create-country') return input;
      if (s.includes('current-country-popup') || s.includes('.e-popup-open') || s.includes('li.e-list-item')) return option;
      return empty;
    },
    waitForTimeout: async () => {state.waits++;}
  };
  return {page,state};
}

test('already selected native NZ country is not reselected', async () => {
  const {page,state} = nativeCountry('country-nz-guid');
  await runActions(page, [countryAction({label: 'Country *'})], {}, {});
  assert.equal(state.clicks, 0);
  assert.equal(state.selected, 'country-nz-guid');
});

test('native country changes and verifies exact selected ID', async () => {
  const {page,state} = nativeCountry('country-au-guid');
  await runActions(page, [countryAction({label: 'Country *'})], {}, {});
  assert.equal(state.clicks, 1);
  assert.equal(state.selected, 'country-nz-guid');
});

test('existing Syncfusion country skips opening its wrapper', async () => {
  const {page,state} = syncfusionCountry({initialValue: 'New Zealand'});
  await runActions(page, [countryAction({selector: '#entity-create-country'})], {}, {});
  assert.equal(state.clicks, 0);
  assert.equal(state.inputClicks, 0);
});

test('Syncfusion country opens wrapper and retains selected value', async () => {
  const {page,state} = syncfusionCountry();
  await runActions(page, [countryAction({selector: '#entity-create-country'})], {}, {});
  assert.equal(state.clicks, 1);
  assert.equal(state.inputClicks, 0);
  assert.equal(state.value, 'New Zealand');
});

test('Syncfusion click that fails to update displayed value fails with diagnostics', async () => {
  const {page,state} = syncfusionCountry({initialValue: 'Australia',retain: false});
  await assert.rejects(
    runActions(page, [countryAction({selector: '#entity-create-country'})], {}, {}),
    /clicked but not retained.*Displayed value: "Australia"/
  );
  assert.equal(state.clicks, 1);
  assert.equal(state.inputClicks, 0);
});

test('unavailable option fails quickly with visible option details', async () => {
  const {page,state} = syncfusionCountry({initialValue: 'Australia',optionText: 'Canada'});
  await assert.rejects(
    runActions(page, [countryAction({selector: '#entity-create-country'})], {}, {}),
    /unavailable.*Selected: "Australia".*Visible options: \["Canada"\]/
  );
  assert.equal(state.clicks, 1);
  assert.ok(state.waits > 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { runAssertion } from '../src/lib/assertions.mjs';

class FakeLocator {
  constructor(items) {
    this.items = items;
  }
  async count() { return this.items.length; }
  nth(index) { return new FakeLocator([this.items[index]]); }
  async isVisible() { return Boolean(this.items[0]?.visible ?? true); }
  async isEnabled() { return Boolean(this.items[0]?.enabled ?? true); }
  async waitFor({ state }) {
    if (state === 'visible' && !(await this.isVisible())) throw new Error('not visible');
    if (state === 'hidden' && await this.isVisible()) throw new Error('still visible');
  }
  async innerText() { return this.items[0]?.text ?? ''; }
  async inputValue() { return this.items[0]?.value ?? ''; }
  async getAttribute(name) { return this.items[0]?.attributes?.[name] ?? null; }
  async evaluate() {
    const item = this.items[0] ?? {};
    return {
      text: item.text ?? '',
      role: item.role ?? 'status',
      tone: item.tone ?? '',
      classes: item.classes ?? '',
      ariaLive: item.ariaLive ?? 'polite'
    };
  }
}

function fakePage(items, url = 'https://kinex.test:7004/arcgis/orchard-workbench') {
  return {
    locator: () => new FakeLocator(items),
    getByRole: () => new FakeLocator(items),
    url: () => url,
    waitForTimeout: async () => {}
  };
}

const config = {
  defaultTimeoutMs: 100,
  toast: { timeoutMs: 100, dismissTimeoutMs: 100, selectors: ['.ui-toast'] }
};

test('assertToast verifies message and tone', async () => {
  const outcome = await runAssertion(
    fakePage([{ text: 'Saved Orchard saved successfully.', classes: 'ui-toast ui-toast--success' }]),
    { type: 'assertToast', contains: 'saved successfully', tone: 'success', label: 'Save notification' },
    config,
    {},
    { resolveTemplate: (value) => value }
  );

  assert.equal(outcome.type, 'assertToast');
  assert.equal(outcome.label, 'Save notification');
  assert.match(outcome.summary, /Toast verified/);
});

test('assertDisabled records a passed check', async () => {
  const outcome = await runAssertion(
    fakePage([{ text: 'Continue', enabled: false }]),
    { type: 'assertDisabled', locator: { selector: 'button' }, label: 'Continue blocked' },
    config,
    {},
    { resolveTemplate: (value) => value }
  );

  assert.equal(outcome.label, 'Continue blocked');
});


test('assertAttribute verifies a rendered state attribute', async () => {
  const outcome = await runAssertion(
    fakePage([{ attributes: { 'aria-pressed': 'true' } }]),
    {
      type: 'assertAttribute',
      locator: { selector: 'button' },
      name: 'aria-pressed',
      value: 'true',
      label: 'Map tool active'
    },
    config,
    {},
    { resolveTemplate: (value) => value }
  );

  assert.equal(outcome.label, 'Map tool active');
  assert.match(outcome.summary, /aria-pressed matched/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceEntityWizardToReview } from '../src/lib/entity-wizard.mjs';

function fakeWizard({ labels = ['Details', 'Contacts', 'Addresses', 'Review'],
  delayed = false, stall = false, atReview = false, created = false } = {}) {
  const state = { current: atReview ? labels.length - 1 : 0, clicks: 0, waiting: false, ticks: 0 };
  const onReview = () => state.current === labels.length - 1;
  const locator = (kind) => ({
    first() { return this; },
    getByRole(_role, { name }) { return locator(name); },
    isVisible: async () => {
      if (kind === 'Retry optional records') return created;
      if (kind === 'Create entity') return onReview() && !created;
      if (kind === 'Review') return onReview();
      if (kind === 'Next') return !onReview() && !(delayed && state.waiting);
      return true;
    },
    isEnabled: async () => true,
    waitFor: async () => {},
    getAttribute: async (attr) => attr === 'aria-label' ? labels[state.current] : null,
    allTextContents: async () => stall ? ['Field requires attention'] : [],
    async click() {
      if (kind !== 'Next') throw Error('unexpected click');
      state.clicks++;
      if (!stall && !delayed) state.current++;
      if (!stall && delayed) { state.waiting = true; state.ticks = 0; }
    }
  });
  const page = {
    locator(selector) {
      if (selector === '#create-review-heading') return locator('Review');
      if (selector === '.create-step-panel[role="region"]') return locator('Panel');
      if (selector === '.create-drawer__footer-actions') return locator('Footer');
      return locator('Feedback');
    },
    async waitForTimeout() {
      await new Promise(resolve => setTimeout(resolve, 2));
      if (state.waiting && ++state.ticks >= 3) { state.waiting = false; state.current++; }
    }
  };
  return { page, state };
}

test('Entity wizard stops on Review with Create entity, never waiting for absent Next', async () => {
  const {page,state} = fakeWizard();
  assert.equal(await advanceEntityWizardToReview(page, 100), 3);
  assert.equal(state.clicks, 3);
});

test('Entity wizard tolerates Blazor Validating state and only advances after step changes', async () => {
  const {page,state} = fakeWizard({delayed:true});
  assert.equal(await advanceEntityWizardToReview(page, 200), 3);
  assert.equal(state.clicks, 3);
});

test('Already on Review never clicks Next or submits', async () => {
  const {page,state} = fakeWizard({atReview:true});
  assert.equal(await advanceEntityWizardToReview(page, 100), 0);
  assert.equal(state.clicks, 0);
});

test('Validation stall fails with active step and feedback without clicking Next again', async () => {
  const {page,state} = fakeWizard({stall:true});
  await assert.rejects(advanceEntityWizardToReview(page, 30), /did not advance after Next.*Entity step: Details; validation: Field requires attention/s);
  assert.equal(state.clicks, 1);
});

test('Existing created Entity cannot be resubmitted from partial optional-record state', async () => {
  const {page,state} = fakeWizard({atReview:true,created:true});
  await assert.rejects(advanceEntityWizardToReview(page, 100), /already created.*refusing to retry/i);
  assert.equal(state.clicks, 0);
});

// KineX EntityCreateDrawer renders one active .create-step-panel region.
// Its footer replaces "Next" with "Create entity" on the Review step.
// Advancing by probing Next alone races Blazor rendering and can hang after
// the footer switches buttons. Treat the active step as the progress marker.
const visible = async (locator) => locator.isVisible().catch(() => false);
const enabled = async (locator) => locator.isEnabled().catch(() => false);
const currentStep = async (panel) =>
  (await panel.getAttribute('aria-label').catch(() => null))?.trim() || '';

async function wizardFailure(page, panel, message) {
  const step = await currentStep(panel);
  const feedback = await page.locator(
    '.create-step-panel .mo-field-error, .create-step-panel .validation-message, '
    + '.create-step-panel .create-submit-errors, .create-step-panel [role="alert"]'
  ).allTextContents().catch(() => []);
  const details = feedback.map(s => String(s).trim()).filter(Boolean).slice(0, 3).join(' | ');
  return new Error(`${message} (Entity step: ${step || 'unknown'}${details ? `; validation: ${details.slice(0, 350)}` : ''}).`);
}

export async function advanceEntityWizardToReview(page, timeoutMs = 25000) {
  const panel = page.locator('.create-step-panel[role="region"]').first();
  const footer = page.locator('.create-drawer__footer-actions').first();
  const next = footer.getByRole('button', { name: 'Next', exact: true }).first();
  const create = footer.getByRole('button', { name: 'Create entity', exact: true }).first();
  const retry = footer.getByRole('button', { name: 'Retry optional records', exact: true }).first();
  const review = page.locator('#create-review-heading').first();
  const maxSteps = 7;
  let advances = 0;
  let previousStep = '';
  let awaitingTransition = false;
  let stepDeadline = Date.now() + timeoutMs;

  while (Date.now() < stepDeadline) {
    // Do not attempt another submit if an earlier run already created this
    // entity but left optional record submission incomplete.
    if (await visible(retry)) {
      throw await wizardFailure(page, panel, 'Entity was already created; refusing to retry its submission');
    }
    // KineX displays Create entity instead of Next on Review. Testing this
    // button is more reliable than polling for a single heading during rerender.
    if (await visible(create)) {
      // Footer and step content can settle in separate Blazor renders.
      // The footer is the state signal; allow the Review content to catch up.
      if (!await visible(review)) {
        await review.waitFor({ state: 'visible', timeout: Math.min(3000, timeoutMs) })
          .catch(async () => { throw await wizardFailure(page, panel, 'Entity Create button appeared without its Review panel'); });
      }
      if (!await enabled(create)) {
        throw await wizardFailure(page, panel, 'Entity Review cannot be submitted (Create entity disabled)');
      }
      return advances;
    }

    const step = await currentStep(panel);
    if (awaitingTransition) {
      if (step && step !== previousStep) {
        awaitingTransition = false;
        stepDeadline = Date.now() + timeoutMs;
      } else {
        await page.waitForTimeout(120);
        continue;
      }
    }
    if (await visible(next) && await enabled(next)) {
      if (!step) {
        throw await wizardFailure(page, panel, 'Cannot identify active Entity wizard step before clicking Next');
      }
      if (advances >= maxSteps) {
        throw await wizardFailure(page, panel, 'Entity wizard exceeded expected number of steps');
      }
      previousStep = step;
      await next.click({ timeout: timeoutMs });
      advances += 1;
      awaitingTransition = true;
      // Even if Blazor replaces Next immediately, wait for an actual step
      // change or the Create button; never click stale Next twice.
      continue;
    }
    // Next temporarily becomes "Validating..." while KineX processes the
    // current step. Wait for it or for Create entity, not a missing Next.
    await page.waitForTimeout(120);
  }
  throw await wizardFailure(page, panel, awaitingTransition
    ? `Entity wizard did not advance after Next from '${previousStep}'`
    : 'Neither Next nor Create entity became available');
}

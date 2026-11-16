import { assert, field } from './block-hectares-frontend-assertions.mjs';

/** Verify the actual frontend allocation table shows saved child business hectares. */
export async function assertSavedChildrenInWorkbench(page, children, parentCode) {
  const shell = page.locator("[data-guide='business-form-shell'][data-guide-entity='maturity area']");
  await shell.waitFor({ state: 'visible', timeout: 90000 });
  await page.getByRole('tab', { name: 'Allocation', exact: true }).click();
  const table = page.locator("[data-guide='ma-blocks-tab']");
  await table.waitFor({ state: 'visible', timeout: 30000 });
  const exactCode = code => new RegExp(`^\\s*${String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  for (const child of children) {
    const code = field(child, 'orchardBlockCode');
    const rows = table.locator('tr').filter({ has: page.locator('.workbench-multi-block-table__block-code', { hasText: exactCode(code) }) });
    await rows.first().waitFor({ state: 'visible', timeout: 30000 });
    assert(await rows.count() === 1, `Expected one Workbench allocation row for child ${code}.`);
    const visible = await rows.first().locator('td').nth(1).innerText();
    const shown = Number(visible.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0]);
    assert(Number.isFinite(shown) && Math.abs(shown - Number(field(child,'blockArea'))) < 0.00011,
      `Workbench child ${code} displays ${visible}, but saved business hectares are ${field(child,'blockArea')}.`);
  }
  // In the active MA allocation view, the retired parent is no longer a row.
  const parentRows = table.locator('tr').filter({has:page.locator('.workbench-multi-block-table__block-code',{hasText:exactCode(parentCode)})});
  assert(await parentRows.count() === 0, `Retired parent ${parentCode} still appears in active MA Allocation.`);
}

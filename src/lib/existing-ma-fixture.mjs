import fs from 'node:fs/promises';
import path from 'node:path';
const isMaTestHost = host => ['localhost','127.0.0.1','::1','kinextest.seeka.co.nz'].includes(host.toLowerCase()) || host.toLowerCase().endsWith('.test') || host.toLowerCase().endsWith('.localhost');

const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const norm = value => String(value ?? '').trim().toLowerCase();
function need(value, name, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new Error(`maFixture.${name} must be explicitly configured.`);
  return value.trim();
}
export function validateExistingMaFixture(config) {
  const value = config.maFixture ?? {};
  if (value.enabled !== true || value.allowExistingTestOrchard !== true) {
    throw new Error('MA creation against an existing Orchard requires maFixture.enabled=true and allowExistingTestOrchard=true.');
  }
  const orchardPin = need(value.orchardPin, 'orchardPin', /^[A-Za-z0-9]{4,5}$/);
  const orchardName = need(value.orchardName, 'orchardName', /^[A-Za-z0-9][A-Za-z0-9 .'-]{2,90}$/);
  const blockCode = need(value.blockCode, 'blockCode', /^[A-Za-z0-9][A-Za-z0-9_-]{1,29}$/);
  const maCode = need(value.maCode, 'maCode', /^[A-Za-z0-9]{2,32}$/);
  const effectiveDate = need(value.effectiveDate, 'effectiveDate', /^\d{4}-\d{2}-\d{2}$/);
  if (!Number.isFinite(Date.parse(effectiveDate+'T00:00:00Z')) || new Date(effectiveDate+'T00:00:00Z').toISOString().slice(0,10) !== effectiveDate)
    throw new Error('maFixture.effectiveDate is not a real date.');
  const supplierName = need(value.supplierName, 'supplierName', /^.{2,150}$/);
  const supplierCode = need(value.supplierCode, 'supplierCode', /^[A-Za-z0-9][A-Za-z0-9_.-]{1,39}$/);
  if (value.orchardId && !guid.test(value.orchardId)) throw new Error('maFixture.orchardId must be a valid UUID.');
  if (value.fifthCharacter && !/^[A-Za-z0-9]$/.test(value.fifthCharacter))
    throw new Error('maFixture.fifthCharacter must contain one alphanumeric character.');
  if (value.truckAccessCode && !/^[A-Za-z0-9_.-]{1,32}$/.test(value.truckAccessCode))
    throw new Error('maFixture.truckAccessCode must be a reference code.');
  if (!isMaTestHost(new URL(config.baseUrl).hostname)) throw new Error('MA fixture writes require an allowed test KineX WEB host.');
  if (config.mutations?.enabled !== true || config.mutations?.confirmation !== config.mutations?.requiredConfirmation)
    throw new Error('MA fixture writes require the exact Guide Builder mutation confirmation.');
  return { orchardPin, orchardName, blockCode, maCode, effectiveDate, supplierName, supplierCode,
    orchardId: value.orchardId ?? null, fifthCharacter:value.fifthCharacter ?? 'Z',
    truckAccessCode:value.truckAccessCode ?? null };
}
export function exactSupplierOptions(options, name, code) {
  return options.filter(({name: n,code: c}) => norm(n) === norm(name) && norm(c) === norm(code));
}
export function selectedOption(options, requested, label) {
  const valid=options.filter(x=>x.value && !x.disabled);
  const matches=requested ? valid.filter(x=>{
    const escaped=requested.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`,'i').test(x.label);
  }) : valid;
  if (matches.length !== 1) throw new Error(`${label}: expected one enabled ${requested ? `option matching '${requested}'` : 'option'}, found ${matches.length}. Specify an exact reference code in maFixture.`);
  return matches[0].value;
}
function locatorRow(page,fixture) {
  return page.locator("[data-guide='orchard-row']").filter({hasText:fixture.orchardPin}).filter({hasText:fixture.orchardName});
}
// Safe guide selection: when an exact MA test Orchard is configured, do not
// select the first arbitrary Orchard, which may lack a Grower Supplier link.
export async function selectMaSafeGuideOrchard(page,config) {
  const f=config.maFixture;
  if (!f?.orchardPin || !f?.orchardName) {
    const first=page.locator("[data-guide='orchard-select']").first();
    await first.waitFor({state:'visible',timeout:10000});
    await first.click();
    return;
  }
  await page.locator("[data-guide='orchard-search']").fill(f.orchardPin);
  const row=locatorRow(page,f);
  await row.first().waitFor({state:'visible',timeout:10000});
  if(await row.count()!==1) throw new Error(`Safe MA guide could not uniquely select ${f.orchardName} PIN ${f.orchardPin}.`);
  await row.locator("[data-guide='orchard-select']").click();
  await page.locator("[data-guide='business-form-shell'][data-guide-entity='orchard']").waitFor({state:'visible',timeout:15000});
}
export async function selectExistingMaFixtureOrchard(page, config, runtime) {
  const f=validateExistingMaFixture(config);
  if (!isMaTestHost(new URL(page.url()).hostname)) throw new Error('Browser has left the test KineX host; refusing MA mutations.');
  await page.locator("button[role='tab'][title='Orchards']").click();
  await page.locator("[data-guide='orchard-navigator']").waitFor({state:'visible',timeout:20000});
  await page.locator("[data-guide='orchard-search']").fill(f.orchardPin);
  const row=locatorRow(page,f);
  await row.first().waitFor({state:'visible',timeout:20000});
  if(await row.count()!==1)throw new Error(`Expected exactly one test Orchard ${f.orchardName} PIN ${f.orchardPin}, found ${await row.count()}.`);
  if(f.orchardId) {
    const actual=await row.first().getAttribute('data-guide-orchard-id');
    if(actual && norm(actual)!==norm(f.orchardId))throw new Error(`Orchard ID mismatch: ${actual}`);
  }
  await row.locator("[data-guide='orchard-select']").click();
  const shell=page.locator("[data-guide='business-form-shell'][data-guide-entity='orchard']");
  await shell.waitFor({state:'visible',timeout:25000});
  const text=await shell.innerText();
  if(!text.includes(f.orchardPin)||!norm(text).includes(norm(f.orchardName)))
    throw new Error('Selected Orchard Business Form does not show the approved PIN and name.');
  runtime.existingMaFixture=f;
}
export async function ensureExistingMaFixtureSupplier(page,config,runtime) {
  const f=runtime.existingMaFixture??validateExistingMaFixture(config);
  await page.getByRole('tab',{name:/Grower Suppliers/i}).click();
  const section=page.locator("[data-guide='orchard-grower-supplies-tab']");
  await section.waitFor({state:'visible',timeout:20000});
  const rows=section.locator("[data-guide='orchard-grower-supply-row']");
  const names=await rows.allInnerTexts();
  const present=names.filter(text=>norm(text).includes(norm(f.supplierName)) && norm(text).includes(norm(f.supplierCode)));
  if(present.length>1)throw new Error('Multiple matching Grower Supplier links; manual review required.');
  if(present.length===0) {
    const add=section.locator("[data-guide='orchard-grower-supply-add']");
    await add.waitFor({state:'visible',timeout:10000});
    const picker=add.locator("input[aria-label='Grower supplier']");
    await picker.fill(f.supplierName);
    const options=add.locator('.workbench-reference-picker__option');
    await options.first().waitFor({state:'visible',timeout:20000});
    await page.waitForTimeout(350);
    const results=await options.evaluateAll(elements=>elements.map(el=>({name:el.querySelector('.workbench-reference-picker__option-label')?.textContent?.trim(),code:el.querySelector('.workbench-reference-picker__option-detail')?.textContent?.trim()})));
    const found=exactSupplierOptions(results,f.supplierName,f.supplierCode);
    if(found.length!==1)throw new Error(`Cannot uniquely find active Entity ${f.supplierName} (${f.supplierCode}) for Grower Supply. Matches: ${found.length}.`);
    const index=results.findIndex(r=>norm(r.name)===norm(f.supplierName)&&norm(r.code)===norm(f.supplierCode));
    await options.nth(index).click();
    const date=add.locator("input[aria-label='Add grower supply effective date']");
    const range=await date.evaluate(el=>({min:el.min,max:el.max}));
    if(range.min && f.effectiveDate<range.min || range.max && f.effectiveDate>range.max)
      throw new Error(`Grower Supplier link date ${f.effectiveDate} outside ${range.min}..${range.max}.`);
    await date.fill(f.effectiveDate);
    const fifth=add.locator("input[aria-label='Grower number 5th character']");
    if(await fifth.count()) await fifth.fill(f.fifthCharacter);
    const submit=add.getByRole('button',{name:'Add',exact:true});
    if(!await submit.isEnabled()) throw new Error('Grower Supplier Add disabled; check permission and Entity selection.');
    // A POST may commit even if the UI refresh fails: journal before the click.
    await persistFixtureJournal(config,f,{status:'supplier-submission-uncertain',supplierName:f.supplierName,supplierCode:f.supplierCode});
    await submit.click();
    await section.locator("[data-guide='orchard-grower-supply-row']").filter({hasText:f.supplierCode}).first().waitFor({state:'visible',timeout:45000});
  }
  const current=await section.locator("[data-guide='orchard-grower-supply-row']").allInnerTexts();
  if(current.filter(text=>norm(text).includes(norm(f.supplierName))&&norm(text).includes(norm(f.supplierCode))).length!==1)
    throw new Error('Grower Supplier link could not be verified in Orchard UI; do not submit MA.');
  await page.getByRole('tab',{name:'Overview',exact:true}).click();
}
export async function fillExistingMaFixtureDetails(page,config,runtime) {
  const f=runtime.existingMaFixture??validateExistingMaFixture(config);
  const d=page.locator("[data-guide='entity-create-drawer'][data-guide-entity='maturityarea']");
  await d.waitFor({state:'visible',timeout:20000});
  const parent=await d.locator("[data-guide='maturity-area-parent-context']").innerText();
  if(!norm(parent).includes(norm(f.orchardName)))
    throw new Error(`MA drawer is not on approved test Orchard ${f.orchardName} ${f.orchardPin}.`);
  await d.locator("[data-guide='maturity-area-code'] input").fill(f.maCode);
  const date=d.locator("[data-guide='maturity-area-effective-date'] input[type='date']");
  await date.waitFor({state:'visible',timeout:20000});
  for(let i=0;i<50&&!await date.isEnabled();i++)await page.waitForTimeout(150);
  const range=await date.evaluate(el=>({min:el.min,max:el.max}));
  if(range.min&&f.effectiveDate<range.min || range.max&&f.effectiveDate>range.max)
    throw new Error(`MA date ${f.effectiveDate} outside allowable ${range.min}..${range.max}; select a valid season.`);
  await date.fill(f.effectiveDate);
  const supplier=d.locator("[data-guide='maturity-area-grower-supply'] select");
  for(let i=0;i<60;i++) {
    const current=await supplier.locator('option').evaluateAll(nodes=>nodes.filter(o=>o.value).map(o=>({value:o.value,label:o.textContent.trim(),disabled:o.disabled})));
    const match=current.filter(x=>norm(x.label).includes(norm(f.supplierName)) && norm(x.label).includes(norm(f.orchardPin)));
    if(match.length===1){await supplier.selectOption(match[0].value);break;}
    if(i===59)throw new Error(`MA Grower Supply dropdown does not contain approved ${f.supplierName} (${f.supplierCode}) at ${f.effectiveDate}.`);
    await page.waitForTimeout(200);
  }
  const truck=d.locator("[data-guide='maturity-area-truck-access'] select");
  const options=await truck.locator('option').evaluateAll(nodes=>nodes.map(o=>({value:o.value,label:o.textContent.trim(),disabled:o.disabled})));
  await truck.selectOption(selectedOption(options,f.truckAccessCode,'Truck access'));
  const next=d.locator("[data-guide='create-continue-action'] button");
  await next.waitFor({state:'visible',timeout:15000});
  for(let i=0;i<50&&!await next.isEnabled();i++)await page.waitForTimeout(150);
  if(!await next.isEnabled())throw new Error('MA Details cannot continue; inspect validations and effective date.');
  await next.click();
  await d.locator("[data-guide='maturity-area-eligibility-groups']").waitFor({state:'visible',timeout:20000});
}
export async function selectExistingMaFixtureBlock(page,config,runtime){
  const f=runtime.existingMaFixture??validateExistingMaFixture(config);
  const d=page.locator("[data-guide='entity-create-drawer'][data-guide-entity='maturityarea']");
  const groups=d.locator("[data-guide='maturity-area-eligibility-group']");
  const input=d.locator(`[data-guide='maturity-area-block-list'] input[aria-label='Assign Block ${f.blockCode}']`);
  for(let i=0;i<await groups.count();i++){
    const group=groups.nth(i);
    if(!await group.evaluate(el=>el.open)) await group.locator('summary').first().click();
  }
  if(await input.count()!==1)throw new Error(`Expected one eligible Block ${f.blockCode} in MA wizard; got ${await input.count()}.`);
  if(!await input.isEnabled())throw new Error(`Block ${f.blockCode} is ineligible or already assigned to an MA.`);
  await input.check();
  const next=d.locator("[data-guide='create-continue-action'] button");
  await next.waitFor({state:'visible'});
  if(!await next.isEnabled())throw new Error('MA Block selection could not proceed to Review.');
  await next.click();
  await d.locator("[data-guide='ma-review-step']").waitFor({state:'visible',timeout:20000});
  const review=await d.locator("[data-guide='ma-review-step']").innerText();
  if(!review.includes(f.maCode))throw new Error(`MA Review does not show expected code ${f.maCode}.`);
}
export function existingMaJournalPath(config,f){
  // capture-all wipes outputDir on every run. Preserve mutation intent in .auth/
  // so a later safe guide build cannot erase the replay-protection journal.
  return path.resolve(path.dirname(config.authState),'ma-fixture-journals',`${f.orchardPin}-${f.maCode}`,'journal.json');
}
async function persistFixtureJournal(config,f,info){
  const filename=existingMaJournalPath(config,f);
  await fs.mkdir(path.dirname(filename),{recursive:true});
  const previous=await fs.readFile(filename,'utf8').then(JSON.parse,e=>e.code==='ENOENT'?null:Promise.reject(e));
  if (previous && (previous.orchardPin !== f.orchardPin || previous.maCode !== f.maCode || previous.blockCode !== f.blockCode))
    throw new Error(`MA fixture journal '${filename}' belongs to another Orchard/MA/Block.`);
  if (previous?.status === 'verified')
    throw new Error(`MA ${f.maCode} has already been created; do not repeat it. Journal: ${filename}`);
  if (previous?.status === 'supplier-submission-uncertain' && info.status === 'supplier-submission-uncertain')
    throw new Error(`Previous Grower Supplier Add may have committed. Check the Orchard link before retrying. Journal: ${filename}`);
  if (previous?.status === 'ma-submission-uncertain' && info.status !== 'verified')
    throw new Error(`Prior MA ${f.maCode} Create may have committed. Inspect the Workbench before re-running. Journal: ${filename}`);
  if (info.status === 'verified' && previous?.status !== 'ma-submission-uncertain')
    throw new Error('MA cannot be marked verified without a prior submission intent.');
  await fs.writeFile(filename,JSON.stringify({orchardPin:f.orchardPin,orchardName:f.orchardName,blockCode:f.blockCode,maCode:f.maCode,
    effectiveDate:f.effectiveDate,updatedAt:new Date().toISOString(),...info},null,2));
}
export async function submitExistingMaFixture(page,config,runtime){
  const f=runtime.existingMaFixture??validateExistingMaFixture(config);
  const d=page.locator("[data-guide='entity-create-drawer'][data-guide-entity='maturityarea']");
  const submit=d.locator("[data-guide='create-submit-action'] button");
  if(!await submit.isEnabled())throw new Error('MA submit not enabled.');
  await persistFixtureJournal(config,f,{status:'ma-submission-uncertain'});
  await submit.click();
  await d.waitFor({state:'hidden',timeout:90000});
  const form=page.locator("[data-guide='business-form-shell'][data-guide-entity='maturity area']");
  await form.waitFor({state:'visible',timeout:40000});
  const saved=await form.locator("[data-guide='ma-bf-code']").innerText();
  if(!saved.includes(f.maCode))throw new Error(`Saved MA code doesn't match ${f.maCode}.`);
  await persistFixtureJournal(config,f,{status:'verified'});
}

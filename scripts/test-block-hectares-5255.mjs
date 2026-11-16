#!/usr/bin/env node
// Browser-driven OMD-1638/OMD-1649 regression. All writes use the KineX Workbench UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/lib/config.mjs';
// Load Playwright only for browser stages; inventory/verify need only API GET access.
let runActions;
import { assertSavedChildrenInWorkbench } from '../src/lib/block-hectares-frontend-ui.mjs';
import { createHectareReadApi, discoverBlackburn, resolveEnteredArea } from '../src/lib/block-hectares-frontend-api.mjs';
import { assert, assertReadback, assertUuid, field, formatHa, haUnits, isActiveLeafBlock, validateScenario } from '../src/lib/block-hectares-frontend-assertions.mjs';
import { planMaturityAreaSetup, checkPersistedMa } from '../src/lib/block-hectares-frontend-ma-setup.mjs';

const norm = x => String(x ?? '').toLowerCase();
const sleep = ms => new Promise(resolve=>setTimeout(resolve,ms));
const RUN_MARKER = 'I-APPROVE-BLACKBURN-5255-MAS-AND-SPLIT';
const stages = ['inventory','preflight','setup-mas','run','verify'];
function parseArgs(argv) {
  const o={stage:'inventory',config:'./scenarios/block-hectares-frontend-blackburn-5255.json',target:'local-api',headed:false,apply:false,insecure:false};
  for (let i=0;i<argv.length;i++) {
    const key=argv[i];
    if (key==='--headed') {o.headed=true;continue;}
    if (key==='--apply') {o.apply=true;continue;}
    if (key==='-k') {o.insecure=true;continue;}
    if (!['--stage','--config','--target','--guide-config','--confirm','--journal'].includes(key) || !argv[i+1] || argv[i+1].startsWith('--'))
      throw new Error(`Unknown option ${key}. Usage: --stage inventory|preflight|setup-mas|run|verify --config FILE --target local-api [--headed] [--apply --confirm ${RUN_MARKER}] [-k].`);
    o[key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=argv[++i];
  }
  assert(stages.includes(o.stage),`--stage must be ${stages.join('/')}.`);
  assert(o.target==='local-api', 'Only --target local-api is allowed for this destructive frontend regression.');
  if (o.apply || ['setup-mas','run'].includes(o.stage)) assert(o.apply && o.confirm===RUN_MARKER,`The run stage requires --apply --confirm ${RUN_MARKER}.`);
  return o;
}
const first = locator => locator.first();
async function capture(page,out,label) {
  const file=path.join(out,`${label}.png`);
  if(!page.isClosed()) await page.screenshot({path:file,fullPage:false,animations:'disabled'}).catch(()=>{});
  return file;
}
function candidateForRun(discovery,scenario) {
  const rows=discovery.possible;
  assert(rows.length, `Blackburn ${scenario.orchardPin} has no active MA-assigned Blocks at ${scenario.asOfDate}. Existing data cannot be silently fabricated.`);
  if (!scenario.sourceBlockCode) return rows[0];
  const matches=rows.filter(item=>norm(field(item.block,'orchardBlockCode'))===norm(scenario.sourceBlockCode));
  assert(matches.length===1,`Block ${scenario.sourceBlockCode} has ${matches.length} active MA assignment candidates; choose an exact unique Block.`);
  return matches[0];
}
async function setAppSelection(page,guideConfig,scenario) {
  await page.locator("[data-guide='app-selection']").first().click();
  await page.locator("[data-guide='app-selection-modal']").waitFor({state:'visible'});
  const req=[['country',['NZ','New Zealand']],['crop',['KIWIFRUIT','Kiwifruit']],['season',['2027']]];
  for(const [name,aliases] of req) await runActions(page,[{type:'selectOptionByAliases',locator:{selector:`[data-guide='app-selection-${name}']`},aliases,timeoutMs:15000}],guideConfig);
  await page.locator("[data-guide='app-selection-apply']").click();
  await page.locator("[data-guide='app-selection-modal']").waitFor({state:'hidden',timeout:30000});
}
async function openWorkbench(page,guideConfig,scenario,orchardId) {
  if (page.url()==='about:blank') await page.goto(new URL('/arcgis/orchard-workbench',guideConfig.baseUrl).href,{waitUntil:'domcontentloaded'});
  await page.locator("[data-guide='orchard-workbench']").waitFor({state:'visible',timeout:60000});
  await setAppSelection(page,guideConfig,scenario);
  const deepLink=new URL('/arcgis/orchard-workbench',guideConfig.baseUrl);
  deepLink.searchParams.set('orchardId',orchardId);
  await page.goto(deepLink.href,{waitUntil:'domcontentloaded'});
  await page.locator("[data-guide='orchard-workbench']").waitFor({state:'visible',timeout:60000});
  await page.locator("[data-guide='workbench-map']").waitFor({state:'visible',timeout:60000});
}
async function openMaBlockRow(page,candidate) {
  const sourceCode=field(candidate.block,'orchardBlockCode'), maCode=field(candidate.ma,'maturityAreaCode');
  const nav=page.locator(".workbench-ma-row button[aria-label^='Select Maturity Area ']");
  await first(page.locator("button[role='tab'][title='Maturity Areas']")).click();
  await first(page.locator("[data-guide='maturity-area-navigator']")).waitFor({state:'visible',timeout:25000});
  const search=page.locator("[data-guide='maturity-area-search']");
  if(await search.count()) await first(search).fill(maCode);
  const count=await nav.count();
  assert(count>0,`No visible Maturity Area navigation result for ${maCode}.`);
  let found=false;
  for(let i=0;i<count;i++) {
    const label=await nav.nth(i).getAttribute('aria-label');
    if(label && label.toLowerCase().includes(String(maCode).toLowerCase())) {
      await nav.nth(i).click(); found=true;break;
    }
  }
  if (!found) {
    assert(count===1,`Maturity Area ${maCode} not uniquely resolved in navigator (${count} visible results).`);
    await nav.first().click();
  }
  await page.locator("[data-guide='business-form-shell'][data-guide-entity='maturity area']").waitFor({state:'visible',timeout:30000});
  // MA names/codes can repeat across Orchards. An API assignment alone does not
  // prove the browser selected the same Orchard; verify its visible parent.
  const parentField=page.locator("[data-guide='ma-bf-orchard']");
  await parentField.waitFor({state:'visible',timeout:10000});
  const parentText=await parentField.innerText();
  assert(/blackburn/i.test(parentText),`Selected MA ${maCode} belongs to unexpected frontend parent: ${parentText}.`);
  const maField=page.locator("[data-guide='ma-bf-code']");
  await maField.waitFor({state:'visible',timeout:10000});
  assert((await maField.innerText()).toLowerCase().includes(String(maCode).toLowerCase()),
    `Frontend MA code does not match the verified API assignment ${maCode}.`);
  await page.getByRole('tab',{name:'Allocation',exact:true}).click();
  const table=page.locator("[data-guide='ma-blocks-tab']");
  await table.waitFor({state:'visible',timeout:30000});
  const row=table.locator('tr').filter({has:page.locator('.workbench-multi-block-table__block-code',{hasText:new RegExp(`^\\s*${sourceCode.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\s*$`,'i')})});
  assert(await row.count()===1,`Expected one MA allocation row for Block ${sourceCode}; found ${await row.count()}.`);
  const mapped=await row.locator('.workbench-multi-block-table__map--linked').count();
  assert(mapped===1,`Block ${sourceCode} is not mapped in the MA table. Split Pick is NOT a physical Block split.`);
  return row;
}
async function proveSplitUi(page,candidate) {
  const row=await openMaBlockRow(page,candidate);
  const action=row.locator("[data-guide='multi-block-table-secondary-action'][aria-label^='Split Block ']");
  const menu=row.locator("[data-guide='multi-block-table-secondary-action-menu']");
  if (await action.count()===1) {
    assert(await action.isEnabled(),`Split Block is disabled for ${field(candidate.block,'orchardBlockCode')}; check season eligibility and permissions.`);
    return { type:'button', action };
  }
  if (await menu.count()===1) {
    assert(await menu.isEnabled(), 'Block action menu is disabled.');
    return { type:'menu', action:menu };
  }
  throw new Error('Split Block action is not available in the MA allocation row; cannot perform frontend split.');
}
async function openSourceBlock(page,candidate) {
  const row=await openMaBlockRow(page,candidate);
  const link=row.locator('.workbench-multi-block-table__open-link');
  assert(await link.count()===1,'Block row does not expose its frontend Open Block link.');
  await link.click();
  await page.locator("[data-guide='business-form-shell'][data-guide-entity='block']").waitFor({state:'visible',timeout:30000});
}
async function applyManualAreaFromUi(page,candidate,scenario,enteredHa,existingManualHa) {
  await openSourceBlock(page,candidate);
  const detailsTab=page.getByRole('tab',{name:'Details',exact:true});
  if(await detailsTab.count() && !(await detailsTab.first().getAttribute('aria-selected')==='true')) {
    await detailsTab.first().click();
  }
  const edit=page.locator("[data-guide='business-form-shell'][data-guide-entity='block'] [data-guide='business-edit-action']:not(:disabled)");
  assert(await edit.count()>=1,'Block edit is disabled or user lacks permission.');
  await edit.first().click();
  const change=page.locator("[data-guide='schedule-change-modal']");
  await change.waitFor({state:'visible',timeout:30000});
  const date=change.locator("input[type='date']");
  assert(await date.count()===1,'Block edit change-at date input missing.');
  await date.fill(scenario.manualEntryDate);
  const viewed=change.getByRole('button',{name:'Use viewed state',exact:true});
  if(await viewed.isVisible().catch(()=>false)) await viewed.click();
  await change.getByRole('button',{name:'Continue',exact:true}).click();
  const form=page.locator("[data-guide='business-form-shell'][data-guide-entity='block'][data-guide-mode='edit']");
  await form.waitFor({state:'visible',timeout:20000});
  const override=form.locator("[data-guide='block-area-override'] input[type='checkbox']");
  await override.check();
  await form.getByRole('spinbutton',{name:'Area hectares'}).fill(enteredHa);
  await form.getByRole('textbox',{name:'Area override reason'}).fill(scenario.manualOverrideReason);
  const save=form.locator("[data-guide='business-edit-save'] button");
  if (!(await save.isEnabled())) {
    if (existingManualHa !== null && haUnits(existingManualHa,'prior saved manual hectares')===haUnits(enteredHa,'requested hectares')) {
      const cancel=form.locator("[data-guide='business-edit-cancel'] button");
      await cancel.click();
      await form.waitFor({state:'hidden',timeout:20000});
      return false;
    }
    throw new Error('Manual area edit did not enable Save; check validation, change-at date and entered value.');
  }
  await save.click();
  await form.waitFor({state:'hidden',timeout:60000});
  return true;
}
async function drawCutThroughUi(page,candidate,scenario) {
  const info=await page.evaluate(async({ blockId, cutLine }) => {
    const state=await import('/js/arcgis-map-state.js');
    const root=document.querySelector("[data-guide='workbench-map']");
    const pair=[...state.activeMapViews.entries()].find(([,x])=>x.view?.container && root?.contains(x.view.container));
    if(!pair) return {error:'Workbench MapView not registered.'};
    const [mapViewId,entry]=pair;
    const view=entry.view; await view.when();
    // Capture uses a polyline sketch, never polygon creation or direct FeatureServer writes.
    const editing=[...state.activeGeometryEdits.values()].filter(x=>x.mode==='capture' && x.terminalIntent===null);
    if(editing.length!==1 || editing[0].mapViewId!==mapViewId) return {error:`Expected one active drawing capture for this MapView, found ${editing.length}.`};
    if(entry.mapClickEnabled===true) return {error:'Map selection handler still enabled during split drawing.'};
    const layers=view.map.allLayers.toArray().filter(layer=>String(layer.url??'').replace(/\/$/,'').endsWith('/5'));
    if(layers.length!==1)return {error:`Expected one Block FeatureLayer /5; found ${layers.length}.`};
    const layer=layers[0];
    await layer.load();
    const code=layer.fields?.find(x=>x.name?.toLowerCase()==='canonicalid')?.name;
    if(!code)return {error:'Block layer has no CanonicalID field; refusing unscoped geometry query.'};
    const response=await layer.queryFeatures({where:`${code} = '${blockId}'`,outFields:[code],returnGeometry:true,num:2});
    if(response.features.length!==1)return {error:`Expected exactly one mapped Block feature for ${blockId}, got ${response.features.length}.`};
    const g=response.features[0].geometry;
    if(g?.type!=='polygon'||!g.extent)return {error:'Mapped Block did not return polygon geometry.'};
    const extent=g.extent;
    if(!(extent.width>0 && extent.height>0))return {error:'Block geometry extent is empty.'};
    await view.goTo(extent.expand(2.2),{animate:false});
    const Point=(await window.$arcgis.import(['@arcgis/core/geometry/Point.js']))[0].default;
    const rect=view.container.getBoundingClientRect();
    const pts=cutLine.map(([x,y])=>{
      const pt=new Point({x:extent.xmin+extent.width*x,y:extent.ymin+extent.height*y,spatialReference:g.spatialReference});
      const onView=view.toScreen(pt);
      const sx=rect.left+onView.x,sy=rect.top+onView.y;
      const hit=document.elementFromPoint(sx,sy);
      const safe=Number.isFinite(sx)&&Number.isFinite(sy) && sx>rect.left+10&&sx<rect.right-10&&sy>rect.top+10&&sy<rect.bottom-10
        && hit && view.container.contains(hit) && !hit.closest('.esri-ui, button, [role="button"]');
      return {x:sx,y:sy,safe:Boolean(safe)};
    });
    if(pts.some(p=>!p.safe))return {error:`Cut-line map points aren't safe to click: ${JSON.stringify(pts)}.`};
    const own=editing[0];
    return {points:pts,editId:own.editId,activeTool:own.sketchViewModel?.activeTool,
      captureVertexCount:own.captureVertexCount,layerUrl:layer.url,blockId};
  },{blockId:field(candidate.block,'orchardBlockId'),cutLine:scenario.cutLine});
  if(info.error) throw new Error(info.error);
  assert(info.activeTool==='polyline' || String(info.activeTool??'').includes('polyline'),`Expected KineX polyline sketch, got '${info.activeTool}'.`);
  assert((info.captureVertexCount??0)===0,'Split sketch already contains committed vertices; refusing to append.');
  for(const p of info.points) {
    await page.mouse.click(p.x,p.y);
    await sleep(250);
  }
  const done=page.locator("[data-guide='geometry-done'] button");
  await done.waitFor({state:'visible',timeout:15000});
  await page.waitForFunction(() => {
    const el=document.querySelector("[data-guide='geometry-done'] button");
    return el && !el.disabled;
  },null,{timeout:12000});
  await done.click();
}
async function selectMaReference(page, containerSelector, preferred, description) {
  const select=page.locator(`${containerSelector} select`).first();
  await select.waitFor({state:'visible',timeout:20000});
  for(let i=0;i<25 && !(await select.isEnabled());i++) await sleep(200);
  assert(await select.isEnabled(),`${description} selector stayed disabled.`);
  const options=await select.locator('option').evaluateAll(elements=>elements
    .filter(element=>element.value && !element.disabled)
    .map(element=>({value:element.value,label:element.textContent.trim()})));
  assert(options.length>0,`No active ${description} available for Blackburn MA creation.`);
  let match;
  if (preferred) {
    match=options.find(option=>norm(option.value)===norm(preferred) || norm(option.label)===norm(preferred));
    assert(match,`Configured ${description} '${preferred}' not offered by the frontend. Choices: ${options.map(x=>x.label).join(' | ')}`);
  } else {
    assert(options.length===1 || description==='Truck access',
      `Multiple Grower Supply options are active for Blackburn. Set maSetup.growerSupplyEntityId to the intended Entity ID. Options: ${options.map(x=>`${x.label} (${x.value})`).join(' | ')}`);
    match=options[0];
  }
  await select.selectOption(match.value);
  return match;
}
async function openMaCreateWizard(page,guide,scenario,orchardId) {
  await openWorkbench(page,guide,scenario,orchardId);
  const orchardForm=page.locator("[data-guide='business-form-shell'][data-guide-entity='orchard']");
  await orchardForm.waitFor({state:'visible',timeout:45000});
  const create=page.locator("[data-guide='context-create-ma']:not(:disabled)");
  await create.first().waitFor({state:'visible',timeout:20000});
  assert(await create.count()===1,'Expected one enabled Create MA action for Blackburn.');
  await create.click();
  const drawer=page.locator("[data-guide='entity-create-drawer'][data-guide-entity='maturityarea']");
  await drawer.waitFor({state:'visible',timeout:20000});
  const parent=await drawer.locator("[data-guide='maturity-area-parent-context']").innerText();
  assert(/blackburn/i.test(parent) && parent.includes(scenario.orchardPin),
    `MA wizard is not scoped to Blackburn PIN ${scenario.orchardPin}: ${parent}`);
  return drawer;
}
async function cancelMaCreateWizard(drawer) {
  const cancel=drawer.locator("[data-guide='create-cancel-action'] button");
  if (await cancel.count()) await cancel.first().click();
  await drawer.waitFor({state:'hidden',timeout:15000});
}
async function createMaFromBrowser(page,guide,scenario,discovery,plan,recordIntent,{dryRun=false,onReview=null}={}) {
  const drawer=await openMaCreateWizard(page,guide,scenario,discovery.orchardId);
  await drawer.locator("[data-guide='maturity-area-code'] input").fill(plan.code);
  const date=drawer.locator("[data-guide='maturity-area-effective-date'] input[type='date']");
  await date.waitFor({state:'visible',timeout:20000});
  assert(await date.isEnabled(),`Cannot choose effective date for ${plan.code}.`);
  await date.fill(scenario.asOfDate);
  const truck=await selectMaReference(page,"[data-guide='maturity-area-truck-access']",
    scenario.maSetup.truckAccessId,'Truck access');
  const supplier=await selectMaReference(page,"[data-guide='maturity-area-grower-supply']",
    scenario.maSetup.growerSupplyEntityId,'Grower Supply');
  const next=drawer.locator("[data-guide='create-continue-action'] button");
  await next.waitFor({state:'visible',timeout:15000});
  for(let i=0;i<75 && !(await next.isEnabled());i++) await sleep(200);
  assert(await next.isEnabled(),
    `Cannot continue MA ${plan.code}: ${(await drawer.locator("[data-guide='create-continue-blocker'], [data-guide='create-validation-summary']").allInnerTexts()).join(' | ')}`);
  await next.click();
  await drawer.locator("[data-guide='maturity-area-eligibility-groups']").waitFor({state:'visible',timeout:25000});
  const name=`Assign Block ${plan.blockCode}`;
  // Locate exactly by accessible label instead of selecting the first available Block.
  const box=drawer.locator(`[data-guide='maturity-area-block-list'] input[aria-label='${name}']`);
  assert(await box.count()===1,`MA ${plan.code} cannot select ${plan.blockCode}: ${await box.count()} matching eligible Block rows.`);
  const owning=box.locator('xpath=ancestor::*[@data-guide="maturity-area-eligibility-group"]');
  if (await owning.count()===1 && !(await owning.evaluate(element=>element.open))) {
    await owning.locator('summary').first().click();
  }
  assert(await box.isEnabled(),`MA ${plan.code}: Block ${plan.blockCode} isn't eligible or is already assigned.`);
  await box.check();
  for(let i=0;i<50 && !(await next.isEnabled());i++) await sleep(200);
  assert(await next.isEnabled(),`MA ${plan.code} review cannot proceed for Block ${plan.blockCode}.`);
  await next.click();
  await drawer.locator("[data-guide='ma-review-step']").waitFor({state:'visible',timeout:25000});
  const review=await drawer.locator("[data-guide='ma-review-step']").innerText();
  assert(review.includes(plan.code),`MA review does not show ${plan.code}; refusing creation.`);
  if(onReview) await onReview();
  if(dryRun) { await cancelMaCreateWizard(drawer); return; }
  const submit=drawer.locator("[data-guide='create-submit-action'] button");
  for(let i=0;i<50 && !(await submit.isEnabled());i++) await sleep(200);
  assert(await submit.isEnabled(),`MA ${plan.code} submit is disabled.`);
  // Persist intent *before* clicking Create. A timeout after a successful API commit
  // must never automatically resubmit an MA with the same code.
  await recordIntent({code:plan.code,blockCode:plan.blockCode,truckAccess:truck,
    supplier,clickedAt:new Date().toISOString()});
  await submit.click();
  await drawer.waitFor({state:'hidden',timeout:90000});
}
async function ensureFrontendMas(page,guide,api,scenario,discovery,recordIntent,onSaved,artifactsDir) {
  let current=discovery;
  for (let i=0;i<2;i++) {
    const plan=planMaturityAreaSetup(current,scenario)[i];
    // Recalculate the plan after each create: the newly assigned Block must not
    // accidentally become a second MA's selectable source.
    if (plan.action==='create') {
      await createMaFromBrowser(page,guide,scenario,current,plan,recordIntent,
        {onReview:()=>capture(page,artifactsDir,`ma-${i+1}-review`)});
      // A successful UI response can precede the query/cache refresh.
      for(let attempt=0;attempt<10;attempt++) {
        current=await discoverBlackburn(api,scenario);
        if(current.activeMas.some(ma=>norm(field(ma,'maturityAreaCode'))===norm(plan.code))) break;
        await sleep(1200);
      }
    }
    const verified=checkPersistedMa(current,plan);
    const area=await api.area('maturity-areas',verified.maId,scenario.asOfDate);
    const sourceBlock=current.blocks.find(block=>norm(field(block,'orchardBlockId'))===norm(verified.blockId));
    const savedWithAreas={...verified,blockBusinessHectares:field(sourceBlock,'blockArea'),
      maEffectiveHectares:field(area,'effectiveAreaHectares'),
      maSpatialHectares:field(area,'spatialAreaHectares')};
    await onSaved(savedWithAreas);
    await capture(page,artifactsDir,`ma-${i+1}-saved`);
  }
  return current;
}

function parsePreviewArea(text) {
  const found=String(text).replace(/,/g,'').match(/([0-9]+(?:\.[0-9]+)?)\s*ha/i);
  assert(found,`Cannot parse the GUI split preview area '${text}'.`);
  const value=Number(found[1]);assert(Number.isFinite(value)&&value>0,'Invalid split preview GIS hectares.');
  return value;
}
async function readSplitPreview(page) {
  const panel=page.locator("[data-guide='geometry-task-panel'][data-guide-stage='split-preview'], [data-guide='geometry-task-panel']:has([data-guide='block-split-pending-confirm'])");
  await panel.first().waitFor({state:'visible',timeout:90000});
  const rows=panel.first().locator("[data-guide='block-split-preview-part']");
  const count=await rows.count();
  assert(count===2,`Expected exactly two GIS split preview polygons, got ${count}; cancelling without a commit.`);
  const areas=[];
  for(let i=0;i<count;i++) {
    const cell=rows.nth(i).locator("[role='cell']").nth(1);
    areas.push(parsePreviewArea(await cell.innerText()));
  }
  assert(areas.every(a=>a>0),'Geometry preview must return positive areas.');
  return areas;
}
async function readSaved(api,discovery,candidate,scenario,sourceBaseline,previewAreas) {
  const activeAtSplit=await api.blocks(discovery.orchardId,scenario.splitDate);
  assert(!activeAtSplit.some(x=>norm(field(x,'orchardBlockId'))===norm(field(candidate.block,'orchardBlockId'))),
    'Source Block remains active at split date; check temporal retirement before declaring success.');
  const childRows=activeAtSplit.filter(x=>norm(field(x,'parentOrchardBlockId'))===norm(field(candidate.block,'orchardBlockId')));
  assert(childRows.length===2,`Found ${childRows.length} saved split children. Do not click Confirm split again.`);
  const children=[];
  for(const row of childRows) children.push(await api.block(field(row,'orchardBlockId'),scenario.splitDate));
  const controlsBefore=discovery.blocks.filter(x=>norm(field(x,'orchardBlockId'))!==norm(field(candidate.block,'orchardBlockId')));
  const controlsAfter=activeAtSplit.filter(x=>controlsBefore.some(y=>norm(field(y,'orchardBlockId'))===norm(field(x,'orchardBlockId'))));
  const result=assertReadback({orchardId:discovery.orchardId,parent:sourceBaseline,children,splitDate:scenario.splitDate,
    expectedHectares:formatHa(resolveEnteredArea(sourceBaseline,null,null)),previewAreas,controlsBefore,controlsAfter});
  const childAreas=[];
  for (const row of children) {
    const id=field(row,'orchardBlockId');
    const maId=field(candidate.ma,'maturityAreaId');
    const assignments=[field(row,'assignedMaturityAreaId'),...(field(row,'maturityAreaAssignments')??[]).map(x=>field(x,'maturityAreaId'))];
    assert(assignments.some(x=>norm(x)===norm(maId)),
      `Split child ${id} is not assigned to the original Maturity Area ${maId}.`);
    const state=await api.area('blocks',id,scenario.splitDate);
    const measured=field(state,'spatialAreaHectares');
    assert(measured!==null,`Child ${id} missing GIS hectares after publishing split.`);
    const effective=field(state,'effectiveAreaHectares');
    assert(haUnits(effective,'child effective business hectares')===haUnits(field(row,'blockArea'),'child BlockArea'),
      'Child effective business area differs from its saved business BlockArea.');
    childAreas.push({blockId:id,businessHectares:field(row,'blockArea'),gisHectares:measured,
      manualAreaHectares:field(state,'manualAreaHectares')});
  }
  const maBefore=await api.area('maturity-areas',field(candidate.ma,'maturityAreaId'),scenario.manualEntryDate);
  const ma=await api.area('maturity-areas',field(candidate.ma,'maturityAreaId'),scenario.splitDate);
  const maBeforeBusiness=field(maBefore,'effectiveAreaHectares'),maAfterBusiness=field(ma,'effectiveAreaHectares');
  if (maBeforeBusiness!==null && maAfterBusiness!==null) {
    assert(haUnits(maBeforeBusiness,'MA business before split')===haUnits(maAfterBusiness,'MA business after split'),
      'MA business hectares changed when a source Block was replaced by conserved split children.');
  }
  return { ...result,childAreas,maBusinessHectares:field(ma,'effectiveAreaHectares'),maBusinessBeforeSplit:maBeforeBusiness,maGisHectares:field(ma,'spatialAreaHectares'),
    sourceId:field(sourceBaseline,'orchardBlockId'),children:childRows.map(row=>field(row,'orchardBlockId')) };
}
async function main() {
  const opts=parseArgs(process.argv.slice(2));
  const scenario=validateScenario(JSON.parse((await fs.readFile(path.resolve(opts.config),'utf8')).replace(/^\uFEFF/,'')));
  const guide=await loadConfig(opts.guideConfig??'./config.json');
  const webHost=new URL(guide.baseUrl).hostname.toLowerCase();
  assert(['localhost','127.0.0.1'].includes(webHost) || webHost.endsWith('.test'),
    'Refusing to drive a non-test KineX.WEB frontend.');
  // An older Guide Builder config.json may not define API targets. Only the
  // explicit loopback local-api fallback is allowed: never infer an API from
  // the WEB host or silently use a shared test endpoint.
  const apiTarget=guide.apiTargets?.[opts.target]?.baseUrl ?? 'https://localhost:7002';
  if(opts.insecure) console.warn('WARNING: -k disables certificate verification for LOOPBACK API read requests only.');
  const api=createHectareReadApi(apiTarget,{apiKey:process.env.KINEX_E2E07_API_KEY,bearer:process.env.KINEX_E2E07_BEARER_TOKEN,insecureLoopback:opts.insecure});
  const dir=path.resolve('output/blackburn-5255',scenario.testRunId);
  const journalPath=path.resolve(opts.journal??path.join(dir,'journal.json'));
  if (opts.stage==='verify') {
    const saved=JSON.parse(await fs.readFile(journalPath,'utf8'));
    assert(saved.testRunId===scenario.testRunId && saved.pin===scenario.orchardPin,'Journal belongs to another scenario.');
    assert(saved.confirmRequested===true,'Journal has no confirmed frontend split.');
    const d=await discoverBlackburn(api,scenario);
    assert(norm(saved.orchardId)===norm(d.orchardId),'Journal Orchard ID changed.');
    const maPlans=planMaturityAreaSetup(d,scenario);
    maPlans.forEach(plan=>checkPersistedMa(d,plan));
    const c=d.possible.find(x=>norm(field(x.block,'orchardBlockId'))===norm(saved.sourceId));
    assert(c,'Source Block is no longer available from the original as-of date.');
    const result=await readSaved(api,d,c,scenario,saved.sourceBaseline,saved.previewGisAreas);
    console.log(JSON.stringify({stage:'verify',noWrites:true,result},null,2));return;
  }
  let discovery=await discoverBlackburn(api,scenario);
  const unassigned=discovery.blocks.filter(block=>!field(block,'assignedMaturityAreaId')
    && (field(block,'maturityAreaAssignments')??[]).length===0
    && isActiveLeafBlock(block, discovery.blocks))
    .map(block=>({code:field(block,'orchardBlockCode'),id:field(block,'orchardBlockId'),
      businessHa:field(block,'blockArea'),
      parentOrchardBlockId:field(block,'parentOrchardBlockId')??null}));
  console.log(JSON.stringify({stage:'inventory',orchard:discovery.orchardName,pin:discovery.pin,orchardId:discovery.orchardId,
    seasonId:discovery.seasonId,blocks:discovery.blocks.length,maturityAreas:discovery.activeMas.length,
    unassignedBlocks:unassigned,existingCandidates:discovery.candidates,
    next:'Set sourceBlockCode to an unassigned, mapped active leaf Block (root or split child). Setup creates two test MAs through the frontend before splitting.',
    noWrites:!['run','setup-mas'].includes(opts.stage)},null,2));
  if (opts.stage==='inventory') return;
  const sourceMatches=discovery.blocks.filter(block=>norm(field(block,'orchardBlockCode'))===norm(scenario.sourceBlockCode));
  assert(sourceMatches.length===1,`Source Block ${scenario.sourceBlockCode} was not uniquely found in Blackburn.`);
  const source=await api.block(field(sourceMatches[0],'orchardBlockId'),scenario.asOfDate);
  const blockId=field(source,'orchardBlockId');
  const plans=planMaturityAreaSetup(discovery,scenario);
  const effectiveFrom=String(field(source,'effectiveFromDate')??'').slice(0,10);
  assert(/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
    && scenario.manualEntryDate>=effectiveFrom && scenario.splitDate>effectiveFrom,
    `Source Block effective-from ${effectiveFrom} conflicts with manual entry ${scenario.manualEntryDate} or split ${scenario.splitDate}.`);
  const sourceArea=await api.area('blocks',blockId,scenario.asOfDate);
  const enteredUnits=resolveEnteredArea(source,sourceArea,scenario.enteredHectares);
  const enteredHa=formatHa(enteredUnits);
  // A non-null parent ID is valid: KineX supports nested physical splits.
  // Reject only a source that has already been split (active children) or is
  // no longer active at the intended split date. The UI/API still enforce
  // season and spatial eligibility at the actual commit.
  const activeAtSplit = await api.blocks(discovery.orchardId, scenario.splitDate);
  assert(activeAtSplit.some(block=>norm(field(block,'orchardBlockId'))===norm(blockId)),
    `Source Block ${scenario.sourceBlockCode} is not active at ${scenario.splitDate}.`);
  assert(isActiveLeafBlock(source,activeAtSplit),
    `Source Block ${scenario.sourceBlockCode} already has active children at ${scenario.splitDate}; select an active leaf.`);
  const baselineSpatial=field(sourceArea,'spatialAreaHectares');
  assert(baselineSpatial!==null,'Source has no linked GIS hectares; cannot validate business vs GIS authority.');
  assert(Math.abs(Number(baselineSpatial)-Number(enteredHa))>0.00005,'Source entered and GIS hectares are equal; configure enteredHectares to a distinct manual test value.');
  const journalExists=await fs.stat(journalPath).then(()=>true,()=>false);
  if (['run','setup-mas'].includes(opts.stage) && journalExists) {
    const old=JSON.parse(await fs.readFile(journalPath,'utf8'));
    assert(old.testRunId===scenario.testRunId && old.pin===scenario.orchardPin
      && norm(old.orchardId)===norm(discovery.orchardId) && norm(old.sourceId)===norm(blockId),
      'An earlier journal belongs to a different source/Orchard; refusing to resume.');
    assert(!old.confirmRequested, 'The split Confirm was previously requested. Do not repeat it; use --stage verify.');
    for(const pending of old.maCreateIntents??[]) {
      if ((old.createdMas??[]).some(saved=>norm(saved.code)===norm(pending.code))) continue;
      const planned=plans.find(plan=>norm(plan.code)===norm(pending.code));
      assert(planned && planned.action==='reuse',
        `Previous MA create '${pending.code}' may have committed. Verify its saved state before retrying; no automatic re-submit.`);
      checkPersistedMa(discovery,planned);
    }
  }
  const [{launchAuthenticatedBrowser}, actionModule] = await Promise.all([
    import('../src/lib/browser.mjs'), import('../src/lib/actions.mjs')
  ]);
  runActions=actionModule.runActions;
  const session=await launchAuthenticatedBrowser(guide,{headed:opts.headed});
  const page=session.page;
  await fs.mkdir(dir,{recursive:true});
  try {
    await openWorkbench(page,guide,scenario,discovery.orchardId);
    if (opts.stage==='preflight') {
      if (plans.some(plan=>plan.action==='create')) {
        const pending=plans.find(plan=>plan.action==='create');
        await createMaFromBrowser(page,guide,scenario,discovery,pending,null,
          {dryRun:true,onReview:()=>capture(page,dir,'01-ma-creation-wizard-preflight')});
      } else {
        const selected=candidateForRun(discovery,scenario);
        await proveSplitUi(page,selected);
        await capture(page,dir,'01-existing-mas-and-mapped-block');
      }
      console.log(JSON.stringify({stage:'preflight',noWrites:true,maSetupPlan:plans,
        sourceBlockId:blockId,sourceCode:field(source,'orchardBlockCode'),
        sourceParentBlockId:field(source,'parentOrchardBlockId')??null,
        enteredHectares:enteredHa,spatialHectares:baselineSpatial,
        next:'run with --apply and exact --confirm phrase; creates missing MAs via the UI before splitting'},null,2));
      return;
    }
    let before=journalExists ? JSON.parse(await fs.readFile(journalPath,'utf8')) :
      {testRunId:scenario.testRunId,pin:scenario.orchardPin,orchardId:discovery.orchardId,
       sourceId:blockId,sourceBaseline:source,baselineSpatial,enteredHa,previewGisAreas:null,
       confirmRequested:false,completed:false,maCreateIntents:[],createdMas:[],
       steps:['preflight'],createdAt:new Date().toISOString()};
    if(!journalExists) {
      const handle=await fs.open(journalPath,'wx',0o600);
      await handle.writeFile(JSON.stringify(before,null,2)+'\n');
      await handle.close();
    }
    const saveJournal=async()=>fs.writeFile(journalPath,JSON.stringify(before,null,2)+'\n');
    discovery=await ensureFrontendMas(page,guide,api,scenario,discovery,
      async intent=>{before.maCreateIntents??=[];before.maCreateIntents.push(intent);await saveJournal();},
      async saved=>{before.createdMas??=[];
        before.createdMas=before.createdMas.filter(row=>norm(row.code)!==norm(saved.code)).concat(saved);
        before.steps.push(`ma-${saved.code}-verified`);await saveJournal();},dir);
    await capture(page,dir,'01-two-mas-verified');
    const selected=candidateForRun(discovery,scenario);
    assert(norm(field(selected.ma,'maturityAreaCode'))===norm(plans[0].code),
      'Physical split source Block is not assigned to the expected newly prepared test MA.');
    await proveSplitUi(page,selected);
    if(opts.stage==='setup-mas') {
      console.log(JSON.stringify({stage:'setup-mas',createdOrReused:before.createdMas,
        screenshotDirectory:dir,journalPath,next:'Run --stage run to continue with manual area edit and physical split'},null,2));
      return;
    }
    const manualUiSaved=await applyManualAreaFromUi(page,selected,scenario,enteredHa,field(sourceArea,'manualAreaHectares'));
    before.steps.push(manualUiSaved?'manual-entry-ui-saved':'existing-manual-value-verified-in-ui');await saveJournal();
    await capture(page,dir,'02-entered-business-hectares');
    const manual=await api.area('blocks',blockId,scenario.manualEntryDate);
    assert(haUnits(field(manual,'manualAreaHectares'),'saved manual hectares')===enteredUnits,
      'Manual hectares did not persist after saving via the frontend.');
    assert(haUnits(field(manual,'effectiveAreaHectares'),'saved effective hectares')===enteredUnits,
      'Effective business hectares did not use manual entry.');
    assert(Math.abs(Number(field(manual,'spatialAreaHectares'))-Number(baselineSpatial))<0.00005,
      'Saving the manual area unexpectedly modified GIS hectares.');
    const postManual=await api.block(blockId,scenario.manualEntryDate);
    assert(haUnits(field(postManual,'blockArea'),'BlockArea')===enteredUnits,'Block business hectares ignored the manual entry.');
    before.sourceBaseline=postManual;
    before.steps.push('manual-persisted-and-gis-unchanged');await saveJournal();
    const action=await proveSplitUi(page,selected);
    if(action.type==='button')await action.action.click();
    else { await action.action.click();
      await page.getByRole('menuitem',{name:'Split Block',exact:true}).click(); }
    const modal=page.locator("[data-guide='schedule-change-modal']");
    await modal.waitFor({state:'visible',timeout:15000});
    const splitDate=modal.locator("input[type='date']");
    await splitDate.fill(scenario.splitDate);
    await modal.getByRole('button',{name:'Draw split',exact:true}).click();
    await page.locator("[data-guide='workbench-map']").waitFor({state:'visible',timeout:15000});
    await drawCutThroughUi(page,selected,scenario);
    await capture(page,dir,'03-cut-line-completed');
    const preview=await readSplitPreview(page);
    before.previewGisAreas=preview;before.steps.push('two-part-frontend-preview');await saveJournal();
    await capture(page,dir,'04-two-part-preview');
    // Durable intent BEFORE clicking: any timeout, navigation, or post-save render error
    // must not trigger a second split on a later invocation.
    before.confirmRequested=true;before.steps.push('split-confirm-click-requested');await saveJournal();
    await page.locator("[data-guide='block-split-pending-confirm']").click();
    await capture(page,dir,'05-split-confirmed-ui');
    let result;
    for(let i=0;i<12;i++){
      try {result=await readSaved(api,discovery,selected,scenario,before.sourceBaseline,preview);break;}
      catch(error) {if(i===11)throw error;await sleep(2500);}
    }
    before.steps.push('readback-conservation-verified');before.result=result;await saveJournal();
    const children=await Promise.all(result.children.map(id=>api.block(id,scenario.splitDate)));
    await assertSavedChildrenInWorkbench(page,children,field(selected.block,'orchardBlockCode'));
    before.steps.push('frontend-allocation-children-verified');before.completed=true;
    await saveJournal();
    await capture(page,dir,'06-post-split-workbench');
    console.log(JSON.stringify({stage:'run',frontendSplitCommitted:true,enteredHectares:enteredHa,result,
      screenshotDirectory:dir,journalPath},null,2));
  } catch(error) {
    await capture(page,dir,'failure');
    throw error;
  } finally {
    await session.context.close().catch(()=>{});
    await session.browser.close().catch(()=>{});
  }
}

main().catch(error=>{console.error(`Blackburn 5255 frontend regression failed: ${error.message}`);process.exitCode=1;});

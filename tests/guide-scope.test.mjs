import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGuideScope, isWorkbenchCaptureUrl } from '../src/lib/guide-scope.mjs';

const config = {
  baseUrl: 'https://kinex.test:7004',
  map: {workbenchPath:'/arcgis/orchard-workbench'},
  coverage: {scope: {season:'2027',crop:'KIWIFRUIT',country:'NZ'}}
};

test('safe full capture defaults to the 2027 NZ Kiwifruit scope', () => {
  assert.deepEqual(resolveGuideScope({},config), {season:'2027',crop:'KIWIFRUIT',country:'NZ'});
});
test('CLI overrides the capture season and can explicitly disable automatic scope', () => {
  assert.equal(resolveGuideScope({season:'2028'},config).season,'2028');
  assert.equal(resolveGuideScope({noGuideScope:true},config),null);
  assert.throws(()=>resolveGuideScope({season:'tomorrow'},config),/--season YYYY/);
  assert.throws(()=>resolveGuideScope({crop:'<script>'},config),/valid --crop/);
});
test('scope is only changed at the configured Workbench route', () => {
  assert.equal(isWorkbenchCaptureUrl('https://kinex.test:7004/arcgis/orchard-workbench',config),true);
  assert.equal(isWorkbenchCaptureUrl('https://kinex.test:7004/arcgis/orchard-workbench?orchardId=abc',config),true);
  assert.equal(isWorkbenchCaptureUrl('https://kinex.test:7004/admin',config),false);
  assert.equal(isWorkbenchCaptureUrl('https://example.com/arcgis/orchard-workbench',config),false);
  assert.equal(isWorkbenchCaptureUrl('data:text/html,hi',config),false);
});
test('full profile gating retains destructive MA/hectare fixtures as excluded',async()=>{
  const { flowExclusionReason }=await import('../src/lib/profiles.mjs');
  for(const path of [
    new URL('../flows/295-block-hectares-e2e-fixture.json', import.meta.url),
    new URL('../flows/335-mutation-create-maturity-area.json', import.meta.url)
  ]) {
    const flow=JSON.parse(await (await import('node:fs/promises')).readFile(path,'utf8'));
    assert.ok(flowExclusionReason(flow,'full',{mutations:{enabled:false}}),`must exclude ${flow.id}`);
  }
});
test('Regions guide skips when configured operational layer option does not exist',async()=>{
  const {readFile}=await import('node:fs/promises');
  const flow=JSON.parse(await readFile(new URL('../flows/074-layer-visibility.json',import.meta.url)));
  const requirement=flow.steps[0].actions.find(a=>a.locator?.selector==="[data-guide='map-layer-option-regions']");
  assert.equal(requirement?.type,'require');
  assert.match(requirement?.message??'',/not configured/);
});

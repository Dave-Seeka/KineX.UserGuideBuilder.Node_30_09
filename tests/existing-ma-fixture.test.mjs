import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFlow } from '../src/lib/flow-loader.mjs';
import { validateExistingMaFixture, exactSupplierOptions, selectedOption, existingMaJournalPath } from '../src/lib/existing-ma-fixture.mjs';

const approved = {
  baseUrl:'https://kinex.test:7004',
  mutations:{enabled:true,confirmation:'ALLOW KINEX GUIDE MUTATIONS',requiredConfirmation:'ALLOW KINEX GUIDE MUTATIONS'},
  maFixture:{ enabled:true,allowExistingTestOrchard:true,orchardPin:'5255',orchardName:'Blackburn',
    orchardId:'01a19e20-03c6-77a9-8603-ad85a1460eac',blockCode:'BLK-0002',maCode:'UG5255A2027',
    effectiveDate:'2027-06-01',supplierName:'Test Entity',supplierCode:'ENT-0001',fifthCharacter:'Z'}
};
test('MA fixture requires affirmative authorization, exact identities and test host',()=>{
  assert.equal(validateExistingMaFixture(approved).orchardPin,'5255');
  assert.throws(()=>validateExistingMaFixture({...approved,baseUrl:'https://kinex.seeka.co.nz'}),/test KineX WEB host/);
  assert.throws(()=>validateExistingMaFixture({...approved,mutations:{...approved.mutations,confirmation:''}}),/mutation confirmation/);
  assert.throws(()=>validateExistingMaFixture({...approved,maFixture:{...approved.maFixture,supplierName:''}}),/supplierName/);
  assert.throws(()=>validateExistingMaFixture({...approved,maFixture:{...approved.maFixture,allowExistingTestOrchard:false}}),/allowExistingTestOrchard/);
  assert.throws(()=>validateExistingMaFixture({...approved,maFixture:{...approved.maFixture,effectiveDate:'2027-02-30'}}),/not a real date/);
});
test('supplier picker requires exact name AND code; truck picker never guesses among options',()=>{
  const options=[{name:'Test Entity',code:'ENT-0001'},{name:'Test Entity',code:'ENT-0002'}];
  assert.deepEqual(exactSupplierOptions(options,'Test Entity','ENT-0002'),[options[1]]);
  assert.equal(exactSupplierOptions(options,'Test Entity','ENT-8888').length,0);
  assert.throws(()=>selectedOption([{value:'1',label:'One'},{value:'2',label:'Two'}],null,'Truck access'),/expected one/);
  assert.equal(selectedOption([{value:'1',label:'ACCESS-X'},{value:'2',label:'ACCESS-Y'}],'ACCESS-Y','Truck access'),'2');
});
test('standalone MA workflow is mutation-gated and never runs under the full profile',async()=>{
  const {flow}=await loadFlow(new URL('../flows/336-mutation-create-ma-existing-orchard.json',import.meta.url).pathname);
  assert.equal(flow.standalone,true);
  assert.equal(flow.mutation,true);
  assert.equal(flow.profiles.includes('full'),false);
  const sequence=flow.steps.flatMap(step=>step.actions).map(action=>action.type);
  assert.deepEqual(sequence.filter(type=>type.endsWith('ExistingMaFixture')||type.includes('MaFixture')),
    ['selectExistingMaFixtureOrchard','ensureExistingMaFixtureSupplier','fillExistingMaFixtureDetails','selectExistingMaFixtureBlock','submitExistingMaFixture']);
});

test('closed browser can retry safe captures but cannot retry an MA mutation',async()=>{
  const {mayRetryGuideAfterFailure}=await import('../src/lib/profiles.mjs');
  assert.equal(mayRetryGuideAfterFailure({mutation:false},true),true);
  assert.equal(mayRetryGuideAfterFailure({mutation:true},true),false);
  assert.equal(mayRetryGuideAfterFailure({mutation:true},false),false);
});

test('mutation journals survive safe capture-all output deletion',()=>{
  const filename=existingMaJournalPath({outputDir:'/tmp/output',authState:'/tmp/.auth/storage-state.json'},{orchardPin:'5255',maCode:'UG5255A2027'});
  assert.equal(filename,'/tmp/.auth/ma-fixture-journals/5255-UG5255A2027/journal.json');
  assert.equal(filename.startsWith('/tmp/output'),false);
});

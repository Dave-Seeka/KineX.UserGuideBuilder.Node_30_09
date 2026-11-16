import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { assertReadback, haUnits, isActiveLeafBlock, validateScenario } from '../src/lib/block-hectares-frontend-assertions.mjs';
import { createHectareReadApi, discoverBlackburn } from '../src/lib/block-hectares-frontend-api.mjs';
const ID='01990000-0000-7000-8000-000000000001';
const BLOCK='01990000-0000-7000-8000-000000000002';
const CHILD1='01990000-0000-7000-8000-000000000003';
const CHILD2='01990000-0000-7000-8000-000000000004';
const MA='01990000-0000-7000-8000-000000000005';
const CROP='01990000-0000-7000-8000-000000000006';
const SEASON='01990000-0000-7000-8000-000000000007';
const PROPERTY='01990000-0000-7000-8000-000000000008';
const COUNTRY='01990000-0000-7000-8000-000000000009';
const scenario=JSON.parse(await fs.readFile(new URL('../scenarios/block-hectares-frontend-blackburn-5255.json', import.meta.url)));
test('Blackburn 5255 fixture validates without invented IDs',()=>{
  assert.equal(validateScenario(scenario).orchardPin,'5255');
  assert.equal(scenario.sourceBlockCode,null);
  assert.equal(haUnits('0.0001'),1n);
  assert.equal(haUnits('10'),100000n);
});
test('rejects a different Orchard, crop or out-of-season split',()=>{
  assert.throws(()=>validateScenario({...scenario,orchardPin:'3025'}),/Blackburn/);
  assert.throws(()=>validateScenario({...scenario,cropCode:'AVOCADO'}),/scope/);
  assert.throws(()=>validateScenario({...scenario,splitDate:'2027-05-01'}),/Manual entry/);
});
test('child hectares conserve entered business hectares not measured GIS total',()=>{
  const parent={orchardBlockId:BLOCK,orchardId:ID,blockArea:'10.0000'};
  const c1={orchardBlockId:CHILD1,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'2.5000',orchardBlockCode:'B1A'};
  const c2={orchardBlockId:CHILD2,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'7.5000',orchardBlockCode:'B1B'};
  const r=assertReadback({orchardId:ID,parent,children:[c1,c2],splitDate:'2027-06-03',expectedHectares:'10.0000',previewAreas:[3,9]});
  assert.equal(r.childrenBusinessHa.join('/'),'2.5000/7.5000');
  assert.throws(()=>assertReadback({orchardId:ID,parent,children:[{...c1,blockArea:'3.0000'},{...c2,blockArea:'9.0000'}],splitDate:'2027-06-03',expectedHectares:'10.0000',previewAreas:[3,9]}),/OMD-1638 failed/);
});
test('rejects invalid source lineage, wrong parent and changed control hectares',()=>{
  const parent={orchardBlockId:BLOCK,orchardId:ID,blockArea:'1.0000'};
  const first={orchardBlockId:CHILD1,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'0.5000'};
  const second={orchardBlockId:CHILD2,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'0.5000'};
  assert.throws(()=>assertReadback({orchardId:ID,parent,children:[first,{...second,parentOrchardBlockId:ID}],splitDate:'2027-06-03',expectedHectares:'1.0000',previewAreas:[1,1]}),/incorrect parent/);
  assert.throws(()=>assertReadback({orchardId:ID,parent,children:[first,second],splitDate:'2027-06-03',expectedHectares:'1.0000',previewAreas:[1,1],controlsBefore:[{orchardBlockId:MA,blockArea:'5.0000'}],controlsAfter:[{orchardBlockId:MA,blockArea:'4.0000'}]}),/Unmodified control/);
});
test('API issues only authenticated GET on allowed scoped routes',async()=>{
  const seen=[];
  const api=createHectareReadApi('https://localhost:7002/',{apiKey:'not-a-real-key',insecureLoopback:false,transport:async(url,opts)=>{
    seen.push({url:String(url),opts});return {ok:true,text:async()=>JSON.stringify({items:[],totalCount:0})};
  }});
  const result=await api.blocks(ID,'2027-06-01');
  assert.deepEqual(result,[]);
  assert(seen.every(x=>x.opts.method==='GET' && x.opts.redirect==='error' && x.opts.headers['X-KineX-Api-Key']));
  await assert.rejects(api.get('https://evil.test/v1/orchard/blocks'),/Read API refused/);
  assert.throws(()=>createHectareReadApi('https://production.example.com/',{apiKey:'no'}),/test API/);
});
test('discovery confirms Orchard PIN, crop, country, season and MA assignments',async()=>{
  const items=(items)=>({items,totalCount:items.length});
  const route={
    '/v1/masterdata/crops':items([{cropId:CROP,cropCode:'KIWIFRUIT'}]),
    '/v1/masterdata/seasons':items([{seasonId:SEASON,seasonCode:'2027'}]),
    '/v1/masterdata/season-definitions':items([{cropId:CROP,seasonId:SEASON,countryId:COUNTRY,countryCode:'NZ',startDate:'2027-01-01',endDate:'2027-12-31'}]),
    '/v1/orchard/orchards':items([{orchardId:ID,orchardName:'Blackburn Orchard',orchardPin:'5255',cropId:CROP,orchardPropertyId:PROPERTY}]),
    [`/v1/orchard/properties/${PROPERTY}`]:{countryId:COUNTRY},
    '/v1/orchard/blocks':items([
      {orchardId:ID,orchardBlockId:BLOCK,orchardBlockCode:'B-1',parentOrchardBlockId:null,assignedMaturityAreaId:MA,blockArea:10},
      {orchardId:ID,orchardBlockId:B2,orchardBlockCode:'B-2',parentOrchardBlockId:CHILD1,assignedMaturityAreaId:MA,blockArea:1}
    ]),
    '/v1/orchard/maturity-areas':items([{orchardId:ID,maturityAreaId:MA,maturityAreaCode:'MA-1',isActive:true}])
  };
  const api=createHectareReadApi('https://localhost:7002/',{apiKey:'test',transport:async(url)=>{
    const body=route[new URL(url).pathname];return {ok:body!==undefined,status:body?200:404,text:async()=>JSON.stringify(body)};
  }});
  const found=await discoverBlackburn(api,scenario);
  assert.equal(found.candidates.length,2);
  assert.deepEqual(found.candidates.map(x=>x.code),['B-1','B-2']);
  assert.equal(found.orchardId,ID);
});

test('unchanged control Block with no entered hectares remains null',()=>{
  const parent={orchardBlockId:BLOCK,orchardId:ID,blockArea:'1.0000'};
  const c1={orchardBlockId:CHILD1,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'0.5000'};
  const c2={orchardBlockId:CHILD2,orchardId:ID,parentOrchardBlockId:BLOCK,effectiveFromDate:'2027-06-03',blockArea:'0.5000'};
  assertReadback({orchardId:ID,parent,children:[c1,c2],splitDate:'2027-06-03',expectedHectares:'1.0000',previewAreas:[1,1],
    controlsBefore:[{orchardBlockId:MA,blockArea:null}],controlsAfter:[{orchardBlockId:MA,blockArea:null}]});
});

const B2='01990000-0000-7000-8000-000000000010';
const MA2='01990000-0000-7000-8000-000000000011';
function maFixture({secondAssigned=false,sourceAssigned=false}={}) {
  const blocks=[
    {orchardId:ID,orchardBlockId:BLOCK,orchardBlockCode:'B-1',parentOrchardBlockId:null,
      assignedMaturityAreaId:sourceAssigned ? MA : null,maturityAreaAssignments:[]},
    {orchardId:ID,orchardBlockId:B2,orchardBlockCode:'B-2',parentOrchardBlockId:null,
      assignedMaturityAreaId:secondAssigned ? MA2 : null,maturityAreaAssignments:[]}
  ];
  const activeMas=[
    ...(sourceAssigned ? [{orchardId:ID,maturityAreaId:MA,maturityAreaCode:'BH5255A2027',isActive:true}] : []),
    ...(secondAssigned ? [{orchardId:ID,maturityAreaId:MA2,maturityAreaCode:'BH5255B2027',isActive:true}] : [])
  ];
  return {orchardId:ID,blocks,activeMas};
}
const maScenario={...scenario,sourceBlockCode:'B-1'};
test('two MA setup stages select distinct existing Blackburn Blocks and create missing MAs',async()=>{
  const {planMaturityAreaSetup}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const plan=planMaturityAreaSetup(maFixture(),maScenario);
  assert.deepEqual(plan.map(x=>[x.code,x.blockCode,x.action]),
    [['BH5255A2027','B-1','create'],['BH5255B2027','B-2','create']]);
});
test('idempotent MA plan verifies exact saved memberships and reuses both existing test MAs',async()=>{
  const {planMaturityAreaSetup,checkPersistedMa}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const fixture=maFixture({sourceAssigned:true,secondAssigned:true});
  const plan=planMaturityAreaSetup(fixture,maScenario);
  assert.deepEqual(plan.map(x=>x.action),['reuse','reuse']);
  assert.equal(checkPersistedMa(fixture,plan[0]).maId,MA);
  assert.equal(checkPersistedMa(fixture,plan[1]).maId,MA2);
});
test('MA setup rejects a source Block assigned to somebody else',async()=>{
  const {planMaturityAreaSetup}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const fixture=maFixture();fixture.blocks[0].assignedMaturityAreaId=MA;
  assert.throws(()=>planMaturityAreaSetup(fixture,maScenario),/unassigned test Block/);
});
test('MA setup refuses unrelated existing MA code rather than reusing it',async()=>{
  const {planMaturityAreaSetup}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const fixture=maFixture();fixture.activeMas.push({orchardId:ID,maturityAreaId:MA,maturityAreaCode:'BH5255A2027',isActive:true});
  assert.throws(()=>planMaturityAreaSetup(fixture,maScenario),/not assigned to Block/);
});
test('MA scenario validates two unique alphanumeric codes',()=>{
  assert.throws(()=>validateScenario({...maScenario,maSetup:{...scenario.maSetup,
    areas:[{code:'A',blockCode:null},{code:'A',blockCode:null}]}}),/alphanumeric/);
  assert.throws(()=>validateScenario({...maScenario,maSetup:{...scenario.maSetup,
    areas:[{code:'XYZ',blockCode:null},{code:'XYZ',blockCode:null}]}}),/different/);
});

test('an active split child without current children is a valid nested split source',async()=>{
  const {planMaturityAreaSetup}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const fixture=maFixture();
  fixture.blocks[0].parentOrchardBlockId=CHILD1; // historical parent need not be active
  fixture.blocks[1].parentOrchardBlockId=CHILD1;
  assert.equal(isActiveLeafBlock(fixture.blocks[0],fixture.blocks),true);
  const plan=planMaturityAreaSetup(fixture,maScenario);
  assert.deepEqual(plan.map(item=>item.blockCode),['B-1','B-2']);
});

test('a source with active children is not a leaf and cannot be scheduled again',async()=>{
  const {planMaturityAreaSetup}=await import('../src/lib/block-hectares-frontend-ma-setup.mjs');
  const fixture=maFixture();
  fixture.blocks[1].parentOrchardBlockId=BLOCK;
  assert.equal(isActiveLeafBlock(fixture.blocks[0],fixture.blocks),false);
  assert.equal(isActiveLeafBlock(fixture.blocks[1],fixture.blocks),true);
  assert.throws(()=>planMaturityAreaSetup(fixture,maScenario),/Expected one Blackburn Block B-1, found 0/);
});

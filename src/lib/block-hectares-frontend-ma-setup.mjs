/** Blackburn PIN 5255 MA setup planning; all writes are through the Workbench browser UI. */
import { assert, assertUuid, field, isActiveLeafBlock } from './block-hectares-frontend-assertions.mjs';

const same = (a, b) => String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
const codeOf = block => field(block, 'orchardBlockCode');
const idOf = block => field(block, 'orchardBlockId');

export function planMaturityAreaSetup(discovery, scenario) {
  const setup = scenario.maSetup;
  assert(setup?.mode === 'create-or-reuse' && setup.areas?.length === 2,
    'The Blackburn full E2E scenario must define exactly two create-or-reuse test Maturity Areas.');
  assert(scenario.sourceBlockCode, 'Pin sourceBlockCode to the mapped Blackburn Block before running MA creation or splitting.');
  const blocks = discovery.blocks;
  const used = new Set();
  const codes = new Set();
  const ordered = [];
  for (let index = 0; index < setup.areas.length; index++) {
    const entry = setup.areas[index];
    assert(/^[A-Za-z0-9]{2,32}$/.test(entry.code ?? ''),
      `Test Maturity Area ${index + 1} needs a unique, alphanumeric code (2-32 characters).`);
    assert(!codes.has(entry.code.toLowerCase()), 'Test Maturity Area codes must be unique.');
    codes.add(entry.code.toLowerCase());
    const matchingMa = discovery.activeMas.find(ma => same(field(ma,'maturityAreaCode'),entry.code));
    const assignedToExisting = matchingMa ? blocks.filter(block =>
      [field(block,'assignedMaturityAreaId'),...((field(block,'maturityAreaAssignments')??[]).map(x=>field(x,'maturityAreaId')))]
        .some(id=>same(id,field(matchingMa,'maturityAreaId')))) : [];
    const explicit = entry.blockCode ?? (index === 0 ? scenario.sourceBlockCode :
      assignedToExisting.length===1 ? codeOf(assignedToExisting[0]) : null);
    const available = blocks.filter(block => !used.has(String(idOf(block)).toLowerCase())
      && isActiveLeafBlock(block, blocks)
      && (explicit ? same(codeOf(block), explicit) : true));
    const candidates = available.filter(block => {
      const currentIds = [field(block,'assignedMaturityAreaId'),
        ...((field(block,'maturityAreaAssignments') ?? []).map(x => field(x,'maturityAreaId')))].filter(Boolean);
      if (!currentIds.length) return true;
      return discovery.activeMas.some(ma => same(field(ma,'maturityAreaCode'), entry.code)
        && currentIds.some(id => same(id, field(ma,'maturityAreaId'))));
    });
    if (explicit) assert(available.length === 1,
      `Expected one Blackburn Block ${explicit}, found ${available.length}.`);
    const block = candidates.sort((a,b) => String(codeOf(a)).localeCompare(String(codeOf(b))))[0];
    assert(block, `No eligible unassigned test Block is available for MA ${entry.code}. Choose a different Block or inspect its existing assignment.`);
    assertUuid(idOf(block), `MA ${entry.code} source Block`);
    const currentIds = [field(block,'assignedMaturityAreaId'),
      ...((field(block,'maturityAreaAssignments') ?? []).map(x => field(x,'maturityAreaId')))].filter(Boolean);
    const duplicateCodes = (discovery.allMas??discovery.activeMas).filter(ma => same(field(ma,'maturityAreaCode'), entry.code));
    assert(duplicateCodes.every(ma=>field(ma,'isActive')===true),`MA code ${entry.code} is already used by an inactive MA; refusing to duplicate it.`);
    const existing = discovery.activeMas.filter(ma => same(field(ma,'maturityAreaCode'), entry.code));
    assert(existing.length < 2, `Multiple active MAs use code ${entry.code}; ambiguous ownership.`);
    if (existing.length) {
      assert(currentIds.some(id => same(id,field(existing[0],'maturityAreaId'))),
        `Existing MA ${entry.code} is not assigned to Block ${codeOf(block)}. Refusing to reuse unrelated MA.`);
      assert(currentIds.every(id => same(id,field(existing[0],'maturityAreaId'))),
        `Block ${codeOf(block)} has another MA membership. Refusing to reassign.`);
    } else {
      assert(currentIds.length === 0, `Block ${codeOf(block)} is already assigned to another MA.`);
    }
    const key = String(idOf(block)).toLowerCase();
    assert(!used.has(key), 'The two test MAs must use different physical Blocks.');
    used.add(key);
    ordered.push({ code: entry.code, blockCode: codeOf(block), blockId: idOf(block),
      existingMaId: existing.length ? field(existing[0],'maturityAreaId') : null,
      action: existing.length ? 'reuse' : 'create' });
  }
  assert(same(ordered[0].blockCode,scenario.sourceBlockCode),
    'The source Block for the physical split must be the Block assigned to test MA #1.');
  return ordered;
}

export function checkPersistedMa(discovery, plan) {
  const matched = discovery.activeMas.filter(ma => same(field(ma,'maturityAreaCode'),plan.code));
  assert(matched.length === 1, `Expected exactly one saved Blackburn MA ${plan.code}, found ${matched.length}.`);
  const ma = matched[0];
  assert(same(field(ma,'orchardId'),discovery.orchardId),`MA ${plan.code} belongs to a different Orchard.`);
  const block = discovery.blocks.find(x => same(idOf(x),plan.blockId));
  assert(block,`Block ${plan.blockCode} disappeared after MA creation.`);
  const assignedIds = [field(block,'assignedMaturityAreaId'),
    ...((field(block,'maturityAreaAssignments') ?? []).map(x => field(x,'maturityAreaId')))].filter(Boolean);
  assert(assignedIds.some(x => same(x,field(ma,'maturityAreaId'))),
    `Block ${plan.blockCode} not assigned to saved MA ${plan.code}.`);
  assertUuid(field(ma,'maturityAreaId'),`saved ${plan.code} MA`);
  return {code:plan.code,blockCode:plan.blockCode,blockId:plan.blockId,maId:field(ma,'maturityAreaId')};
}

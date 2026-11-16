import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertMutationPermission,
  flowExclusionReason,
  mutationsAllowed,
  normalizeProfile
} from '../src/lib/profiles.mjs';

const disabled = {
  mutations: {
    enabled: false,
    confirmation: '',
    requiredConfirmation: 'ALLOW KINEX GUIDE MUTATIONS'
  }
};

const enabled = {
  mutations: {
    enabled: true,
    confirmation: 'ALLOW KINEX GUIDE MUTATIONS',
    requiredConfirmation: 'ALLOW KINEX GUIDE MUTATIONS'
  }
};

test('normalizeProfile accepts supported profiles and rejects unknown values', () => {
  assert.equal(normalizeProfile(' FULL '), 'full');
  assert.equal(normalizeProfile('laptop'), 'laptop');
  assert.equal(normalizeProfile('laptop-mutation'), 'laptop-mutation');
  assert.throws(() => normalizeProfile('nightly'), /Unsupported flow profile/);
});

test('mutation permission requires both enabled and exact confirmation', () => {
  assert.equal(mutationsAllowed(disabled), false);
  assert.equal(mutationsAllowed(enabled), true);
  assert.throws(() => assertMutationPermission(disabled, 'mutation'), /ALLOW KINEX GUIDE MUTATIONS/);
  assert.doesNotThrow(() => assertMutationPermission(enabled, 'mutation'));
  assert.throws(() => assertMutationPermission(disabled, 'laptop-mutation'), /ALLOW KINEX GUIDE MUTATIONS/);
  assert.doesNotThrow(() => assertMutationPermission(enabled, 'laptop-mutation'));
  assert.doesNotThrow(() => assertMutationPermission(disabled, 'laptop'));
});

test('flow profile filtering keeps safe and mutation definitions separate', () => {
  const safeFlow = { profiles: ['core', 'full'], mutation: false };
  const mutationFlow = { profiles: ['mutation'], mutation: true };
  assert.equal(flowExclusionReason(safeFlow, 'full', disabled), null);
  assert.match(flowExclusionReason(safeFlow, 'smoke', disabled), /Not included/);
  assert.match(flowExclusionReason(mutationFlow, 'mutation', disabled), /Mutation flow disabled/);
  assert.equal(flowExclusionReason(mutationFlow, 'mutation', enabled), null);
  assert.equal(flowExclusionReason(safeFlow, 'laptop', disabled), null);
  assert.match(flowExclusionReason(mutationFlow, 'laptop', disabled), /Not included/);
  assert.equal(flowExclusionReason(mutationFlow, 'laptop-mutation', enabled), null);
});

export function normalizeProfile(value) {
  const profile = String(value ?? 'full').trim().toLowerCase();
  const supported = new Set(['smoke', 'core', 'full', 'mutation', 'laptop', 'laptop-mutation', 'all']);
  if (!supported.has(profile)) {
    throw new Error(`Unsupported flow profile '${value}'. Use smoke, core, full, mutation, laptop, laptop-mutation, or all.`);
  }
  return profile;
}

export function flowExclusionReason(flow, profile, config) {
  if (flow.standalone === true) return 'Standalone mutation; invoke its explicit capture command, never capture-all.';
  const normalizedProfile = normalizeProfile(profile);
  const coverageProfile = coverageProfileFor(normalizedProfile);
  const profiles = Array.isArray(flow.profiles) && flow.profiles.length > 0
    ? flow.profiles.map((item) => String(item).toLowerCase())
    : ['full'];

  if (coverageProfile !== 'all' && !profiles.includes(coverageProfile)) {
    return `Not included in the '${normalizedProfile}' capture profile.`;
  }

  if (flow.mutation === true && !mutationsAllowed(config)) {
    return 'Mutation flow disabled. Enable config.mutations and provide the required confirmation phrase.';
  }

  return null;
}

export function assertMutationPermission(config, profile = 'mutation') {
  if (!['mutation', 'laptop-mutation', 'all'].includes(profile)) return;
  if (!mutationsAllowed(config)) {
    const required = config.mutations?.requiredConfirmation ?? 'ALLOW KINEX GUIDE MUTATIONS';
    throw new Error(
      `The '${profile}' profile includes persistent create/save/delete actions. ` +
      `Set mutations.enabled=true and mutations.confirmation='${required}' in config.json.`
    );
  }
}

export function mutationsAllowed(config) {
  if (config.mutations?.enabled !== true) return false;
  const required = String(config.mutations?.requiredConfirmation ?? 'ALLOW KINEX GUIDE MUTATIONS');
  return String(config.mutations?.confirmation ?? '') === required;
}


export function coverageProfileFor(profile) {
  const normalized = normalizeProfile(profile);
  if (normalized === 'laptop') return 'full';
  if (normalized === 'laptop-mutation') return 'mutation';
  return normalized;
}

export function isLaptopProfile(profile) {
  const normalized = String(profile ?? '').trim().toLowerCase();
  return normalized === 'laptop' || normalized === 'laptop-mutation';
}

export function mayRetryGuideAfterFailure(flow, recoverableSessionError) {
  // Mutations may have committed before the tab closed: never automatically replay.
  return flow?.mutation !== true && recoverableSessionError === true;
}

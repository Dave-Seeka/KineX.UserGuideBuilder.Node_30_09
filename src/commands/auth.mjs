import { completePortalLogin, launchBrowser } from '../lib/browser.mjs';

export async function authenticate(config, args = {}) {
  const session = await launchBrowser(
    config,
    { ...args, headed: true },
    { forceHeaded: true, ignoreStorageState: Boolean(args.fresh) }
  );

  try {
    await completePortalLogin(session.context, config, {
      path: args.path ?? config.portalLogin.loginPath ?? config.portalLogin.probePath,
      keepPageOpenOnFailure: true
    });
  } finally {
    await session.context.close();
    await session.browser.close();
  }
}

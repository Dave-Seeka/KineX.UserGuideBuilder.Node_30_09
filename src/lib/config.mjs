import fs from 'node:fs/promises';
import path from 'node:path';

const defaultConfig = {
  baseUrl: 'https://kinex.test:7004',
  apiTargets: {
    'local-api': { baseUrl: 'https://localhost:7002' },
    'kinex-test-api': { baseUrl: 'https://kinex.test:7001' }
  },
  outputDir: './output',
  collectionsDir: './collections',
  authState: './.auth/storage-state.json',
  authSessionStorage: './.auth/session-storage.json',
  browser: 'chromium',
  headless: true,
  ignoreHTTPSErrors: true,
  continueOnFlowError: true,
  rateLimitCooldownMs: 30000,
  coverage: {
    profile: 'full',
    writeReport: true,
    scope: { season: '2027', crop: 'KIWIFRUIT', country: 'NZ' }
  },
  maFixture: { enabled:false,allowExistingTestOrchard:false },
  mutations: {
    enabled: false,
    confirmation: '',
    requiredConfirmation: 'ALLOW KINEX GUIDE MUTATIONS',
    testPrefix: 'UG'
  },
  viewport: {
    width: 1440,
    height: 900
  },
  viewports: {
    laptop: {
      width: 1366,
      height: 768
    }
  },
  viewportAudit: {
    enabled: true,
    horizontalOverflowTolerance: 2,
    overlayTolerance: 3,
    overlaySelectors: [
      "[data-guide='entity-create-drawer']",
      "[data-guide='map-basemap-menu']",
      "[data-guide='map-layers-menu']",
      "[data-guide='geometry-choice']",
      "[data-guide='geometry-task-panel']",
      "[role='dialog']"
    ]
  },
  defaultTimeoutMs: 20000,
  navigationTimeoutMs: 45000,
  portalLogin: {
    enabled: true,
    autoLoginOnCapture: true,
    loginPath: '/arcgis/orchard-workbench',
    probePath: '/arcgis/orchard-workbench',
    authenticatedSelector: "[data-guide='orchard-workbench']",
    authenticatedUrlPattern: '^https://kinex\\.test:7004/arcgis/orchard-workbench(?:[/?#]|$)',
    probeTimeoutMs: 8000,
    probeMapTimeoutMs: 30000,
    loginTimeoutMs: 300000,
    postLoginSettleMs: 1500,
    relaunchHeadlessAfterLogin: true,
    email: '',
    emailEnvironmentVariable: 'KINEX_GUIDE_PORTAL_EMAIL'
  },
  maskSelectors: ['[data-sensitive]', "input[type='password']"],
  map: {
    autoWaitOnWorkbenchNavigation: true,
    workbenchPath: '/arcgis/orchard-workbench',
    timeoutMs: 120000,
    settleMs: 8000,
    pollIntervalMs: 250,
    readySelector: "[data-guide='map-tool-home']",
    surfaceSelector: '.arcgis-map-view-container .esri-view-surface',
    canvasSelector: '.arcgis-map-view-container .esri-view-surface canvas',
    errorSelector: '.arcgis-map-view-error',
    requireCanvas: true,
    minimumWidth: 320,
    minimumHeight: 200
  },
  screenshot: {
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    maskColor: '#6b7280',
    blank: true,
    blankSuffix: '-blank'
  },
  printGuide: {
    enabled: true,
    fileBaseName: 'guide-print',
    imageVariant: 'annotated',
    includeContents: false,
    includeCoverageNotes: false,
    includePrerequisites: true,
    includeSafety: false
  },
  toast: {
    timeoutMs: 10000,
    dismissTimeoutMs: 10000,
    selectors: [
      "[data-guide='toast']",
      "[data-guide*='toast']",
      '.ui-toast',
      '.e-toast',
      '.e-toast-container .e-toast',
      "[role='alert'][class*='toast']",
      "[role='status'][class*='toast']",
      "[role='alert']",
      "[role='status']"
    ]
  },
  highlight: {
    color: '#d92d20',
    padding: 6,
    lineWidth: 4,
    labelBackground: '#d92d20',
    labelColor: '#ffffff'
  },
  guideData: {
    propertyCode: 'GUIDE-PROPERTY',
    orchardPin: 'GUIDE-ORCHARD',
    orchardName: 'Guide Orchard',
    blockCode: 'GUIDE-BLOCK',
    blockName: 'Guide Block',
    addressSearch: '10 Te Puke Highway, Te Puke',
    manualAddressLine1: '1 Guide Road',
    manualAddressLine2: '',
    manualSuburb: 'Te Puke',
    manualCity: 'Te Puke',
    manualRegion: 'Bay of Plenty',
    manualPostalCode: '3119',
    accessInstructions: 'Use the main entrance and follow site signage.',
    blockHectaresPropertyGlobalId: '98a721c9-d82a-4b2c-affa-ba9cf8cf075c',
    blockHectaresOrchardPin: '1285',
    blockHectaresOrchardId: '31239',
    blockHectaresOrchardKey: 'ORCHARD:31239|CROP:KIWIFRUIT',
    blockHectaresCropCode: 'KIWIFRUIT',
    blockHectaresSeasonEffectiveDate: '2026-07-01',
    blockHectaresTestBlockCode: '3',
    blockHectaresTestPhysicalAreaId: '317466',
    blockHectaresTestGisGlobalId: '032826d5-7326-473b-8e1b-16720c1925ba',
    blockHectaresTestBusinessArea: '3.0000',
    blockHectaresTestGisAreaApprox: '3.3715',
    blockHectaresControlBlockCodes: '1,2,4'
  }
};

export async function loadConfig(configPath) {
  const absolutePath = path.resolve(configPath);
  let userConfig;

  try {
    userConfig = JSON.parse(await fs.readFile(absolutePath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(
        `Configuration file not found: ${absolutePath}. ` +
        `Copy config.example.json to config.json first.`
      );
    }
    throw error;
  }

  // Backward-compatible aliases from the original example configuration.
  const normalizedUserConfig = { ...userConfig };
  if (normalizedUserConfig.outputDir === undefined && userConfig.outputDirectory !== undefined) {
    normalizedUserConfig.outputDir = userConfig.outputDirectory;
  }
  if (normalizedUserConfig.authState === undefined && userConfig.authStatePath !== undefined) {
    normalizedUserConfig.authState = userConfig.authStatePath;
  }
  if (
    normalizedUserConfig.authSessionStorage === undefined &&
    userConfig.authSessionStoragePath !== undefined
  ) {
    normalizedUserConfig.authSessionStorage = userConfig.authSessionStoragePath;
  }

  const baseDirectory = path.dirname(absolutePath);
  const config = {
    ...defaultConfig,
    ...normalizedUserConfig,
    apiTargets: {
      ...defaultConfig.apiTargets,
      ...(normalizedUserConfig.apiTargets ?? {})
    },
    viewport: {
      ...defaultConfig.viewport,
      ...(normalizedUserConfig.viewport ?? {})
    },
    viewports: {
      ...defaultConfig.viewports,
      ...(normalizedUserConfig.viewports ?? {}),
      laptop: {
        ...defaultConfig.viewports.laptop,
        ...(normalizedUserConfig.viewports?.laptop ?? {})
      }
    },
    viewportAudit: {
      ...defaultConfig.viewportAudit,
      ...(normalizedUserConfig.viewportAudit ?? {}),
      overlaySelectors: normalizedUserConfig.viewportAudit?.overlaySelectors
        ?? defaultConfig.viewportAudit.overlaySelectors
    },
    map: {
      ...defaultConfig.map,
      ...(normalizedUserConfig.map ?? {})
    },
    screenshot: {
      ...defaultConfig.screenshot,
      ...(normalizedUserConfig.screenshot ?? {})
    },
    printGuide: {
      ...defaultConfig.printGuide,
      ...(normalizedUserConfig.printGuide ?? {})
    },
    coverage: {
      ...defaultConfig.coverage,
      ...(normalizedUserConfig.coverage ?? {})
    },
    mutations: {
      ...defaultConfig.mutations,
      ...(normalizedUserConfig.mutations ?? {})
    },
    toast: {
      ...defaultConfig.toast,
      ...(normalizedUserConfig.toast ?? {}),
      selectors: normalizedUserConfig.toast?.selectors ?? defaultConfig.toast.selectors
    },
    highlight: {
      ...defaultConfig.highlight,
      ...(normalizedUserConfig.highlight ?? {})
    },
    portalLogin: {
      ...defaultConfig.portalLogin,
      ...(normalizedUserConfig.portalLogin ?? {})
    },
    guideData: {
      ...defaultConfig.guideData,
      ...(normalizedUserConfig.guideData ?? {})
    }
  };

  config.outputDir = path.resolve(baseDirectory, config.outputDir);
  config.collectionsDir = path.resolve(baseDirectory, config.collectionsDir);
  config.authState = path.resolve(baseDirectory, config.authState);
  config.authSessionStorage = path.resolve(
    baseDirectory,
    config.authSessionStorage
  );
  return config;
}

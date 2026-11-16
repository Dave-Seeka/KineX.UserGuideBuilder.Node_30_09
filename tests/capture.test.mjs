import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildBlankFileName, captureScreenshot, includeBusinessFormViewAction, includeWorkbenchDragControls } from '../src/lib/capture.mjs';
import { addHighlightBoxes } from '../src/lib/highlights.mjs';

test('buildBlankFileName inserts the suffix before the extension', () => {
  assert.equal(buildBlankFileName('01-open.png'), '01-open-blank.png');
  assert.equal(buildBlankFileName('nested/review.webp', '-clean'), 'nested/review-clean.webp');
  assert.equal(buildBlankFileName('review'), 'review-blank.png');
});

test('captureScreenshot writes annotated and blank images by default', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'kinex-capture-'));
  const screenshots = [];
  const page = {
    locator() { return {}; },
    async evaluate() {},
    async screenshot(options) {
      screenshots.push(options.path);
      await fs.writeFile(options.path, path.basename(options.path));
    }
  };
  const config = {
    defaultTimeoutMs: 20000,
    maskSelectors: [],
    screenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maskColor: '#6b7280',
      blank: true,
      blankSuffix: '-blank'
    },
    highlight: {}
  };

  const result = await captureScreenshot(page, {
    file: 'step.png',
    highlights: []
  }, config, root);

  assert.equal(result.image, 'step.png');
  assert.equal(result.blankImage, 'step-blank.png');
  assert.deepEqual(screenshots.map((item) => path.basename(item)), ['step.png', 'step-blank.png']);
});


test('includeBusinessFormViewAction adds the visible Business Form view control to every capture', async () => {
  const button = {
    async isVisible() { return true; },
    async getAttribute(name) {
      return name === 'aria-label' ? 'Close full screen' : null;
    }
  };
  const page = {
    locator(selector) {
      assert.equal(selector, "[data-guide='business-form-full-screen']");
      return { first() { return button; } };
    }
  };

  const highlights = await includeBusinessFormViewAction(page, [
    { locator: { selector: "[data-guide='business-form-content']" }, label: 'Details', number: 2 }
  ]);

  assert.equal(highlights.length, 2);
  assert.deepEqual(highlights[1], {
    locator: { selector: "[data-guide='business-form-full-screen']" },
    label: 'Close full screen',
    number: 3,
    padding: 6,
    optional: true
  });
});

test('includeBusinessFormViewAction does not duplicate an explicit flow highlight', async () => {
  const original = [
    { locator: { selector: "[data-guide='business-form-full-screen']" }, label: 'Focus Business Form', number: 1 }
  ];
  const page = {
    locator() { throw new Error('locator should not be evaluated for an explicit highlight'); }
  };

  const highlights = await includeBusinessFormViewAction(page, original);

  assert.equal(highlights, original);
});

test('includeWorkbenchDragControls adds visible Workbench resize and move handles to every capture', async () => {
  const labels = new Map([
    ["[role='separator'][aria-label='Resize sidebar and work area']", 'Resize sidebar and work area'],
    ["[role='separator'][aria-label='Resize map and business form']", 'Resize map and business form'],
    ["[data-guide='workbench-map-toolbar-drag']", 'Move Map tools']
  ]);
  const page = {
    locator(selector) {
      const label = labels.get(selector);
      assert.ok(label, `unexpected selector ${selector}`);
      return {
        first() {
          return {
            async isVisible() { return true; },
            async getAttribute(name) { return name === 'aria-label' ? label : null; }
          };
        }
      };
    }
  };

  const highlights = await includeWorkbenchDragControls(page, [
    { locator: { selector: "[data-guide='business-form-content']" }, label: 'Overview', number: 4 }
  ]);

  assert.equal(highlights.length, 4);
  assert.deepEqual(highlights.slice(1), [
    {
      locator: { selector: "[role='separator'][aria-label='Resize sidebar and work area']" },
      label: 'Resize sidebar and work area',
      number: 5,
      padding: 4,
      optional: true
    },
    {
      locator: { selector: "[role='separator'][aria-label='Resize map and business form']" },
      label: 'Resize map and business form',
      number: 6,
      padding: 4,
      optional: true
    },
    {
      locator: { selector: "[data-guide='workbench-map-toolbar-drag']" },
      label: 'Move Map tools',
      number: 7,
      padding: 5,
      optional: true
    }
  ]);
});

test('includeWorkbenchDragControls does not duplicate a drag control already highlighted by the flow', async () => {
  const original = [
    {
      locator: { selector: "[data-guide='workbench-map-toolbar-drag']" },
      label: 'Drag handle',
      number: 1
    }
  ];
  const page = {
    locator(selector) {
      return {
        first() {
          return {
            async isVisible() {
              return selector !== "[role='separator'][aria-label='Resize sidebar and work area']"
                && selector !== "[role='separator'][aria-label='Resize map and business form']";
            },
            async getAttribute() { return 'unused'; }
          };
        }
      };
    }
  };

  const highlights = await includeWorkbenchDragControls(page, original);

  assert.equal(highlights.length, 1);
  assert.equal(highlights[0], original[0]);
});


test('addHighlightBoxes returns guide legend labels while screenshot markers stay numeric', async () => {
  const candidate = {
    async isVisible() { return true; },
    async scrollIntoViewIfNeeded() {},
    async boundingBox() { return { x: 40, y: 50, width: 120, height: 32 }; }
  };
  const locator = {
    async count() { return 1; },
    nth() { return candidate; }
  };
  const page = {
    locator(selector) {
      assert.equal(selector, '[data-guide="save"]');
      return locator;
    },
    async evaluate() {}
  };

  const legend = await addHighlightBoxes(page, [{
    locator: { selector: '[data-guide="save"]' },
    number: 3,
    label: 'Save changes',
    color: '#0058a4',
    labelBackground: '#0058a4',
    labelColor: '#ffffff'
  }], {
    color: '#d92d20',
    padding: 6,
    lineWidth: 4,
    labelBackground: '#d92d20',
    labelColor: '#ffffff'
  });

  assert.deepEqual(legend, [{
    number: 3,
    label: 'Save changes',
    color: '#0058a4',
    textColor: '#ffffff'
  }]);
});

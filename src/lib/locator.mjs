export function resolveLocator(page, specification) {
  if (!specification) {
    throw new Error('A locator specification is required.');
  }

  if (typeof specification === 'string') {
    return page.locator(specification);
  }

  let locator;
  if (specification.selector) {
    locator = page.locator(specification.selector);
  } else if (specification.testId) {
    locator = page.getByTestId(specification.testId);
  } else if (specification.role) {
    locator = page.getByRole(specification.role, {
      name: specification.name,
      exact: specification.exact ?? false
    });
  } else if (specification.label) {
    locator = page.getByLabel(specification.label, { exact: specification.exact ?? false });
  } else if (specification.placeholder) {
    locator = page.getByPlaceholder(specification.placeholder, { exact: specification.exact ?? false });
  } else if (specification.text) {
    locator = page.getByText(specification.text, { exact: specification.exact ?? false });
  } else if (specification.title) {
    locator = page.getByTitle(specification.title, { exact: specification.exact ?? false });
  } else {
    throw new Error(`Unsupported locator specification: ${JSON.stringify(specification)}`);
  }

  return Number.isInteger(specification.nth) ? locator.nth(specification.nth) : locator;
}

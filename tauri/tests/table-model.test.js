import test from "node:test";
import assert from "node:assert/strict";

import { clampWidths, DEFAULT_ORDER, MIN_WIDTHS } from "../src/table-model.js";

test("defaults contain all table columns", () => {
  assert.equal(DEFAULT_ORDER.length, 5);
  for (const key of Object.keys(MIN_WIDTHS)) {
    assert.ok(DEFAULT_ORDER.includes(key));
  }
});

test("clampWidths enforces minimums", () => {
  const widths = clampWidths({ comic: 40, status: 9999 });
  assert.equal(widths.comic, MIN_WIDTHS.comic);
  assert.equal(widths.status, 9999);
});

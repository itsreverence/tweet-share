import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "userscript", "src");
const context = {};
runInNewContext(
  `${["00-config.js", "09-surface.js"].map((name) => readFileSync(path.join(srcDir, name), "utf8")).join("\n")}
this.placePanel = placePanel;`,
  context
);
const placePanel = (input) => ({ ...context.placePanel(input) });

const GAP = 8;
const shareButton = (top, left = 800) => ({ top, left, width: 34, height: 34, bottom: top + 34, right: left + 34 });
const desktop = { width: 1100, height: 860 };
const panel = { width: 360, height: 300 };

function assertInsideViewport(placement, viewport, height) {
  assert.ok(placement.top >= 0 && placement.top + Math.min(height, placement.maxHeight) <= viewport.height, "the panel stays inside the viewport vertically");
  assert.ok(placement.left >= 0, "the panel starts inside the viewport");
}

test("on a 1100x860 desktop the panel opens above Share, centered on it", () => {
  const anchor = shareButton(420);
  const placement = placePanel({ anchorRect: anchor, panelSize: panel, viewport: desktop });

  assert.equal(placement.mode, "above");
  assert.equal(placement.top + panel.height, anchor.top - GAP, "the panel ends a small gap above Share");
  assert.equal(placement.left + panel.width / 2, anchor.left + anchor.width / 2, "the panel is centered on Share");
  assertInsideViewport(placement, desktop, panel.height);
});

test("with Share near the top, the panel opens below it", () => {
  const anchor = shareButton(60);
  const placement = placePanel({ anchorRect: anchor, panelSize: panel, viewport: desktop });

  assert.equal(placement.mode, "below");
  assert.equal(placement.top, anchor.bottom + GAP, "the panel starts a small gap below Share");
});

test("with Share near the bottom, the panel still opens above it", () => {
  const anchor = shareButton(800);
  const placement = placePanel({ anchorRect: anchor, panelSize: { width: 360, height: 620 }, viewport: desktop });

  assert.equal(placement.mode, "above");
  assert.equal(placement.top + 620, anchor.top - GAP);
});

test("Share near the right edge keeps the panel inside the viewport", () => {
  const placement = placePanel({ anchorRect: shareButton(420, 1080), panelSize: panel, viewport: desktop });

  assert.equal(placement.left + panel.width, desktop.width - GAP, "the panel's right edge keeps a small margin");
});

test("on a short viewport a panel that fits neither above nor below is clamped and capped", () => {
  const viewport = { width: 1100, height: 500 };
  const anchor = shareButton(230);
  const tall = { width: 360, height: 700 };
  const placement = placePanel({ anchorRect: anchor, panelSize: tall, viewport });

  assert.equal(placement.mode, "clamped");
  assert.equal(placement.maxHeight, viewport.height - GAP * 2, "the panel is capped to the viewport, so its preview scrolls");
  assert.equal(placement.top, GAP);
  assertInsideViewport(placement, viewport, tall.height);
});

test("a clamped panel shorter than the viewport stays as close to Share as it fits", () => {
  const viewport = { width: 1100, height: 500 };
  const anchor = shareButton(230);
  const placement = placePanel({ anchorRect: anchor, panelSize: { width: 360, height: 420 }, viewport });

  assert.equal(placement.mode, "clamped");
  assert.equal(placement.top + 420 / 2, anchor.top + anchor.height / 2, "the panel is centered on Share");
  assertInsideViewport(placement, viewport, 420);
});

test("on a 390x844 phone the panel is a bottom sheet that leaves the top of the page visible", () => {
  const viewport = { width: 390, height: 844 };
  for (const height of [300, 2000]) {
    const placement = placePanel({ anchorRect: shareButton(420, 330), panelSize: { width: 390, height }, viewport });
    assert.equal(placement.mode, "sheet", `a ${height}px panel is a sheet`);
    assert.ok(placement.maxHeight < viewport.height, `a ${height}px sheet is capped below the viewport height`);
  }
});

test("the sheet starts below 500px wide", () => {
  const at = (width) => placePanel({ anchorRect: shareButton(420, 200), panelSize: panel, viewport: { width, height: 844 } }).mode;
  assert.equal(at(499), "sheet");
  assert.notEqual(at(500), "sheet");
});

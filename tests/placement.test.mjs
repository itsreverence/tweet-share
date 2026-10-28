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
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const shareButton = (top, left = 800) => box(left, top, 34, 34);
// What the user sees; pinch zoom shrinks it and moves it away from the page's top left corner.
const screen = (width, height, left = 0, top = 0) => box(left, top, width, height);
const desktop = screen(1100, 860);
const panel = { width: 360, height: 300 };

function assertInsideViewport(placement, viewport, size) {
  const height = Math.min(size.height, placement.maxHeight);
  assert.ok(placement.top >= viewport.top && placement.top + height <= viewport.bottom, "the panel stays inside the viewport vertically");
  assert.ok(placement.left >= viewport.left && placement.left + size.width <= viewport.right, "the panel stays inside the viewport horizontally");
}

test("on a 1100x860 desktop the panel opens above Share, centered on it", () => {
  const anchor = shareButton(420);
  const placement = placePanel({ anchorRect: anchor, panelSize: panel, viewport: desktop });

  assert.equal(placement.mode, "above");
  assert.equal(placement.top + panel.height, anchor.top - GAP, "the panel ends a small gap above Share");
  assert.equal(placement.left + panel.width / 2, anchor.left + anchor.width / 2, "the panel is centered on Share");
  assertInsideViewport(placement, desktop, panel);
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
  const viewport = screen(1100, 500);
  const anchor = shareButton(230);
  const tall = { width: 360, height: 700 };
  const placement = placePanel({ anchorRect: anchor, panelSize: tall, viewport });

  assert.equal(placement.mode, "clamped");
  assert.equal(placement.maxHeight, viewport.height - GAP * 2, "the panel is capped to the viewport, so its preview scrolls");
  assert.equal(placement.top, GAP);
  assertInsideViewport(placement, viewport, tall);
});

test("a clamped panel shorter than the viewport stays as close to Share as it fits", () => {
  const viewport = screen(1100, 500);
  const anchor = shareButton(230);
  const placement = placePanel({ anchorRect: anchor, panelSize: { width: 360, height: 420 }, viewport });

  assert.equal(placement.mode, "clamped");
  assert.equal(placement.top + 420 / 2, anchor.top + anchor.height / 2, "the panel is centered on Share");
  assertInsideViewport(placement, viewport, { width: 360, height: 420 });
});

test("on a 390x844 phone the panel is a bottom sheet that leaves the top of the page visible", () => {
  const viewport = screen(390, 844);
  for (const height of [300, 2000]) {
    const placement = placePanel({ anchorRect: shareButton(420, 330), panelSize: { width: 390, height }, viewport });
    assert.equal(placement.mode, "sheet", `a ${height}px panel is a sheet`);
    assert.ok(placement.maxHeight < viewport.height, `a ${height}px sheet is capped below the viewport height`);
  }
});

test("the sheet starts below 500px wide", () => {
  const at = (width) => placePanel({ anchorRect: shareButton(420, 200), panelSize: panel, viewport: screen(width, 844) }).mode;
  assert.equal(at(499), "sheet");
  assert.notEqual(at(500), "sheet");
});

test("a sheet spans the visible width and sits on the visible bottom edge", () => {
  const placement = placePanel({ anchorRect: shareButton(420, 330), panelSize: { width: 390, height: 300 }, viewport: screen(390, 844) });

  assert.deepEqual([placement.left, placement.width, placement.top], [0, 390, 844], "its top is the bottom edge its CSS lifts it from");
});

test("pinch zoom on a phone keeps the sheet inside what the user sees", () => {
  const zoomed = screen(195, 422, 126, 422);
  const placement = placePanel({ anchorRect: shareButton(600, 200), panelSize: { width: 390, height: 300 }, viewport: zoomed });

  assert.equal(placement.mode, "sheet");
  assert.deepEqual([placement.left, placement.width, placement.top], [126, 195, 844], "the sheet spans the zoomed-in view and sits on its bottom edge");
  assert.ok(placement.maxHeight < zoomed.height, "the sheet leaves the top of the zoomed-in view visible");
});

test("pinch zoom on a desktop keeps the panel inside the moved view, next to Share", () => {
  const zoomed = screen(550, 430, 408, 215);
  const anchor = shareButton(520, 800);
  const placement = placePanel({ anchorRect: anchor, panelSize: panel, viewport: zoomed });

  assert.equal(placement.mode, "clamped", "the panel fits neither above nor below Share inside the zoomed-in view");
  assertInsideViewport(placement, zoomed, panel);
  assert.equal(placement.maxHeight, zoomed.height - GAP * 2, "the panel is capped to the zoomed-in view");
});

test("pinch zoom past 500 visible pixels turns the panel into a sheet, even on a wide window", () => {
  const placement = placePanel({ anchorRect: shareButton(420), panelSize: panel, viewport: screen(366, 286, 300, 200) });

  assert.equal(placement.mode, "sheet");
  assert.deepEqual([placement.left, placement.width, placement.top], [300, 366, 486]);
});

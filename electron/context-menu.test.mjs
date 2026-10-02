import { test } from "node:test";
import assert from "node:assert/strict";

import { buildContextMenuTemplate } from "./context-menu.mjs";

function setup(params, overrides = {}) {
  const calls = [];
  const actions = {
    openTab: (u) => calls.push(["openTab", u]),
    copyText: (t) => calls.push(["copyText", t]),
    search: (t) => calls.push(["search", t]),
    back: () => calls.push(["back"]),
    forward: () => calls.push(["forward"]),
    reload: () => calls.push(["reload"]),
    inspect: (x, y) => calls.push(["inspect", x, y]),
    canGoBack: true,
    canGoForward: false,
    engineName: "Google",
    ...overrides,
  };
  const template = buildContextMenuTemplate(params, actions);
  const labels = template.map((i) => i.label ?? i.role ?? i.type);
  const click = (label) => template.find((i) => i.label === label)?.click();
  return { template, labels, calls, click };
}

test("a blank part of a page offers navigation and Inspect", () => {
  const { labels } = setup({ x: 10, y: 20 });
  assert.deepEqual(labels, ["Back", "Forward", "Reload", "separator", "Inspect"]);
});

test("Back and Forward reflect what is possible", () => {
  const { template } = setup({}, { canGoBack: true, canGoForward: false });
  assert.equal(template.find((i) => i.label === "Back").enabled, true);
  assert.equal(template.find((i) => i.label === "Forward").enabled, false);
});

test("a link can be opened in a new tab or copied", () => {
  const { labels, click, calls } = setup({ linkURL: "https://example.com/a?b=1" });
  assert.deepEqual(labels.slice(0, 2), ["Open link in new tab", "Copy link address"]);
  click("Open link in new tab");
  click("Copy link address");
  assert.deepEqual(calls, [["openTab", "https://example.com/a?b=1"], ["copyText", "https://example.com/a?b=1"]]);
});

test("only web links are offered, never javascript: or mailto:", () => {
  for (const linkURL of ["javascript:alert(1)", "mailto:a@b.c", "file:///C:/x", "data:text/html,x", ""]) {
    assert.ok(!setup({ linkURL }).labels.includes("Open link in new tab"), linkURL);
  }
});

test("an image can be opened or copied by address", () => {
  const { labels, click, calls } = setup({ mediaType: "image", srcURL: "https://example.com/logo.png" });
  assert.ok(labels.includes("Open image in new tab") && labels.includes("Copy image address"));
  click("Open image in new tab");
  assert.deepEqual(calls, [["openTab", "https://example.com/logo.png"]]);
});

test("a data: image has no address to open", () => {
  assert.ok(!setup({ mediaType: "image", srcURL: "data:image/png;base64,AAAA" }).labels.includes("Open image in new tab"));
});

test("selected text can be copied or searched, with a long selection shortened", () => {
  const { labels, click, calls } = setup({ selectionText: "  closures in javascript explained simply and clearly  " });
  assert.ok(labels.includes("copy"));
  const searchLabel = labels.find((l) => String(l).startsWith("Search Google"));
  assert.ok(searchLabel.length < 60 && searchLabel.endsWith("…”"), searchLabel);
  click(searchLabel);
  assert.deepEqual(calls, [["search", "closures in javascript explained simply and clearly"]]);
});

test("in a text field the editing commands appear and navigation does not", () => {
  const { labels } = setup({ isEditable: true });
  assert.deepEqual(labels, ["cut", "copy", "paste", "separator", "selectAll", "separator", "Inspect"]);
});

test("a link inside selected text shows link items first", () => {
  const { labels } = setup({ linkURL: "https://example.com/", selectionText: "go" });
  assert.equal(labels[0], "Open link in new tab");
  assert.ok(labels.indexOf("copy") > labels.indexOf("Copy link address"));
  assert.equal(labels[labels.length - 1], "Inspect");
});

test("Inspect passes the click position so the right element is highlighted", () => {
  const { click, calls } = setup({ x: 120, y: 340 });
  click("Inspect");
  assert.deepEqual(calls, [["inspect", 120, 340]]);
});

test("no separator is ever first, last or doubled", () => {
  for (const params of [{}, { linkURL: "https://a.b/" }, { isEditable: true }, { selectionText: "x" }, { mediaType: "image", srcURL: "https://a.b/i.png", linkURL: "https://a.b/" }]) {
    const { template } = setup(params);
    assert.notEqual(template[0].type, "separator");
    assert.notEqual(template.at(-1).type, "separator");
    template.forEach((item, i) => assert.ok(!(item.type === "separator" && template[i - 1]?.type === "separator")));
  }
});

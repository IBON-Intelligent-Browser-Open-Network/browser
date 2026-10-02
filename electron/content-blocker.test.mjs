import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ContentBlocker, FILTER_LISTS, MAX_AGE_MS, RESOURCES_URL, RETRY_MS } from "./content-blocker.mjs";

const NEWS = "https://news.example/article";
const BLOCKED = { response: { cancel: true }, blocked: true };

// Just enough of uBO's resources (as Ghostery publishes them) for one redirect and one scriptlet.
const RESOURCES = JSON.stringify({
  redirects: [{ name: "noop.js", aliases: ["noopjs"], body: "(function(){})();", contentType: "application/javascript" }],
  scriptlets: [{ name: "set-constant.js", aliases: ["set.js"], body: "function setConstant(name, value) { window.__ibonSet = [name, value]; }", dependencies: [] }],
});

const UBO_FILTERS = [
  "! Title: uBlock filters (test copy)",
  "||ads.example^",
  "@@||ads.example/allowed.js",
  "||cdn.tracker.test^$third-party",
  "||widgets.example/gpt.js$script,redirect=noopjs",
  "$removeparam=utm_source",
  "||csp.example^$csp=script-src 'none'",
  "news.example##.ad-slot",
  "##.banner-ad",
  "news.example##+js(set-constant, adsEnabled, false)",
  "!#if env_firefox",
  "||firefox-only.example^",
  "!#endif",
  "!#if env_chromium",
  "||chromium-only.example^",
  "!#endif",
].join("\n");

/**
 * A pretend internet. Every list URL answers with an empty list, except the lists given; `down` lists fail.
 * Counts what is downloaded.
 */
function web({ lists = { "ublock-filters": UBO_FILTERS }, down = [], offline = false } = {}) {
  const fetched = [];
  const download = async (url) => {
    fetched.push(url);
    if (offline) throw new Error("offline");
    if (url === RESOURCES_URL) return RESOURCES;
    const list = FILTER_LISTS.find((l) => l.urls.includes(url));
    if (!list || down.includes(list.id)) throw new Error(`404 ${url}`);
    return lists[list.id] ?? `! Title: ${list.name}\n`;
  };
  return { download, fetched };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ibon-filters-"));

async function ready(options = {}, more = {}) {
  const net = web(options);
  const blocker = new ContentBlocker({ cacheDir: more.cacheDir ?? tempDir(), download: net.download, now: more.now });
  await blocker.start({ download: false });
  await blocker.update();
  return { blocker, net };
}

const req = (url, type = "script", pageUrl = NEWS) => ({ url, type, pageUrl, sourceUrl: pageUrl });

test("before the lists arrive, the built-in tracker list blocks, but never a page", async () => {
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: web({ offline: true }).download });
  await blocker.start({ download: false });
  assert.equal(blocker.status().state, "fallback");
  assert.deepEqual(blocker.check(req("https://www.google-analytics.com/collect", "xhr")), BLOCKED);
  assert.equal(blocker.check(req("https://news.example/app.js")), null);
  assert.equal(blocker.check(req("https://www.optimizely.com/", "mainFrame")), null, "typing a tracker's address still opens it");
});

test("uBO network rules: blocking, exceptions and third-party", async () => {
  const { blocker } = await ready();
  assert.equal(blocker.status().state, "ready");
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js")), BLOCKED);
  assert.deepEqual(blocker.check(req("https://img.ads.example/x.png", "image")), BLOCKED, "subdomains too");
  assert.equal(blocker.check(req("https://ads.example/allowed.js")), null, "@@ exception");
  assert.deepEqual(blocker.check(req("https://cdn.tracker.test/t.js")), BLOCKED, "third-party on a news site");
  assert.equal(blocker.check(req("https://cdn.tracker.test/t.js", "script", "https://www.tracker.test/")), null, "first-party on its own site");
  assert.equal(blocker.check(req("https://news.example/app.js")), null);
});

test("the referrer decides first or third party, the tab's page fills in when there is none", async () => {
  const { blocker } = await ready();
  const inFrame = { url: "https://cdn.tracker.test/t.js", type: "script", pageUrl: NEWS, sourceUrl: "https://tracker.test/frame" };
  assert.equal(blocker.check(inFrame), null, "loaded by the tracker's own frame: first party");
  assert.deepEqual(blocker.check({ ...inFrame, sourceUrl: "" }), BLOCKED, "no referrer: judged against the page");
});

test("$redirect swaps in a harmless stand-in, served by Ibon rather than as a data: URL, and counts as blocked", async () => {
  const { blocker } = await ready();
  const verdict = blocker.check(req("https://widgets.example/gpt.js"));
  assert.equal(verdict.response.redirectURL, "ibon-resource://stand-in/noop.js");
  assert.equal(verdict.blocked, true);
  assert.deepEqual(blocker.redirectResource("noop.js"), { contentType: "application/javascript", body: "(function(){})();" });
});

test("stand-ins the resources do not name still come back harmless and of the right type", async () => {
  const { blocker } = await ready();
  const gif = blocker.redirectResource("unknown-pixel.gif");
  assert.equal(gif.contentType, "image/gif");
  assert.ok(Buffer.isBuffer(gif.body) && gif.body.subarray(0, 3).toString() === "GIF", "a real (blank) gif, decoded from base64");
  assert.match(blocker.redirectResource("whatever.js").contentType, /javascript/);
});

test("pages are never blocked, but tracking parameters are removed from their address", async () => {
  const { blocker } = await ready();
  assert.equal(blocker.check(req("https://ads.example/", "mainFrame")), null);
  assert.deepEqual(blocker.check(req("https://shop.example/item?utm_source=mail&id=7", "mainFrame")), {
    response: { redirectURL: "https://shop.example/item?id=7" },
    blocked: false,
  });
  assert.equal(blocker.check({ ...req("https://shop.example/item?utm_source=mail", "mainFrame"), method: "POST" }), null, "a form post is never redirected");
  assert.equal(blocker.check(req("https://shop.example/item?id=7", "mainFrame")), null);
});

test("!#if blocks follow Chromium: Firefox-only rules are left out", async () => {
  const { blocker } = await ready();
  assert.deepEqual(blocker.check(req("https://chromium-only.example/x.js")), BLOCKED);
  assert.equal(blocker.check(req("https://firefox-only.example/x.js")), null);
});

test("pausing a site lets everything through on it and its subdomains, and nowhere else", async () => {
  const { blocker } = await ready();
  blocker.setPausedSites(["news.example"]);
  assert.equal(blocker.isPaused("https://www.news.example/"), true);
  assert.equal(blocker.isPaused("https://othernews.example/"), false);
  assert.equal(blocker.check(req("https://ads.example/banner.js")), null);
  assert.equal(blocker.check(req("https://ads.example/banner.js", "script", "https://www.news.example/")), null);
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js", "script", "https://othernews.example/")), BLOCKED);
  assert.equal(blocker.cosmetics(NEWS), null);
  assert.equal(blocker.check(req("https://news.example/?utm_source=x", "mainFrame")), null, "a paused page keeps its address");
  blocker.setPausedSites([]);
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js")), BLOCKED);
});

test("element hiding: site rules up front, generic rules once the page shows a matching class", async () => {
  const { blocker } = await ready();
  const first = blocker.cosmetics(NEWS);
  assert.match(first.styles, /\.ad-slot/);
  assert.doesNotMatch(first.styles, /\.banner-ad/, "generic rules wait until the page has the class");
  assert.match(blocker.cosmetics(NEWS, { classes: ["banner-ad"], ids: [], hrefs: [] }).styles, /\.banner-ad/);
  assert.doesNotMatch(blocker.cosmetics("https://other.example/").styles, /\.ad-slot/);
  assert.equal(blocker.cosmetics("file:///C:/page.html"), null);
});

test("scriptlets come back as code to run in the page", async () => {
  const { blocker } = await ready();
  const { scripts } = blocker.cosmetics(NEWS);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /setConstant/);
  assert.match(scripts[0], /adsEnabled/);
});

test("$csp rules add a policy to the page", async () => {
  const { blocker } = await ready();
  assert.match(blocker.csp({ url: "https://csp.example/", type: "mainFrame", pageUrl: NEWS }), /script-src 'none'/);
  assert.equal(blocker.csp({ url: "https://news.example/", type: "mainFrame", pageUrl: NEWS }), undefined);
  assert.equal(blocker.csp({ url: "https://csp.example/x.js", type: "script", pageUrl: NEWS }), undefined, "only documents get a policy");
});

test("page-supplied DOM details are checked before use", async () => {
  const { blocker } = await ready();
  assert.doesNotThrow(() => blocker.cosmetics(NEWS, { classes: "banner-ad", ids: [1, null, {}], hrefs: undefined }));
});

test("My filters add rules, override the lists with @@, and report lines they do not understand", async () => {
  const { blocker } = await ready();
  const info = blocker.setMyFilters("||extra.example^\n@@||ads.example^$domain=news.example\nexample.com##.promo\n! a comment\nexample.com#$#body { color: red }");
  assert.deepEqual(blocker.check(req("https://extra.example/x.js")), BLOCKED);
  assert.equal(blocker.check(req("https://ads.example/banner.js")), null, "my exception wins on news.example");
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js", "script", "https://other.example/")), BLOCKED, "and only there");
  assert.equal(info.rules, 3);
  assert.equal(info.unsupported, 1);
  assert.deepEqual(blocker.status().myFilters, info);
  blocker.setMyFilters("");
  assert.equal(blocker.check(req("https://extra.example/x.js")), null, "removing a rule takes it away");
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js")), BLOCKED);
});

test("My filters work before the lists have downloaded, next to the built-in list", async () => {
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: web({ offline: true }).download });
  await blocker.start({ download: false });
  blocker.setMyFilters("||mine.example^\nnews.example##.ad-slot");
  assert.deepEqual(blocker.check(req("https://mine.example/x.js")), BLOCKED);
  assert.deepEqual(blocker.check(req("https://www.google-analytics.com/collect", "xhr")), BLOCKED, "built-in list still on");
  assert.match(blocker.cosmetics(NEWS).styles, /\.ad-slot/);
  blocker.setMyFilters("@@||google-analytics.com^");
  assert.equal(blocker.check(req("https://www.google-analytics.com/collect", "xhr")), null, "and my exceptions override it");
});

test("the built engine is cached: the next start blocks straight away, without downloading", async () => {
  const cacheDir = tempDir();
  await ready({}, { cacheDir });
  const net = web({ offline: true });
  const next = new ContentBlocker({ cacheDir, download: net.download });
  await next.start(); // with downloads allowed: the cache is fresh, so nothing is fetched
  assert.equal(next.status().state, "ready");
  assert.deepEqual(next.check(req("https://ads.example/banner.js")), BLOCKED);
  assert.equal(net.fetched.length, 0);
});

test("lists older than a day are refreshed; a failed refresh is retried after 30 minutes, not sooner", async () => {
  let clock = 1_000_000;
  const now = () => clock;
  const cacheDir = tempDir();
  const { blocker } = await ready({}, { cacheDir, now });
  assert.equal(blocker.isStale(), false);
  clock += MAX_AGE_MS + 1;
  assert.equal(blocker.isStale(), true);

  const net = web({ offline: true });
  const later = new ContentBlocker({ cacheDir, download: net.download, now });
  await later.start({ download: false });
  await later.updateIfStale();
  const tries = net.fetched.length;
  assert.ok(tries > 0, "stale lists are fetched");
  assert.equal(later.status().state, "ready", "a failed refresh keeps the lists we had");
  assert.deepEqual(later.check(req("https://ads.example/banner.js")), BLOCKED);
  await later.updateIfStale();
  assert.equal(net.fetched.length, tries, "no retry straight away");
  clock += RETRY_MS + 1;
  await later.updateIfStale();
  assert.ok(net.fetched.length > tries, "retried later");
});

test("a list that cannot be downloaded falls back to its last copy", async () => {
  const cacheDir = tempDir();
  await ready({}, { cacheDir });
  const net = web({ down: ["ublock-filters"] });
  const blocker = new ContentBlocker({ cacheDir, download: net.download });
  await blocker.start({ download: false });
  await blocker.update();
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js")), BLOCKED, "rules from the saved copy");
  assert.ok(blocker.status().lists.every((l) => l.ok));
  assert.match(blocker.status().error, /uBlock filters – Ads/);
});

test("with no lists at all, a first update reports the problem and keeps the built-in list", async () => {
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: web({ offline: true }).download });
  await blocker.start({ download: false });
  await blocker.update();
  const status = blocker.status();
  assert.equal(status.state, "fallback");
  assert.match(status.error, /Could not download/);
  assert.deepEqual(blocker.check(req("https://www.google-analytics.com/collect", "xhr")), BLOCKED);
});

test("a list missing on the first run is used when it arrives, and retried meanwhile", async () => {
  let clock = 5_000_000;
  const net = web({ down: ["easylist"] });
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: net.download, now: () => clock });
  await blocker.start({ download: false });
  await blocker.update();
  assert.equal(blocker.status().state, "ready", "the rest is better than the built-in list");
  assert.equal(blocker.status().lists.find((l) => l.id === "easylist").ok, false);
  assert.equal(blocker.isStale(), true, "an incomplete set counts as stale");
});

test("a captive portal's HTML page is not taken for a filter list", async () => {
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: async () => "<!doctype html><title>Sign in to Wi-Fi</title>" });
  await blocker.start({ download: false });
  await blocker.update();
  assert.equal(blocker.status().state, "fallback");
});

test("updates already running are shared, not repeated", async () => {
  const net = web();
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: net.download });
  await blocker.start({ download: false });
  let changes = 0;
  blocker.onChange = () => changes++;
  const a = blocker.update();
  const b = blocker.update();
  assert.equal(blocker.status().state, "updating");
  await Promise.all([a, b]);
  assert.equal(a, b);
  assert.equal(net.fetched.length, FILTER_LISTS.length + 1, "each list once, plus the resources");
  assert.equal(changes, 2, "told when it started and when it finished");
});

test("after an engine upgrade while offline, the saved lists are rebuilt rather than dropping to the built-in list", async () => {
  const cacheDir = tempDir();
  await ready({}, { cacheDir });
  fs.writeFileSync(path.join(cacheDir, "engine.bin"), Buffer.from("written by an older engine"));
  const blocker = new ContentBlocker({ cacheDir, download: web({ offline: true }).download });
  await blocker.start({ download: false });
  await blocker.update();
  assert.equal(blocker.status().state, "ready");
  assert.equal(blocker.status().updatedAt, 0, "built from saved copies, not a fresh download");
  assert.deepEqual(blocker.check(req("https://ads.example/banner.js")), BLOCKED);
  assert.equal(blocker.isStale(), true, "and still tries to download");
});

test("blocking works the moment the blocker exists, before start()", () => {
  const blocker = new ContentBlocker({ cacheDir: tempDir(), download: web({ offline: true }).download });
  assert.deepEqual(blocker.check(req("https://www.google-analytics.com/collect", "xhr")), BLOCKED);
  assert.equal(blocker.cosmetics(NEWS).styles, "");
});

test("a cache from another engine version is ignored, not trusted", async () => {
  const cacheDir = tempDir();
  fs.writeFileSync(path.join(cacheDir, "engine.bin"), Buffer.from("not an engine"));
  fs.writeFileSync(path.join(cacheDir, "engine.json"), JSON.stringify({ updatedAt: Date.now(), lists: [], networkRules: 1, cosmeticRules: 1 }));
  const blocker = new ContentBlocker({ cacheDir, download: web({ offline: true }).download });
  await blocker.start({ download: false });
  assert.equal(blocker.status().state, "fallback");
  assert.equal(blocker.isStale(), true);
});

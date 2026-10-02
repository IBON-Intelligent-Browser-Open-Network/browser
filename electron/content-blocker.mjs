// Ad and tracker blocking with uBlock Origin's filter lists.
//
// What "uBlock Origin" means here: uBlock Origin's *code* is GPL-3.0 and is not part of Ibon (tasks.md, decision D4).
// Its filter lists are used as data: Ibon downloads the lists uBO turns on out of the box (see FILTER_LISTS), from
// uBO's own servers, at runtime (they are never shipped with the app), and runs them with Ghostery's filter engine
// (`@ghostery/adblocker`, MPL-2.0, used unmodified). The engine reads uBO's filter syntax: network rules and
// exceptions, $redirect, $removeparam, $csp, element hiding and scriptlets (`##+js(...)`, with uBO's scriptlet
// resources as Ghostery publishes them, also downloaded at runtime).
//
// How it fits into the browser:
//  - Building the engine from ~170,000 rules takes most of a second, too long for the main process (every page
//    request waits on it), so main.mjs builds it in a worker thread, once a day. The result is cached in the
//    profile and startup only loads the cache, which takes milliseconds.
//  - Until the lists have been downloaded once (first run, offline) the small built-in tracker list keeps blocking.
//  - "My filters", like uBO's pane of the same name, sit on top of the lists and can override them with @@ rules.
//  - Blocking can be paused per site, like uBO's power button. A paused site covers its subdomains.
//  - Top-level pages are never blocked, only what they load. Tracking parameters are still removed from their URLs.
//
// This file has no Electron imports: downloading and building are passed in, so it is unit-tested with plain Node.
//
// SPDX-License-Identifier: BSD-3-Clause
import fs from "node:fs/promises";
import path from "node:path";
import { FiltersEngine, Request, parseFilters } from "@ghostery/adblocker";

import { TRACKER_SIGNATURES } from "./readable.mjs";

/** Ibon's original hand-written tracker list, as filter rules. It stands in until the real lists have downloaded. */
const BUILT_IN_FILTERS = TRACKER_SIGNATURES.join("\n");

const UASSETS = ["https://ublockorigin.github.io/uAssetsCDN", "https://ublockorigin.pages.dev"];
const fromUAssets = (file) => UASSETS.map((base) => `${base}/${file}`);

/**
 * uBlock Origin's default filter lists: the ones its `assets/assets.json` enables on a fresh install, at the URLs
 * uBO itself downloads them from (the first URL that works wins). Licences are the publishers'; see docs/sourcing.md.
 * One default is left out: Peter Lowe's list states no licence or terms of use, and D4 in tasks.md excludes
 * unlicensed material. It is small and mostly covered by EasyList and EasyPrivacy.
 */
export const FILTER_LISTS = [
  { id: "ublock-filters", name: "uBlock filters – Ads", urls: fromUAssets("filters/filters.min.txt") },
  { id: "ublock-badware", name: "uBlock filters – Badware risks", urls: fromUAssets("filters/badware.min.txt") },
  { id: "ublock-privacy", name: "uBlock filters – Privacy", urls: fromUAssets("filters/privacy.min.txt") },
  { id: "ublock-unbreak", name: "uBlock filters – Unbreak", urls: fromUAssets("filters/unbreak.min.txt") },
  { id: "ublock-quick-fixes", name: "uBlock filters – Quick fixes", urls: fromUAssets("filters/quick-fixes.min.txt") },
  { id: "easylist", name: "EasyList", urls: fromUAssets("thirdparties/easylist.txt") },
  { id: "easyprivacy", name: "EasyPrivacy", urls: fromUAssets("thirdparties/easyprivacy.txt") },
  {
    id: "urlhaus-1",
    name: "Online Malicious URL Blocklist",
    urls: ["https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-ag-online.txt", "https://curbengh.github.io/malware-filter/urlhaus-filter-ag-online.txt"],
  },
];

/**
 * The code behind `##+js(...)` scriptlets and `$redirect=` resources. uBO bundles these inside its extension rather
 * than publishing them, so this is the copy Ghostery publishes for its engine (the URL its own `fetchResources()`
 * uses), which keeps the format in step with the engine. Without it, network and element-hiding rules still work.
 */
export const RESOURCES_URL = "https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json";

/** Rebuild the lists once they are older than this. uBO's own lists ask for 1 to 5 days. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** After a failed or incomplete download, wait at least this long before trying again. */
export const RETRY_MS = 30 * 60 * 1000;

const ENGINE_CONFIG = { loadCosmeticFilters: true, loadNetworkFilters: true, loadCSPFilters: true, loadPreprocessors: true, enableMutationObserver: true };

/**
 * Answers for the `!#if ...` blocks in the lists, so rules meant for Firefox, Safari or phones are left out. Ibon is
 * Chromium, the lists are written for uBO, and element hiding is injected as a user stylesheet. HTML filtering of
 * responses is not supported, so `cap_html_filtering` stays false and the lists use their fallbacks. (The engine's
 * `Env` type is a plain Map.)
 */
const ENV = new Map([
  ["env_chromium", true],
  ["ext_ublock", true],
  ["cap_user_stylesheet", true],
]);

/** Parses lists into an engine and serializes it. Slow (most of a second for the full set): run it in a worker. */
export function buildEngine(texts, resources) {
  const parsed = parseFilters(texts.join("\n"), ENGINE_CONFIG);
  const engine = new FiltersEngine({ ...parsed, config: ENGINE_CONFIG });
  let scriptlets = false;
  if (resources) {
    try {
      engine.updateResources(resources, `${resources.length}`);
      scriptlets = true;
    } catch {
      /* unreadable resources: blocking and hiding still work, scriptlets do not */
    }
  }
  return { bytes: engine.serialize(), networkRules: parsed.networkFilters.length, cosmeticRules: parsed.cosmeticFilters.length, scriptlets };
}

/** A captive portal or an error page arrives as HTML with status 200. A filter list never starts with a tag. */
const looksLikeHtml = (text) => /^\s*</.test(text);

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const BLOCK = Object.freeze({ response: Object.freeze({ cancel: true }), blocked: true });

/** Untrusted DOM details from a page: keep only strings, and not too many. */
const strings = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.length < 1000).slice(0, 5000) : undefined);

export class ContentBlocker {
  #engine = null; // what requests are matched against: the lists (or the built-in list) plus My filters
  #listsBytes = null; // the serialized lists engine, kept to rebuild #engine when My filters change
  #meta = null; // { updatedAt, lists: [{ id, ok }], networkRules, cosmeticRules, scriptlets }; updatedAt 0: saved copies
  #myFilters = "";
  #myFiltersInfo = { rules: 0, unsupported: 0 };
  #paused = new Set();
  #updating = null;
  #lastAttempt = -Infinity;
  #error = null;

  /**
   * @param {object} options
   * @param {string} options.cacheDir       where the downloaded lists and the built engine are kept between runs
   * @param {(url: string) => Promise<string>} options.download
   * @param {(texts: string[], resources: string) => Promise<ReturnType<typeof buildEngine>>} [options.build]
   * @param {() => void} [options.onChange]  called when the status changes (an update starts, finishes or fails)
   * @param {string} [options.redirectBase]  where `$redirect` stand-ins are served from, see redirectResource()
   * @param {() => number} [options.now]
   */
  constructor({ cacheDir, download, build = async (texts, resources) => buildEngine(texts, resources), onChange = () => {}, redirectBase = "ibon-resource://stand-in/", now = Date.now }) {
    this.cacheDir = cacheDir;
    this.download = download;
    this.build = build;
    this.onChange = onChange;
    this.redirectBase = redirectBase;
    this.now = now;
    this.#compose(); // the built-in list, until start() loads the real one
  }

  get #binFile() {
    return path.join(this.cacheDir, "engine.bin");
  }
  get #metaFile() {
    return path.join(this.cacheDir, "engine.json");
  }
  #listFile(id) {
    return path.join(this.cacheDir, "lists", `${id}.txt`);
  }

  /** Loads the cached engine. Resolves quickly; with `download`, stale or missing lists are fetched in the background. */
  async start({ download = true } = {}) {
    try {
      const [bytes, meta] = await Promise.all([fs.readFile(this.#binFile), fs.readFile(this.#metaFile, "utf8")]);
      this.#listsBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.#meta = JSON.parse(meta);
    } catch {
      this.#listsBytes = null; // no cache yet: the first update builds one
      this.#meta = null;
    }
    this.#compose();
    if (download) void this.updateIfStale();
  }

  /** True when the lists are missing, incomplete or older than a day. */
  isStale() {
    const meta = this.#meta;
    return !this.#listsBytes || !meta || this.now() - meta.updatedAt > MAX_AGE_MS || meta.lists.some((l) => !l.ok);
  }

  /** Updates when stale, but after a failure not more often than every 30 minutes. */
  updateIfStale() {
    if (this.#updating) return this.#updating;
    if (!this.isStale() || this.now() - this.#lastAttempt < RETRY_MS) return Promise.resolve();
    return this.update();
  }

  /** Downloads every list and rebuilds the engine. Calls made while an update runs share it. */
  update() {
    if (!this.#updating) {
      this.#updating = this.#runUpdate().finally(() => {
        this.#updating = null;
        this.onChange();
      });
      this.onChange();
    }
    return this.#updating;
  }

  async #runUpdate() {
    this.#lastAttempt = this.now();
    try {
      const results = await Promise.all(FILTER_LISTS.map((list) => this.#fetchList(list)));
      const texts = results.filter((r) => r.text !== null).map((r) => r.text);
      const fresh = results.some((r) => r.fresh);
      // Nothing new downloaded: keep the engine we have. With no engine at all, saved copies still beat the built-in list.
      if (texts.length === 0 || (!fresh && this.#listsBytes)) throw new Error("Could not download the filter lists. Ibon will try again later.");
      const resources = await this.download(RESOURCES_URL).catch(() => "");
      const built = await this.build(texts, looksLikeHtml(resources) ? "" : resources);
      const meta = {
        updatedAt: fresh ? this.now() : 0,
        lists: FILTER_LISTS.map((l, i) => ({ id: l.id, ok: results[i].text !== null })),
        networkRules: built.networkRules,
        cosmeticRules: built.cosmeticRules,
        scriptlets: built.scriptlets,
      };
      this.#listsBytes = built.bytes;
      this.#meta = meta;
      this.#compose();
      const names = (want) => FILTER_LISTS.filter((_, i) => want(results[i])).map((l) => l.name).join(", ");
      const saved = names((r) => !r.fresh && r.text !== null);
      const missing = names((r) => r.text === null);
      this.#error = [saved && `Could not refresh ${saved}; using the copy saved earlier.`, missing && `Could not download ${missing}; Ibon will try again.`].filter(Boolean).join(" ") || null;
      await this.#writeEngine(built.bytes, meta).catch((err) => {
        this.#error = `The filter lists are active but could not be saved for next time: ${err.message}`;
      });
    } catch (err) {
      this.#error = err instanceof Error ? err.message : String(err);
    }
  }

  /** A list's text, from its publisher or, failing that, the copy saved last time. `text` is null when there is neither. */
  async #fetchList(list) {
    for (const url of list.urls) {
      try {
        const text = await this.download(url);
        if (!text.trim() || looksLikeHtml(text)) continue;
        await this.#writeFile(this.#listFile(list.id), text).catch(() => {}); // only a fallback; never fatal
        return { text, fresh: true };
      } catch {
        /* try the next mirror */
      }
    }
    const saved = await fs.readFile(this.#listFile(list.id), "utf8").catch(() => null);
    return { text: saved, fresh: false };
  }

  /** Write, then rename, so a crash mid-write never leaves a half file that looks complete. */
  async #writeFile(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(`${file}.tmp`, data);
    await fs.rename(`${file}.tmp`, file);
  }

  async #writeEngine(bytes, meta) {
    await this.#writeFile(this.#binFile, bytes);
    await this.#writeFile(this.#metaFile, JSON.stringify(meta)); // last, so it only exists next to a complete engine
  }

  /** (Re)creates the engine from the lists and My filters. Deserializing is fast (a few milliseconds). */
  #compose() {
    let engine = null;
    if (this.#listsBytes) {
      try {
        engine = FiltersEngine.deserialize(this.#listsBytes);
      } catch {
        this.#listsBytes = null; // saved by another version of the engine; the next update replaces it
        this.#meta = null;
      }
    }
    const mine = parseFilters(this.#myFilters, ENGINE_CONFIG);
    this.#myFiltersInfo = { rules: mine.networkFilters.length + mine.cosmeticFilters.length, unsupported: mine.notSupportedFilters.length };
    // My filters go into the same engine as the lists, so their @@ exceptions can override list rules.
    const extra = engine ? mine : parseFilters(`${BUILT_IN_FILTERS}\n${this.#myFilters}`, ENGINE_CONFIG);
    engine ??= new FiltersEngine({ config: ENGINE_CONFIG });
    engine.update({ newNetworkFilters: extra.networkFilters, newCosmeticFilters: extra.cosmeticFilters, newPreprocessors: extra.preprocessors }, ENV);
    engine.updateEnv(ENV);
    this.#engine = engine;
  }

  /** The user's own rules, in uBO syntax, one per line. They apply on top of the lists. */
  setMyFilters(text) {
    this.#myFilters = String(text ?? "");
    this.#compose();
    return { ...this.#myFiltersInfo };
  }

  /** Sites (hostnames) where nothing is blocked. An entry covers its subdomains: `example.com` pauses `www.example.com`. */
  setPausedSites(hosts) {
    this.#paused = new Set((hosts ?? []).map((h) => String(h).toLowerCase()));
  }

  isPaused(pageUrl) {
    for (let host = hostnameOf(pageUrl); host; host = host.slice(host.indexOf(".") + 1 || host.length)) {
      if (this.#paused.has(host)) return true;
    }
    return false;
  }

  /**
   * What to do with one request.
   * @param {{ url: string, type: string, method?: string, sourceUrl?: string, pageUrl?: string }} request
   *   type is Electron's resourceType. sourceUrl is the frame that asked (the referrer), pageUrl the tab's page.
   * @returns {null | { response: { cancel: true } | { redirectURL: string }, blocked: boolean }}
   *   null lets it through. `response` is Electron's webRequest answer. `blocked` is false when the only change
   *   is removing tracking parameters from the address, which uBO does not count as a block either.
   */
  check({ url, type, method = "GET", sourceUrl, pageUrl }) {
    const isPage = type === "mainFrame";
    if (this.isPaused(isPage ? url : pageUrl)) return null;
    const result = this.#engine.match(Request.fromRawDetails({ url, type, sourceUrl: isPage ? url : sourceUrl || pageUrl }));
    const cleaned = method === "GET" && result.rewrite && result.rewrite.url !== url ? { response: { redirectURL: result.rewrite.url }, blocked: false } : null;
    if (isPage) return cleaned;
    if (result.redirect) {
      // A harmless stand-in (an empty script, a stub `googletag`, a 1x1 gif) keeps pages that expect the real thing
      // working. Not the data: URL the engine offers: Chromium refuses every redirect to data: (tested on Electron 44).
      const name = result.redirect.filename || result.filter.getRedirectResource(); // the canonical name, not an alias
      return { response: { redirectURL: this.redirectBase + encodeURIComponent(name) }, blocked: true };
    }
    if (result.match) return BLOCK;
    return cleaned;
  }

  /**
   * The body of a `$redirect` stand-in, for whatever serves `redirectBase`. Unknown names get an empty resource of
   * the type their extension suggests, so a page never sees an error where it expected something harmless.
   * @returns {{ contentType: string, body: Buffer | string }}
   */
  redirectResource(name) {
    const { contentType, body } = this.#engine.resources.getResource(String(name));
    if (!contentType.endsWith(";base64")) return { contentType, body };
    return { contentType: contentType.slice(0, -";base64".length), body: Buffer.from(body, "base64") };
  }

  /** A Content-Security-Policy to add to a page or frame (`$csp=` rules), or undefined. */
  csp({ url, type, pageUrl }) {
    const isPage = type === "mainFrame";
    if ((!isPage && type !== "subFrame") || this.isPaused(isPage ? url : pageUrl)) return undefined;
    return this.#engine.getCSPDirectives(Request.fromRawDetails({ url, type, sourceUrl: isPage ? url : pageUrl })) || undefined;
  }

  /**
   * Element hiding and scriptlets for a page. The first call for a page (no `dom`) returns the rules for its
   * hostname; later calls pass the ids, classes and links that appeared in the page and get the generic rules
   * that match them.
   * @returns {null | { styles: string, scripts: string[] }}
   */
  cosmetics(url, dom) {
    if (!/^https?:/i.test(url) || this.isPaused(url)) return null;
    const { hostname, domain } = Request.fromRawDetails({ url, type: "mainFrame" });
    const first = dom == null;
    const { active, styles, scripts } = this.#engine.getCosmeticsFilters({
      url,
      hostname,
      domain,
      classes: strings(dom?.classes),
      hrefs: strings(dom?.hrefs),
      ids: strings(dom?.ids),
      getBaseRules: first,
      getInjectionRules: first,
      getExtendedRules: false,
      getRulesFromHostname: first,
      getRulesFromDOM: !first,
    });
    return active ? { styles, scripts } : null;
  }

  status() {
    const meta = this.#listsBytes ? this.#meta : null;
    return {
      state: this.#updating ? "updating" : meta ? "ready" : "fallback",
      updatedAt: meta?.updatedAt ?? null,
      networkRules: meta?.networkRules ?? 0,
      cosmeticRules: meta?.cosmeticRules ?? 0,
      scriptlets: Boolean(meta?.scriptlets),
      lists: FILTER_LISTS.map(({ id, name }) => ({ id, name, ok: Boolean(meta?.lists.find((l) => l.id === id)?.ok) })),
      myFilters: { ...this.#myFiltersInfo },
      error: this.#error,
    };
  }
}

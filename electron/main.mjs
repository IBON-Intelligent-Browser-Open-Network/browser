import { app, BrowserWindow, WebContentsView, Menu, ipcMain, session, shell, safeStorage, clipboard, crashReporter } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { extractReadable, isTracker } from "./readable.mjs";
import { summarizeDumps } from "./crash-reports.mjs";
import { PermissionManager } from "./permission-manager.mjs";
import { HOME, SEARCH, SEARCH_ENGINE, parseHostsFile, resolveInput } from "./address.mjs";
import { matchShortcut } from "./shortcuts.mjs";
import { buildContextMenuTemplate } from "./context-menu.mjs";
import * as ai from "./ai.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEV_URL = process.env.IBON_DEV_URL;
const BLOCKED_IN_READ_MODE = new Set(["image", "media", "font"]);

// Crash reports: Electron bundles Crashpad, Chromium's crash reporter. Reports stay on this device; nothing
// is uploaded and there is no telemetry. Start it first so every process is covered.
crashReporter.start({ productName: "Ibon", submitURL: "", uploadToServer: false, extra: { ibon_version: app.getVersion() } });
if (process.platform === "win32") app.setAppUserModelId("io.github.faseen6351.ibon");

/** @type {BrowserWindow | null} */
let win = null;
/** @type {Map<number, {view: WebContentsView, readMode: boolean, blocked: number, crashed: string | null}>} */
const tabs = new Map();
let activeId = null;
let nextId = 1;
let bounds = { x: 0, y: 0, width: 0, height: 0 };
let viewVisible = true;

// ---------- settings (JSON in userData; API keys encrypted with the OS keychain) ----------
const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
const defaults = { provider: { id: "ollama", api: "openai", baseUrl: "http://localhost:11434/v1", model: "llama3.1" }, keys: {}, bookmarks: [], webhooks: [] };

function readSettings() {
  try {
    return { ...defaults, ...JSON.parse(fs.readFileSync(settingsFile(), "utf8")) };
  } catch {
    return structuredClone(defaults);
  }
}
function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}
function publicSettings() {
  const s = readSettings();
  return { provider: s.provider, hasKey: Object.fromEntries(Object.keys(s.keys).map((k) => [k, true])), bookmarks: s.bookmarks, webhooks: s.webhooks };
}
function activeProvider() {
  const s = readSettings();
  const enc = s.keys[s.provider.id];
  let apiKey;
  if (enc) {
    try {
      apiKey = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(enc, "base64")) : Buffer.from(enc, "base64").toString("utf8");
    } catch {
      apiKey = undefined;
    }
  }
  return { ...s.provider, apiKey };
}

// ---------- url helpers (the rules live in address.mjs, which is unit-tested) ----------
// Names from the OS hosts file, so `myapp` or `dev.shopfront` typed in the address bar can be a site on this machine.
let hostNames = new Set();
function loadHostsFile() {
  const file = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts") : "/etc/hosts";
  fs.readFile(file, "utf8", (err, contents) => {
    if (!err) hostNames = parseHostsFile(contents);
  });
}
const normalize = (input) => resolveInput(input, { hostNames });
const isWebUrl = (u) => /^https?:\/\//i.test(u);

// ---------- tabs ----------
function tabInfo(id, t) {
  const wc = t.view.webContents;
  return {
    id,
    url: wc.getURL(),
    title: wc.getTitle() || wc.getURL() || "New tab",
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    readMode: t.readMode,
    blocked: t.blocked,
    crashed: t.crashed,
    active: id === activeId,
  };
}
function pushTabs() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("tabs", [...tabs].map(([id, t]) => tabInfo(id, t)));
}
function layoutActive() {
  for (const [id, t] of tabs) {
    const show = id === activeId && viewVisible;
    t.view.setVisible(show);
    if (show) t.view.setBounds(bounds);
  }
}

function createTab(url = HOME, activate = true) {
  const view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const id = nextId++;
  const t = { view, readMode: false, blocked: 0, crashed: null };
  tabs.set(id, t);
  win.contentView.addChildView(view);

  const wc = view.webContents;
  // If this tab's renderer dies, the UI shows a notice until the tab starts loading again. Registered
  // before the pushTabs listeners below so the cleared state is what gets pushed.
  wc.on("render-process-gone", (_e, details) => {
    if (details.reason === "clean-exit") return;
    t.crashed = details.reason;
    permissions.forgetTab(id);
    pushTabs();
  });
  wc.on("did-start-loading", () => {
    t.crashed = null;
  });
  // A new page starts from scratch: whatever the last page was allowed to use is revoked.
  wc.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) permissions.forgetTab(id);
  });
  for (const ev of ["did-start-loading", "did-stop-loading", "page-title-updated", "did-navigate", "did-navigate-in-page"]) wc.on(ev, pushTabs);
  wc.setWindowOpenHandler(({ url: u }) => {
    if (isWebUrl(u)) createTab(u, true);
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, u) => {
    if (!isWebUrl(u)) e.preventDefault();
  });
  watchKeys(wc);
  wc.on("found-in-page", (_e, r) => {
    if (id === activeId && win && !win.isDestroyed()) win.webContents.send("find-result", { active: r.activeMatchOrdinal, matches: r.matches });
  });
  wc.on("context-menu", (_e, params) => showContextMenu(wc, params));
  wc.loadURL(normalize(url)).catch(() => {});
  if (activate) activateTab(id);
  else pushTabs();
  return id;
}

function activateTab(id) {
  if (!tabs.has(id)) return;
  if (id !== activeId) tabs.get(activeId)?.view.webContents.stopFindInPage("clearSelection"); // leave no highlights behind
  activeId = id;
  layoutActive();
  pushTabs();
}

/** URLs of recently closed tabs, newest last, for "reopen closed tab". */
const closedTabs = [];

function closeTab(id) {
  const t = tabs.get(id);
  if (!t) return;
  const url = t.view.webContents.getURL();
  if (isWebUrl(url)) closedTabs.push(url);
  if (closedTabs.length > 20) closedTabs.shift();
  const order = [...tabs.keys()];
  const at = order.indexOf(id);
  permissions.forgetTab(id);
  win.contentView.removeChildView(t.view);
  t.view.webContents.close();
  tabs.delete(id);
  if (activeId === id) {
    // Like every browser: land on the tab that was next to the closed one (the right one, else the left).
    const rest = order.filter((x) => x !== id);
    activeId = rest.length ? rest[Math.min(at, rest.length - 1)] : null;
    if (activeId === null) return void createTab(HOME, true);
  }
  layoutActive();
  pushTabs();
}

function toggleReadMode(on) {
  const t = activeTab();
  if (!t) return;
  t.readMode = on ?? !t.readMode;
  if (t.readMode === false) t.view.webContents.reload();
  pushTabs();
  return t.readMode;
}

// ---------- keyboard shortcuts (the key map lives in shortcuts.mjs, which is unit-tested) ----------
function watchKeys(wc) {
  wc.on("before-input-event", (event, input) => {
    const action = matchShortcut(input);
    if (!action) return;
    event.preventDefault(); // also stops the page and any menu from seeing the key
    runShortcut(action);
  });
}

const ZOOM_STEP = 0.5;
function zoom(wc, change) {
  const next = change === 0 ? 0 : Math.max(-3, Math.min(5, wc.getZoomLevel() + change));
  wc.setZoomLevel(next);
}

function runShortcut(action) {
  const wc = activeTab()?.view.webContents;
  const order = [...tabs.keys()];
  const at = order.indexOf(activeId);
  const goto = (id) => id !== undefined && activateTab(id);
  // Things only the interface can do (it owns the address bar and the find bar).
  const tellUi = (name) => {
    if (!win || win.isDestroyed()) return;
    win.webContents.focus();
    win.webContents.send("shortcut", name);
  };

  if (action.startsWith("select-tab:")) return void goto(order[Number(action.split(":")[1]) - 1]);
  switch (action) {
    case "new-tab":
      createTab(HOME, true);
      return tellUi("focus-address");
    case "close-tab":
      return activeId === null ? undefined : closeTab(activeId);
    case "reopen-tab": {
      const url = closedTabs.pop();
      return url ? void createTab(url, true) : undefined;
    }
    case "next-tab":
      return goto(order[(at + 1) % order.length]);
    case "previous-tab":
      return goto(order[(at - 1 + order.length) % order.length]);
    case "last-tab":
      return goto(order[order.length - 1]);
    case "focus-address":
    case "find":
      return tellUi(action);
    case "reload":
      return wc?.reload();
    case "hard-reload":
      return wc?.reloadIgnoringCache();
    case "back":
      return wc?.navigationHistory.goBack();
    case "forward":
      return wc?.navigationHistory.goForward();
    case "devtools":
      return wc?.toggleDevTools();
    case "zoom-in":
      return wc && zoom(wc, ZOOM_STEP);
    case "zoom-out":
      return wc && zoom(wc, -ZOOM_STEP);
    case "zoom-reset":
      return wc && zoom(wc, 0);
    case "read-mode":
      return void toggleReadMode();
  }
}

// ---------- right-click menu (the items live in context-menu.mjs, which is unit-tested) ----------
function showContextMenu(wc, params) {
  const template = buildContextMenuTemplate(params, {
    openTab: (u) => createTab(u, true),
    copyText: (text) => clipboard.writeText(text),
    search: (text) => createTab(SEARCH + encodeURIComponent(text), true),
    back: () => wc.navigationHistory.goBack(),
    forward: () => wc.navigationHistory.goForward(),
    reload: () => wc.reload(),
    inspect: (x, y) => wc.inspectElement(x, y),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    engineName: SEARCH_ENGINE,
  });
  Menu.buildFromTemplate(template).popup({ window: win ?? undefined });
}

// The default Electron menu gives Ctrl+W (closes the whole window, every tab), Ctrl+R (reloads Ibon's own
// interface instead of the page) and Ctrl+Shift+I (developer tools for the interface). Replace it. Windows and
// Linux need no menu; macOS needs the Edit menu or copy and paste stop working.
function installAppMenu() {
  if (process.platform === "darwin") {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }] }]));
  } else {
    Menu.setApplicationMenu(null);
  }
}

const activeTab = () => (activeId != null ? tabs.get(activeId) : undefined);

async function readActivePage() {
  const t = activeTab();
  if (!t) throw new Error("No active tab");
  const wc = t.view.webContents;
  const html = await wc.executeJavaScript("document.documentElement.outerHTML");
  return extractReadable(html, wc.getURL());
}

// ---------- request filtering: trackers always, heavy media in Read Mode ----------
function installFilters() {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    // Never filter Chromium's own pages, such as the built-in PDF viewer (chrome-extension://) and DevTools.
    if (details.url.startsWith("chrome-extension://") || details.url.startsWith("devtools://")) return cb({});
    let tab;
    for (const t of tabs.values()) if (t.view.webContents.id === details.webContentsId) tab = t;
    const block = (tab && tab.readMode && BLOCKED_IN_READ_MODE.has(details.resourceType)) || (tab && isTracker(details.url));
    if (block && tab) tab.blocked++;
    cb({ cancel: Boolean(block) });
  });
}

// ---------- permissions: ask per site, allow for this page only (see permission-manager.mjs) ----------
const permissions = new PermissionManager({ onChange: pushPermissions });

function pushPermissions() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send("permissions", permissions.snapshot());
}

function tabIdOf(webContents) {
  if (!webContents) return null;
  for (const [id, t] of tabs) if (t.view.webContents === webContents) return id;
  return null; // not a page tab (the Ibon interface itself needs no permissions)
}

function installPermissionPolicy() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    const tabId = tabIdOf(wc);
    if (tabId === null) return callback(false);
    let origin = null;
    try {
      origin = new URL(details.requestingUrl).origin;
    } catch {
      /* no usable origin: the manager refuses it */
    }
    permissions.request({ tabId, origin, permission, mediaTypes: details.mediaTypes, isMainFrame: details.isMainFrame, respond: callback });
  });
  ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
    // wc is null when Chromium checks without a page (for example before showing a notification).
    const tabId = tabIdOf(wc);
    if (wc && tabId === null) return false; // the Ibon interface itself
    return permissions.check({ tabId, origin: requestingOrigin, permission, mediaType: details.mediaType, isMainFrame: details.isMainFrame, embeddingOrigin: details.embeddingOrigin });
  });
}

// ---------- IPC ----------
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (!win || event.sender !== win.webContents) throw new Error("Untrusted sender");
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function registerIpc() {
  handle("tab:create", (url) => createTab(url ?? HOME, true));
  handle("tab:close", (id) => closeTab(id));
  handle("tab:activate", (id) => activateTab(id));
  handle("tab:navigate", (url) => activeTab()?.view.webContents.loadURL(normalize(url)).catch(() => {}));
  handle("tab:back", () => activeTab()?.view.webContents.navigationHistory.goBack());
  handle("tab:forward", () => activeTab()?.view.webContents.navigationHistory.goForward());
  handle("tab:reload", () => activeTab()?.view.webContents.reload());
  handle("tab:devtools", () => activeTab()?.view.webContents.toggleDevTools());
  handle("tab:readMode", (on) => toggleReadMode(on));
  // newSession: true when the text changed (start a fresh search), false to step to the next or previous match.
  // Electron names the same flag `findNext` but with the opposite sense: findNext:true means "begin a new search".
  handle("find:run", (text, forward = true, newSession = true) => {
    const wc = activeTab()?.view.webContents;
    if (!wc) return;
    const query = String(text ?? "");
    if (!query) {
      wc.stopFindInPage("clearSelection");
      return win?.webContents.send("find-result", { active: 0, matches: 0 });
    }
    wc.findInPage(query, { forward: Boolean(forward), findNext: Boolean(newSession) });
  });
  handle("find:stop", () => {
    const wc = activeTab()?.view.webContents;
    wc?.stopFindInPage("clearSelection");
    wc?.focus(); // give the page its keyboard back
  });
  handle("view:layout", (b, visible) => {
    bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.max(0, Math.round(b.width)), height: Math.max(0, Math.round(b.height)) };
    viewVisible = visible !== false;
    layoutActive();
  });
  handle("page:read", () => readActivePage());
  handle("clipboard:write", (text) => clipboard.writeText(String(text)));

  handle("permission:list", () => permissions.snapshot());
  handle("permission:respond", (id, allow) => permissions.resolve(Number(id), Boolean(allow)));

  handle("app:info", () => ({ version: app.getVersion(), electron: process.versions.electron, chromium: process.versions.chrome, platform: process.platform }));
  handle("crash:info", () => summarizeDumps(app.getPath("crashDumps")));
  handle("crash:open", async () => {
    const dir = app.getPath("crashDumps");
    fs.mkdirSync(dir, { recursive: true });
    const err = await shell.openPath(dir);
    if (err) throw new Error(err);
  });

  handle("settings:get", () => publicSettings());
  handle("settings:set", (patch) => {
    const s = readSettings();
    for (const k of ["provider", "bookmarks", "webhooks"]) if (patch[k] !== undefined) s[k] = patch[k];
    writeSettings(s);
    return publicSettings();
  });
  handle("settings:setKey", (id, key) => {
    const s = readSettings();
    if (!key) delete s.keys[id];
    else s.keys[id] = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, "utf8")).toString("base64");
    writeSettings(s);
    return publicSettings();
  });

  handle("ai:chat", async (messages, withPage) => ai.chat(activeProvider(), { messages, pageContext: withPage ? await readActivePage() : undefined }));
  handle("ai:summarize", async (length) => {
    const page = await readActivePage();
    const summary = await ai.summarize(activeProvider(), { text: page.text, title: page.title, length });
    return { summary, page };
  });

  handle("dev:netTool", async (tool, hostInput) => {
    const host = String(hostInput).replace(/^https?:\/\//, "").split("/")[0];
    if (!/^[\w.-]+$/.test(host)) throw new Error("Invalid host");
    if (tool === "dns") {
      const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`, { signal: AbortSignal.timeout(8000) });
      return (await r.json()).Answer ?? [];
    }
    if (tool === "headers") {
      const r = await fetch(`https://${host}`, { method: "HEAD", signal: AbortSignal.timeout(8000) });
      return { status: r.status, headers: Object.fromEntries(r.headers) };
    }
    if (tool === "ping") {
      const started = Date.now();
      try {
        await fetch(`https://${host}`, { method: "HEAD", signal: AbortSignal.timeout(6000) });
        return { host, reachable: true, ms: Date.now() - started };
      } catch {
        return { host, reachable: false, ms: Date.now() - started };
      }
    }
    if (tool === "rdap") {
      const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(10000) });
      return await r.json();
    }
    throw new Error("Unknown tool");
  });
  handle("dev:webhook", async (url, payload) => {
    if (!isWebUrl(url)) throw new Error("Webhook URL must be http(s)");
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload ?? {}), signal: AbortSignal.timeout(12000) });
    return { ok: r.ok, status: r.status };
  });
}

// ---------- window ----------
function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    title: "Ibon",
    icon: path.join(__dirname, "..", "build", "icon.png"),
    backgroundColor: "#0f1115",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  win.setMenuBarVisibility(false);
  watchKeys(win.webContents); // shortcuts work while the address bar or sidebar has the keyboard too
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  win.webContents.once("did-finish-load", () => createTab(HOME, true));
  win.on("closed", () => {
    win = null;
    tabs.clear();
  });
}

app.whenReady().then(() => {
  installAppMenu();
  loadHostsFile();
  installPermissionPolicy();
  installFilters();
  registerIpc();
  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
// GPU and utility processes are restarted by Chromium on its own; just leave a trace for bug reports.
app.on("child-process-gone", (_e, d) => console.warn(`[ibon] ${d.type} process gone: ${d.reason} (exit ${d.exitCode})`));

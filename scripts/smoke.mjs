// End-to-end smoke test of the real app. No test framework: it launches Ibon with a throwaway profile and a
// loopback-only debugging port, then drives it over the Chrome DevTools Protocol using Node built-ins.
//
//   npm run build && npm run smoke                       # unpackaged app
//   IBON_EXE=release/win-unpacked/Ibon.exe npm run smoke # a packaged build
//   SMOKE_OUT=./shots npm run smoke                      # also save screenshots
//
// Checks: the app starts, the UI renders, a crashed tab shows the recovery notice and leaves a local Crashpad
// report (never uploaded), Reload recovers it, ad blocking works and can be paused per site, and PDFs open in
// Chromium's built-in (PDFium) viewer. The run never downloads filter lists, so it needs no network.
import { spawn, execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shotDir = process.env.SMOKE_OUT ? path.resolve(process.env.SMOKE_OUT) : null;
if (shotDir) fs.mkdirSync(shotDir, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MOD = process.platform === "darwin" ? "meta" : "ctrl"; // the main shortcut key on this OS

/** Sends a real key press to a page over the DevTools Protocol, like "ctrl+shift+t" or "Enter". */
async function press(c, combo) {
  const parts = combo.split("+");
  const k = parts.pop();
  const has = (m) => parts.includes(m);
  const modifiers = (has("alt") ? 1 : 0) | (has("ctrl") ? 2 : 0) | (has("meta") ? 4 : 0) | (has("shift") ? 8 : 0);
  const named = { Tab: 9, Enter: 13, Escape: 27 };
  const vk = named[k] ?? k.toUpperCase().charCodeAt(0);
  const base = { modifiers, key: k.length === 1 && has("shift") ? k.toUpperCase() : k, code: k.length === 1 ? "Key" + k.toUpperCase() : k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  await c.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}
async function until(fn, ms = 20000, step = 300) {
  const end = Date.now() + ms;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* keep polling */
    }
    if (Date.now() > end) return null;
    await sleep(step);
  }
}
const freePort = () =>
  new Promise((resolve) => {
    const s = net.createServer().listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });

function cdp(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send: (method, params = {}) =>
          new Promise((ok, ko) => {
            const i = ++id;
            pending.set(i, { ok, ko });
            ws.send(JSON.stringify({ id: i, method, params }));
          }),
        close: () => ws.close(),
      });
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.ko(new Error(m.error.message));
        else p.ok(m.result);
      }
    };
    ws.onerror = reject;
  });
}
const evaluate = async (c, expression) =>
  (await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;
const shot = async (c, name) => {
  if (!shotDir) return;
  const r = await c.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(shotDir, name), Buffer.from(r.data, "base64"));
};

// A one-page PDF built by hand so the test needs no fixtures.
function makePdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
  ];
  const stream = `BT /F1 28 Tf 30 100 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let out = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
const pdf = makePdf("Ibon smoke test PDF");
let adHits = 0; // how often the "ad" script reached the server
const server = http.createServer((req, res) => {
  if (req.url.startsWith("/ad-script.js")) {
    adHits++;
    res.writeHead(200, { "Content-Type": "text/javascript" });
    res.end("window.__adLoaded = true;");
  } else if (req.url.startsWith("/ads.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end('<!doctype html><title>Ibon blocking page</title><div class="ad-banner">ad</div><p id="content">article</p><script src="/ad-script.js"></script><script>window.__adLoaded = window.__adLoaded || false;</script>');
  } else if (req.url.endsWith(".pdf")) {
    res.writeHead(200, { "Content-Type": "application/pdf" });
    res.end(pdf);
  } else {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<!doctype html><title>Ibon smoke page</title><h1>hello</h1><p>needle one</p><p>needle two</p><p>needle three</p>");
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const port = await freePort();
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ibon-smoke-"));
// Windows treats a window hidden behind other windows as invisible and throttles it, which delays find-in-page and
// painting. Tests must not depend on what else is on the desktop.
const args = [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "--disable-features=CalculateNativeWinOcclusion", "--disable-backgrounding-occluded-windows"];
if (process.platform === "linux" && process.env.CI) args.push("--no-sandbox"); // CI containers cannot set up the SUID sandbox
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE; // set by some editors' terminals; would run Electron as plain Node
env.IBON_NO_FILTER_DOWNLOAD = "1"; // no filter-list downloads: the blocking checks use My filters instead
const exe = process.env.IBON_EXE ? path.resolve(process.env.IBON_EXE) : null;
const child = exe
  ? spawn(exe, args, { env, stdio: "ignore" })
  : spawn(createRequire(path.join(root, "package.json"))("electron"), [".", ...args], { cwd: root, env, stdio: "ignore" });
console.log(exe ? `Launching packaged build: ${exe}` : "Launching unpackaged app (npm run build first)");

const targets = async () => (await fetch(`http://127.0.0.1:${port}/json`)).json();
// Resolve symlinks and 8.3 short names first: macOS temp folders live under /var, which is really /private/var,
// and Windows CI reports C:\Users\RUNNER~1. Without this a correct report location looks wrong.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
const samePath = (a, b) => real(a).toLowerCase().startsWith(real(b).toLowerCase());
let ui;
try {
  const uiTarget = await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith("file:")), 40000);
  check("app starts and the UI loads", Boolean(uiTarget));
  ui = await cdp(uiTarget.webSocketDebuggerUrl);
  check("brand mark renders", Boolean(await until(() => evaluate(ui, "(() => { const i = document.querySelector('img.brand'); return !!i && i.complete && i.naturalWidth > 0; })()"), 10000)));
  await shot(ui, "ui.png");

  // The address bar. Typing a bare dev address (no scheme) must open it over http; it used to become https and fail.
  const hostPort = base.replace("http://", ""); // like "127.0.0.1:54595"
  await evaluate(ui, `window.ibon.invoke('tab:navigate', '${hostPort}/page.html')`);
  const tab = await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(base) && t.title === "Ibon smoke page"), 20000);
  check("a tab loads a page", Boolean(tab));

  // ---- Keyboard shortcuts, sent as real key presses. (Regression: with Electron's default menu, Ctrl+W closed the
  // whole window, Ctrl+R reloaded Ibon's own interface, and there was no Ctrl+T, Ctrl+L, Ctrl+F or Ctrl+Tab.)
  const tabCount = () => evaluate(ui, "document.querySelectorAll('.tab').length");
  const activeTabUrl = () => evaluate(ui, "document.querySelector('.tab.active')?.getAttribute('title') || ''");
  const waitFor = (fn, ms = 10000) => until(async () => ((await fn()) ? true : null), ms);
  const n0 = await tabCount();
  await press(ui, `${MOD}+t`);
  check("Ctrl/Cmd+T opens a new tab", Boolean(await waitFor(async () => (await tabCount()) === n0 + 1)));
  check("and puts the cursor in the address bar", Boolean(await waitFor(() => evaluate(ui, "document.activeElement === document.querySelector('.address')"))));
  await evaluate(ui, `window.ibon.invoke('tab:navigate', '${hostPort}/page.html?second')`);
  await waitFor(async () => (await targets()).some((t) => t.type === "page" && t.url.endsWith("?second") && t.title === "Ibon smoke page"), 20000);
  await press(ui, "ctrl+Tab");
  check("Ctrl+Tab goes to the next tab (wrapping round)", Boolean(await waitFor(async () => { const u = await activeTabUrl(); return u.endsWith("/page.html") && !u.includes("second"); })));
  await press(ui, "ctrl+shift+Tab");
  check("Ctrl+Shift+Tab goes back", Boolean(await waitFor(async () => (await activeTabUrl()).includes("second"))));
  await press(ui, `${MOD}+w`);
  check("Ctrl/Cmd+W closes just that tab, and the neighbour takes over", Boolean(await waitFor(async () => (await tabCount()) === n0 && (await activeTabUrl()).endsWith("/page.html"))));
  check("the browser is still running", (await targets()).some((t) => t.type === "page" && t.url.startsWith("file:")));
  await press(ui, `${MOD}+shift+t`);
  check("Ctrl/Cmd+Shift+T reopens the closed tab at its address", Boolean(await waitFor(async () => (await tabCount()) === n0 + 1 && (await activeTabUrl()).includes("?second"))));
  await press(ui, `${MOD}+w`);
  await waitFor(async () => (await tabCount()) === n0 && (await activeTabUrl()).endsWith("/page.html"));

  // ---- Find in page.
  await press(ui, `${MOD}+f`);
  check("Ctrl/Cmd+F opens the find bar with the cursor in it", Boolean(await waitFor(() => evaluate(ui, "document.activeElement === document.querySelector('.find-input')"))));
  await ui.send("Input.insertText", { text: "needle" });
  const findStatus = () => evaluate(ui, "document.querySelector('.find-status')?.textContent || ''");
  check("it counts the matches on the page", Boolean(await waitFor(async () => (await findStatus()) === "1 of 3")), await findStatus());
  await shot(ui, "find-bar.png");
  await press(ui, "Enter");
  check("Enter moves to the next match", Boolean(await waitFor(async () => (await findStatus()) === "2 of 3")), await findStatus());
  await press(ui, "shift+Enter");
  check("Shift+Enter moves back", Boolean(await waitFor(async () => (await findStatus()) === "1 of 3")), await findStatus());
  await ui.send("Input.insertText", { text: "zzz" });
  check("no matches says so", Boolean(await waitFor(async () => (await findStatus()) === "No matches")), await findStatus());
  await press(ui, "Escape");
  check("Esc closes the find bar", Boolean(await waitFor(() => evaluate(ui, "!document.querySelector('.findbar')"))));

  // ---- Permissions. A page must not get the camera, microphone, location, notifications or clipboard contents
  // without the user saying yes. (Regression: Electron grants every request unless the app installs a handler.)
  // Only notifications are ever ALLOWED here, and camera plus microphone are only ever BLOCKED, so the test
  // never opens a real device.
  const inTab = async (expression) => {
    const c = await cdp(tab.webSocketDebuggerUrl);
    try {
      const r = await c.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
      return r.exceptionDetails ? `THROWN: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}` : r.result.value;
    } finally {
      c.close();
    }
  };
  const bar = () => evaluate(ui, "document.querySelector('.permbar')?.textContent || ''");
  const clickBar = (label) => evaluate(ui, `[...document.querySelectorAll('.permbar button')].find((b) => b.textContent === '${label}')?.click()`);

  const states = JSON.parse(
    await inTab(`(async () => {
      const out = {};
      for (const name of ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read']) {
        try { out[name] = (await navigator.permissions.query({ name })).state; } catch { out[name] = 'unsupported'; }
      }
      return JSON.stringify(out);
    })()`),
  );
  const granted = Object.entries(states).filter(([, v]) => v === "granted").map(([k]) => k);
  check("nothing sensitive is granted before the user answers", granted.length === 0, granted.length ? `granted without asking: ${granted.join(", ")}` : "none granted");

  await inTab("window.__ask = Notification.requestPermission(); 1");
  const noticeBar = await until(async () => ((await bar()).includes("wants to show notifications") ? await bar() : ""), 10000);
  check("a notification request shows an Allow / Block bar naming the site", Boolean(noticeBar), noticeBar || "no bar");
  await shot(ui, "permission-bar.png");
  await clickBar("Block");
  check("Block refuses the request", (await inTab("window.__ask")) === "denied");
  check("the bar goes away", (await bar()) === "");
  await inTab("window.__ask = Notification.requestPermission(); 1");
  check("a blocked site is refused again without nagging", (await inTab("window.__ask")) === "denied" && (await bar()) === "");

  const camera = await inTab("window.__cam = navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(() => 'opened', (e) => e.name); 1");
  const cameraBar = await until(async () => ((await bar()).includes("camera and microphone") ? await bar() : ""), 10000);
  check("a camera and microphone request asks first", Boolean(cameraBar) && camera === 1, cameraBar || "no bar");
  await clickBar("Block");
  check("blocking camera and microphone refuses it", (await inTab("window.__cam")) === "NotAllowedError");

  // A page that changes starts from scratch, so the earlier Block no longer applies. Allow notifications this time.
  await evaluate(ui, "window.ibon.invoke('tab:reload')");
  await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(base) && t.title === "Ibon smoke page"), 20000);
  await sleep(500);
  await inTab("window.__ask = Notification.requestPermission(); 1");
  check("after reloading, the site can ask afresh", Boolean(await until(async () => ((await bar()).includes("wants to show notifications") ? "yes" : ""), 10000)));
  await clickBar("Allow");
  check("Allow grants it", (await inTab("window.__ask")) === "granted");
  check("the page now sees the grant", (await inTab("Notification.permission")) === "granted");
  await evaluate(ui, "window.ibon.invoke('tab:reload')");
  await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(base) && t.title === "Ibon smoke page"), 20000);
  await sleep(500);
  check("the grant is revoked when the page changes", (await inTab("Notification.permission")) !== "granted");

  const before = await evaluate(ui, "window.ibon.invoke('crash:info')");
  const tabSession = await cdp(tab.webSocketDebuggerUrl);
  tabSession.send("Page.crash").catch(() => {}); // kills this tab's renderer process on purpose
  const notice = await until(() => evaluate(ui, "document.querySelector('.crash h1')?.textContent || ''"), 20000);
  check("a crashed tab shows the recovery notice", notice === "This tab stopped working", notice || "no notice");
  check("the tab strip survives", (await evaluate(ui, "document.querySelectorAll('.tab').length")) >= 1);
  await shot(ui, "crash-notice.png");
  const info = await until(async () => {
    const i = await evaluate(ui, "window.ibon.invoke('crash:info')");
    return i.count > before.count ? i : null;
  }, 20000);
  check("Crashpad leaves a local crash report", Boolean(info), info ? `${info.count} report, ${info.bytes} bytes` : "none written");
  check("the report is kept inside the profile, nothing is uploaded", Boolean(info) && samePath(info.dir, profile), info?.dir);

  await evaluate(ui, "document.querySelector('.crash button')?.click()");
  check("Reload clears the notice", Boolean(await until(async () => (await evaluate(ui, "!document.querySelector('.crash')")) || null, 20000)));
  check("the page comes back", Boolean(await until(async () => (await targets()).find((t) => t.type === "page" && t.url.startsWith(base) && t.title === "Ibon smoke page"), 20000)));

  // The sidebar panels must survive being used. (Regression: an effect returning scrollIntoView()'s Promise
  // blanked the whole UI on Chromium 152 as soon as the Assistant re-rendered or unmounted.)
  const rootChildren = () => evaluate(ui, "document.getElementById('root').children.length");
  await evaluate(ui, "[...document.querySelectorAll('.pill')].find((b) => b.textContent.startsWith('Summarize'))?.click()");
  await sleep(2500); // no LLM is configured, so this ends in an error message; it must not take the UI down
  check("the Assistant survives a request", (await rootChildren()) > 0 && Boolean(await evaluate(ui, "!!document.querySelector('.assistant')")));
  await evaluate(ui, "[...document.querySelectorAll('.sidebar-tabs button')].find((b) => b.textContent === 'Dev tools').click()");
  await sleep(800);
  check("the Dev tools panel opens", Boolean(await evaluate(ui, "!!document.querySelector('.tools')")) && (await rootChildren()) > 0);
  await evaluate(ui, "[...document.querySelectorAll('.sidebar-tabs button')].find((b) => b.textContent === 'Settings').click()");
  await sleep(800);
  check("the Settings panel opens and shows diagnostics", Boolean(await until(() => evaluate(ui, "document.body.innerText.includes('Diagnostics') && document.body.innerText.includes('Ibon 0.')"), 8000)));
  await shot(ui, "settings.png");

  // ---- Ad and tracker blocking. Rules typed into My filters (uBlock Origin syntax) go through the same engine,
  // request filter and page-side element hiding as the downloaded lists do.
  await evaluate(ui, "[...document.querySelectorAll('.sidebar-tabs button')].find((b) => b.textContent === 'Blocking').click()");
  check("the Blocking panel opens", Boolean(await until(() => evaluate(ui, "!!document.querySelector('.blocking .filters')"), 8000)));
  const rules = ["/ad-script.js$script", "##.ad-banner"].join("\n"); // block a script, hide an element
  const myFilters = await evaluate(ui, `window.ibon.invoke('blocker:setFilters', ${JSON.stringify(rules)})`);
  check("My filters take uBlock Origin syntax", myFilters.myFilters.rules === 2, JSON.stringify(myFilters.myFilters));
  await evaluate(ui, `window.ibon.invoke('tab:navigate', '${base}/ads.html')`);
  const adsTab = await until(async () => (await targets()).find((t) => t.type === "page" && t.url === `${base}/ads.html` && t.title === "Ibon blocking page"), 20000);
  const inAds = async (expression) => {
    const c = await cdp(adsTab.webSocketDebuggerUrl);
    try {
      return (await c.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    } finally {
      c.close();
    }
  };
  const bannerHidden = () => inAds("getComputedStyle(document.querySelector('.ad-banner')).display === 'none'");
  check("element hiding hides the ad", Boolean(await waitFor(bannerHidden)));
  check("a blocked script never reaches the server", adHits === 0 && (await inAds("window.__adLoaded")) === false, `${adHits} requests`);
  check("the page's own content stays", (await inAds("getComputedStyle(document.querySelector('#content')).display")) !== "none");
  check("the toolbar counts what was blocked", Boolean(await waitFor(async () => /^\s*[1-9]/.test(await evaluate(ui, "document.querySelector('.shield')?.textContent || ''")))));
  await shot(ui, "blocking.png");
  await evaluate(ui, "document.querySelector('.site-card button').click()"); // Pause blocking on this site
  check("pausing a site reloads it with nothing blocked", Boolean(await waitFor(async () => adHits > 0 && !(await bannerHidden()), 15000)), `${adHits} requests`);
  check("the toolbar shows blocking paused", String(await evaluate(ui, "document.querySelector('.shield')?.getAttribute('aria-label')")).includes("paused"));
  await evaluate(ui, "document.querySelector('.site-card button').click()"); // and resume
  check("resuming blocks again", Boolean(await waitFor(bannerHidden, 15000)));

  await evaluate(ui, `window.ibon.invoke('tab:navigate', '${base}/doc.pdf')`);
  const pdfTab = await until(async () => (await targets()).find((t) => t.url === `${base}/doc.pdf`), 20000);
  check("a PDF opens in a tab", Boolean(pdfTab));
  const viewer = await until(async () => (await targets()).find((t) => t.url.startsWith("chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai")), 20000);
  check("Chromium's built-in PDF viewer renders it", Boolean(viewer));
  if (pdfTab && shotDir) {
    const pc = await cdp(pdfTab.webSocketDebuggerUrl);
    await sleep(1500);
    await shot(pc, "pdf.png");
    pc.close();
  }
} catch (e) {
  check("smoke test ran without an error", false, String(e && e.message ? e.message : e));
} finally {
  try { ui?.close(); } catch { /* already closed */ }
  server.close();
  try {
    if (process.platform === "win32") execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
    else child.kill("SIGKILL");
  } catch { /* already gone */ }
  // Report first: tidying the profile must never hide the result (Windows can keep the folder locked for a moment).
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} of ${results.length} checks FAILED` : `\nall ${results.length} checks passed`);
  await sleep(500);
  try {
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* leftover temp folder; the OS cleans it eventually */ }
  process.exit(failed ? 1 : 0);
}

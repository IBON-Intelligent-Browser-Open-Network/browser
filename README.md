<p align="center">
  <img src="assets/brand/ibon-typeface.svg" alt="Ibon" width="340">
</p>

<p align="center">
  <b>Intelligent Browser Open Network</b><br>
  A light, open-source browser for developers: real Chromium, uBlock Origin's filter lists built in,<br>
  a small hackable interface, and an assistant that works with whichever LLM you choose.
</p>

<p align="center">
  <a href="https://github.com/faseen6351/Ibon/releases"><img alt="Release" src="https://img.shields.io/github/v/release/faseen6351/Ibon?include_prereleases&color=9d00ff"></a>
  <a href="https://github.com/faseen6351/Ibon/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/faseen6351/Ibon/ci.yml?branch=main&label=CI"></a>
  <a href="LICENSE"><img alt="License: BSD-3-Clause" src="https://img.shields.io/badge/license-BSD--3--Clause-9d00ff"></a>
  <img alt="Built with Electron 44" src="https://img.shields.io/badge/Electron-44-47848f?logo=electron&logoColor=white">
  <img alt="Chromium 152" src="https://img.shields.io/badge/Chromium-152-4285f4">
  <img alt="Ad blocking: uBlock Origin lists" src="https://img.shields.io/badge/ad%20blocking-uBlock%20Origin%20lists-800000?logo=ublockorigin&logoColor=white">
  <a href="CONTRIBUTING.md"><img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-9d00ff"></a>
</p>

<p align="center">
  <a href="#whats-new">What's new</a> ·
  <a href="#download">Download</a> ·
  <a href="#features">Features</a> ·
  <a href="#ad-and-tracker-blocking">Ad blocking</a> ·
  <a href="#connect-an-llm-optional">LLM setup</a> ·
  <a href="#tech-stack">Tech stack</a> ·
  <a href="#build-from-source">Build from source</a> ·
  <a href="tasks.md">Roadmap</a> ·
  <a href="CONTRIBUTING.md">Contribute</a>
</p>

<p align="center">
  <img src="docs/assets/screenshot-browse.png" alt="Ibon on Google's home page, with the shield counting blocked requests and the Assistant panel open" width="900">
</p>

> **Status: version 0.0.1, a first alpha.** It runs, it is tested on Windows, and it is useful, but it is early. Read
> [Known limitations](#known-limitations) before relying on it. Each crucial update bumps the version.
> [What's new](#whats-new) lists what `main` has gained since 0.0.1 and will ship in the next release.

## Why Ibon

- **Light by design.** No account, no sync service, no bundled extras. The interface is a small React app you can read in an afternoon.
- **Real Chromium.** Pages render in the same engine as Chrome and Edge, through Electron, with the built-in DevTools and PDF viewer.
- **Save data and tokens.** A per-tab **Read mode** blocks images, media and fonts and gives you clean text, which is also the cheapest thing to hand to an LLM.
- **Bring your own LLM, or none.** Everything works without AI. If you want it, connect ChatGPT, Claude, Grok, DeepSeek, Kimi, GLM, a local Ollama model, or any OpenAI-compatible endpoint.
- **Built for developers.** DNS, response-header, ping and whois lookups for the current site, and a one-click webhook for sending a page's text to n8n, Zapier or your own service.
- **Private by default.** Ads and trackers are blocked with uBlock Origin's filter lists, nothing phones home, and crash reports stay on your computer.
- **Open.** BSD-3-Clause. Fork it, change it, ship it.

## What's new

On `main` since 0.0.1, coming in the next release:

- **Ad and tracker blocking with uBlock Origin's filter lists.** About 170,000 rules from uBO's default lists, updated
  daily: blocked requests, hidden ad slots, scriptlets, and stand-ins that keep pages working. A shield next to the
  address bar counts what was blocked; the new **Blocking** panel pauses it per site and takes your own rules in uBO
  syntax. [More below](#ad-and-tracker-blocking).
- **Google is the default search engine**, for the address bar and for "Search Google for …" in the right-click menu.
- **An address bar that knows developer addresses.** `localhost:3000`, IP addresses, `[::1]:5173`, `*.local`, `*.test`
  and names from your hosts file open over http; real domains open over https; `package.json` or a question is a search.
- **Keyboard shortcuts, find in page and a right-click menu.** Ctrl+W no longer closes the whole window, Ctrl+R reloads
  the page rather than Ibon itself, and Ctrl+T, Ctrl+L, Ctrl+F and Ctrl+Tab work. See [the shortcut list](#keyboard-shortcuts).
- **Per-site permission prompts.** A site that asks for the camera, microphone or notifications gets an **Allow / Block**
  bar instead of a silent refusal.
- **Licence notices ship with the app**, and Ibon's own licence names the right copyright holder.

0.0.1 brought the Windows, macOS and Linux installers, crash recovery, the PDF viewer and default-deny permissions; see
the [release notes](https://github.com/faseen6351/Ibon/releases).

## Download

Installers are attached to each [release](https://github.com/faseen6351/Ibon/releases).

| OS | Download | Notes |
| --- | --- | --- |
| **Windows** 10 or 11, 64-bit | `Ibon-<version>-win-x64-setup.exe` (installer) or `Ibon-<version>-win-x64.zip` (portable) | Tested. Installs for your user only, no administrator rights needed. |
| **macOS** 13 or later | `Ibon-<version>-mac-arm64.dmg` (Apple silicon) or `Ibon-<version>-mac-x64.dmg` (Intel) | Built and checked by automated tests on every release, not yet tried by hand. |
| **Linux** 64-bit | `Ibon-<version>-linux-x86_64.AppImage` or `Ibon-<version>-linux-amd64.deb` | Built and checked by automated tests on every release, not yet tried by hand. If the AppImage will not start on a distribution that restricts unprivileged user namespaces, use the `.deb`. |

**These builds are not code-signed yet**, so your OS will warn you the first time:

- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then **Run anyway**.
- **macOS:** Gatekeeper says the app cannot be opened. Right-click Ibon, choose **Open**, then confirm. If macOS says the app is "damaged", run `xattr -cr /Applications/Ibon.app` once.

Signing is on the [roadmap](tasks.md). Until then you can compare the file you downloaded with the one attached to the release, or [build it yourself](#build-from-source).

## Features

| Area | What you get |
| --- | --- |
| **Browsing** | Tabs, back, forward, reload, Chromium DevTools. The address bar knows `localhost:3000`, IP addresses, `[::1]`, `*.local` and `*.test` are dev servers (opened over http), real domains open over https, and anything else (`package.json`, a question) is a Google search |
| **Find and shortcuts** | Find in page with match count, a right-click menu (open link in new tab, copy link, search for selection, Inspect), and the usual browser shortcuts, see below |
| **PDFs** | Chromium's built-in PDF viewer (PDFium): thumbnails, zoom, rotate, annotate, download, print |
| **Read mode** | Text-only loading per tab, a clean reader view, word count, page size and blocked-request count |
| **Ad and tracker blocking** | uBlock Origin's default filter lists, updated daily: blocked requests, hidden ad slots, uBO scriptlets and stand-ins that keep pages working. A shield in the toolbar counts what was blocked on the page; pause it per site or add your own rules in uBO syntax. [Details](#ad-and-tracker-blocking) |
| **Privacy** | No telemetry, no account, nothing sent anywhere you did not ask for |
| **Assistant** | Ask about the current page, summarise it (short, medium or detailed), and let it open URLs, toggle Read mode or copy the page text |
| **Dev tools panel** | DNS, response headers, ping and whois (RDAP) for the current host; send a page's readable text to any webhook |
| **Resilience** | A crashed tab shows a notice with **Reload tab** while your other tabs keep working; crash reports are kept locally ([details](docs/crash-reports.md)) |
| **Security basics** | Sandboxed page views, context isolation, only `http` and `https` navigation, camera, microphone and notifications only after you click Allow (and only for that page), location and clipboard reads always denied, API keys encrypted with your OS keychain |

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshot-devtools.png" alt="The Dev tools panel showing response headers for the current site"><br><sub><b>Dev tools panel:</b> response headers, DNS, ping and whois for the current site.</sub></td>
    <td width="50%"><img src="docs/assets/screenshot-readmode.png" alt="Read mode showing a clean text view of a page"><br><sub><b>Read mode:</b> clean text with word count, page size and blocked requests.</sub></td>
  </tr>
</table>

## Keyboard shortcuts

| Action | Windows / Linux | macOS |
| --- | --- | --- |
| New tab, close tab, reopen closed tab | Ctrl+T, Ctrl+W, Ctrl+Shift+T | Cmd+T, Cmd+W, Cmd+Shift+T |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Go to tab 1–8, last tab | Ctrl+1–8, Ctrl+9 | Cmd+1–8, Cmd+9 |
| Address bar | Ctrl+L, Alt+D, F6 | Cmd+L |
| Back / forward | Alt+Left / Alt+Right | Cmd+[ / Cmd+] |
| Reload / hard reload | Ctrl+R or F5 / Ctrl+Shift+R | Cmd+R / Cmd+Shift+R |
| Find in page | Ctrl+F | Cmd+F |
| Zoom in / out / reset | Ctrl+= / Ctrl+- / Ctrl+0 | Cmd+= / Cmd+- / Cmd+0 |
| Read mode | Ctrl+Alt+R | Cmd+Alt+R |
| Developer tools | F12 or Ctrl+Shift+I | F12 or Cmd+Alt+I |

## Ad and tracker blocking

Ibon blocks ads and trackers with the filter lists [uBlock Origin](https://github.com/gorhill/uBlock) turns on out of
the box: uBlock filters (Ads, Badware risks, Privacy, Unbreak, Quick fixes), EasyList, EasyPrivacy and the Online
Malicious URL Blocklist, about 170,000 rules. They are downloaded from uBO's own servers on first run and refreshed
daily. Until the first download finishes (or if you are offline) a small built-in tracker list stands in.

- **The shield** next to the address bar shows how many requests were blocked on the page. Click it for the
  **Blocking** panel.
- **Pause blocking on this site** is uBO's power button: the page reloads with nothing blocked. Paused sites are listed
  in the panel, and pausing `example.com` covers its subdomains.
- **My filters** takes rules in uBO syntax, one per line: `||ads.example.com^` blocks a server, `example.com##.banner`
  hides an element, `example.com##+js(set-constant, adsEnabled, false)` runs a scriptlet, and `@@` makes an exception
  that overrides the lists.
- Pages themselves are never blocked, only what they load. uBO's `$redirect` rules swap a script such as Google
  Analytics for a harmless stand-in, so pages that expect it keep working.

<p align="center">
  <img src="docs/assets/screenshot-blocking.png" alt="Ibon on MDN with the Blocking panel open: the site, the number of requests blocked on the page, a pause button, the filter list status and My filters" width="900">
</p>

uBlock Origin's code is GPL-3.0, so it is not part of Ibon (see [docs/licensing.md](docs/licensing.md)). Its lists are
used as data, and they run on [Ghostery's filter engine](https://github.com/ghostery/adblocker) (MPL-2.0), which reads
uBO's filter syntax. One of uBO's defaults, Peter Lowe's list, is left out because it states no licence.

## Connect an LLM (optional)

Open the sidebar, choose **Settings**, pick a provider, set the model and paste your API key. For a fully offline
setup, install [Ollama](https://ollama.com), pull a model, and choose **Local / Ollama**; no key is needed.

Presets: Ollama, OpenAI, Anthropic (Claude), xAI (Grok), DeepSeek, Moonshot (Kimi) and Zhipu (GLM). Anything that
speaks the OpenAI chat API, such as OpenRouter, Hugging Face's inference router, LM Studio or vLLM, works through the
**Custom** preset: enter its base URL, a model name and, if it needs one, a key.

Keys stay on your device, encrypted with your OS keychain, and are only sent to the provider you chose. The assistant
can drive the browser when it replies with action tags such as `[action:open_url https://…]`, `[action:read_mode]`,
`[action:summarize medium]` and `[action:copy_content]`.

## Known limitations

Ibon is an early alpha. The things to know before you rely on it:

- **Permission choices are not remembered.** A site that wants your camera, microphone or notifications gets an **Allow / Block** bar; Allow lasts only until that tab loads a new page. That is safe, but you will be asked again next time. Location and clipboard reading are always refused.
- **The assistant acts on its own replies without asking you first.** Treat pages you do not trust accordingly; asking for confirmation is next on the [roadmap](tasks.md).
- **API keys are only encrypted when your operating system provides a keychain.** Without one they are stored with weaker protection.
- **Installers are unsigned**, and only Windows has been tried by hand.
- **Ad blocking** hides elements in the page itself but not inside embedded frames (requests from frames are still
  blocked), and there is no element picker or request logger yet.
- There are no bookmarks, history, downloads panel, extensions or session restore yet. See the [roadmap](tasks.md).

## Tech stack

| Layer | Technology | Version | What it does in Ibon |
| --- | --- | --- | --- |
| **Engine** | <img src="https://upload.wikimedia.org/wikipedia/commons/2/28/Chromium_Logo.svg" width="18" height="18" alt=""> [Chromium](https://www.chromium.org/) | 152 | Renders every page. Also brings PDFium (the PDF viewer) and Crashpad (crash reports kept on your computer). |
| | <img src="https://cdn.simpleicons.org/electron" width="18" height="18" alt=""> [Electron](https://www.electronjs.org/) | 44 | The app shell: one sandboxed Chromium view per tab, the window, and messaging between the interface and the main process. |
| | <img src="https://cdn.simpleicons.org/nodedotjs" width="18" height="18" alt=""> [Node.js](https://nodejs.org/) | 24, inside Electron | Runs the main process; a worker thread builds the ad-blocking engine without slowing pages down. |
| **Interface** | <img src="https://cdn.simpleicons.org/react" width="18" height="18" alt=""> [React](https://react.dev/) | 19 | Tab strip, toolbar, reader view and the sidebar panels. |
| | <img src="https://cdn.simpleicons.org/typescript" width="18" height="18" alt=""> [TypeScript](https://www.typescriptlang.org/) | 5 | The interface and its typed client for the main process. |
| | <img src="https://cdn.simpleicons.org/vite" width="18" height="18" alt=""> [Vite](https://vite.dev/) | 7 | Bundles the interface; hot reload in `npm run dev`. |
| | <img src="https://cdn.simpleicons.org/css" width="18" height="18" alt=""> CSS | | Plain CSS with design tokens in CSS variables; no component library. |
| **Main process** | <img src="https://cdn.simpleicons.org/javascript" width="18" height="18" alt=""> JavaScript | ES modules | `electron/*.mjs`: tabs, request filtering, settings, LLM calls and the network tools. |
| **Ad blocking** | <img src="https://cdn.simpleicons.org/ghostery" width="18" height="18" alt=""> [Ghostery adblocker](https://github.com/ghostery/adblocker) | 2.18 | The filter engine (MPL-2.0), which reads uBlock Origin's filter syntax. |
| | <img src="https://cdn.simpleicons.org/ublockorigin/800000/e05353" width="18" height="18" alt=""> [uBlock Origin's lists](https://github.com/uBlockOrigin/uAssets) | updated daily | uBlock filters, EasyList, EasyPrivacy and the URLhaus malware list, downloaded when Ibon runs. |
| **AI (optional)** | <img src="https://cdn.simpleicons.org/ollama/000000/ffffff" width="18" height="18" alt="Ollama"> <img src="https://api.iconify.design/simple-icons/openai.svg?color=%2374AA9C" width="18" height="18" alt="OpenAI"> <img src="https://cdn.simpleicons.org/claude" width="18" height="18" alt="Claude"> <img src="https://cdn.simpleicons.org/deepseek" width="18" height="18" alt="DeepSeek"> <img src="https://cdn.simpleicons.org/kimi/000000/ffffff" width="18" height="18" alt="Kimi"> Your choice of LLM | | Ollama, OpenAI, Anthropic, xAI, DeepSeek, Moonshot, Zhipu or any OpenAI-compatible API, called with plain `fetch` (no SDKs). |
| **Build and test** | <img src="https://cdn.simpleicons.org/nodedotjs" width="18" height="18" alt=""> Node's test runner | `node --test` | Unit tests, no test framework. |
| | <img src="https://cdn.simpleicons.org/googlechrome" width="18" height="18" alt=""> Chrome DevTools Protocol | | `npm run smoke` launches the real app and drives it end to end with real key presses. |
| | <img src="https://cdn.simpleicons.org/electronbuilder/000000/ffffff" width="18" height="18" alt=""> [electron-builder](https://www.electron.build/) | 26 | Installers: NSIS and zip for Windows, dmg for macOS, AppImage and deb for Linux. |
| | <img src="https://cdn.simpleicons.org/githubactions" width="18" height="18" alt=""> [GitHub Actions](https://github.com/features/actions) | | CI on Windows, macOS and Linux, and draft releases. |
| | <img src="https://cdn.simpleicons.org/npm" width="18" height="18" alt=""> [npm](https://www.npmjs.com/) | | Packages, and `npm audit` on every change. |

Runtime dependencies are kept few on purpose: the ad-blocking engine is the only one, and React is bundled into the
interface. Every outside component and its licence is listed in [`docs/sourcing.md`](docs/sourcing.md).

## How it works

```
┌────────────────────────── Electron main process ─────────────────────────┐
│ tabs (one Chromium view each) · read-mode request filter                 │
│ ad blocker: uBlock Origin's lists, Ghostery's engine, built in a worker  │
│ settings and encrypted keys · LLM calls · DNS, headers, webhook tools    │
│ crash reporter (Crashpad, local only)                                    │
└───────────────▲──────────────────────────────────────────────────────────┘
                │ IPC (validated sender, context isolation, no Node access)
┌───────────────┴───────── React interface (renderer) ─────────────────────┐
│ tab strip · toolbar and blocking shield · reader view                    │
│ sidebar: assistant, dev tools, blocking, settings                        │
└──────────────────────────────────────────────────────────────────────────┘
```

```
electron/   main process: tabs, ad blocking and Read mode filtering, IPC, LLM and
            network tools, crash reports
src/        React interface: App, Reader, Sidebar, Blocking panel, typed IPC client
assets/     brand artwork (logo, wordmark)
build/      the app icon used when packaging
scripts/    dev and start launchers, icon builder, end-to-end smoke test
docs/       crash reports, sourcing register, releasing, screenshots
chromium/   a reference slice of upstream Chromium. Never compiled; for studying
            and porting behaviour. See docs/sourcing.md.
```

PDF viewing and crash reporting use the PDFium and Crashpad that ship inside Electron, rather than copies of their
source. [`docs/sourcing.md`](docs/sourcing.md) lists every outside component, its licence, and how it is used.

## Build from source

You need **Node.js 22 or newer**.

```sh
git clone https://github.com/faseen6351/Ibon.git
cd Ibon
npm install
npm start          # build the interface and launch Ibon
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Launch with hot reload |
| `npm run typecheck` | Type-check the interface |
| `npm test` | Run the unit tests |
| `npm run smoke` | Launch the real app and check it end to end (crash recovery, ad blocking, panels, PDF viewer) |
| `npm run pack` | Build an unpacked app into `release/` |
| `npm run dist` | Build installers for your OS into `release/` |

The first run downloads the Electron binary. If you launch Electron by hand from an editor terminal that sets
`ELECTRON_RUN_AS_NODE`, unset it first; the npm scripts already do.

## Roadmap

[`tasks.md`](tasks.md) is the working plan, with priorities and the reasoning behind each decision. Next up:

1. A security baseline: confirmation before the assistant acts, navigation guards, remembered per-site permissions.
2. OpenRouter and Hugging Face presets, and a page **Checkup** that audits performance, accessibility, security and
   SEO locally, then asks your model how to improve it.
3. MCP: Ibon as an MCP server so coding agents can drive and inspect the browser, and as an MCP client for the assistant.
4. Bookmarks, history, downloads and session restore.
5. Signed installers and automatic updates.

## Contributing

Ibon stays small on purpose, so please justify new dependencies and only bring in code whose licence allows commercial
use. [`CONTRIBUTING.md`](CONTRIBUTING.md) has the workflow; [`tasks.md`](tasks.md) marks good first issues. Please
report security problems privately; see [`SECURITY.md`](SECURITY.md).

## Licence and credits

Ibon is released under the [BSD 3-Clause licence](LICENSE): use it, change it and ship it, commercially or not, as
long as you keep the copyright notice. [`docs/licensing.md`](docs/licensing.md) explains the model, including why Ibon
only takes in permissive code and what to do about GPL. Files under `chromium/` keep their original Chromium licence
([`chromium/LICENSE`](chromium/LICENSE)). The notices for everything Ibon is built from are in
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md), and every installer carries a copy.

Ibon stands on the work of the [Electron](https://www.electronjs.org/), [Chromium](https://www.chromium.org/),
[PDFium](https://pdfium.googlesource.com/pdfium/), [Crashpad](https://chromium.googlesource.com/crashpad/crashpad/),
[React](https://react.dev/), [Vite](https://vite.dev/), [Min](https://github.com/minbrowser/min) and
[Ghostery adblocker](https://github.com/ghostery/adblocker) projects, and uses the filter lists of
[uBlock Origin](https://github.com/uBlockOrigin/uAssets), [EasyList](https://easylist.to/) and
[URLhaus filter](https://gitlab.com/malware-filter/urlhaus-filter). Ibon is not affiliated with or endorsed by Google,
the Chromium project, the Electron project, the Min project, uBlock Origin or Ghostery.

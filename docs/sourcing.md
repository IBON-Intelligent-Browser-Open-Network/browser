# Sourcing register

Everything Ibon borrows, ports or depends on, with where it came from and under what licence. A pull request that
brings in outside code or data adds a row here. The rules are in [tasks.md](../tasks.md) (decision D4): code we
copy, port or depend on must allow commercial use and must not force Ibon itself to change licence.

"Checked" means the licence text or package metadata was read on the date shown, not recalled from memory.

## What ships inside the app

| Item | Licence | How it is used | Checked |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org/) 44 | MIT | The application shell. Electron's own `LICENSE` and Chromium's `LICENSES.chromium.html` are included in every build. | 2026-10-02 |
| [Chromium](https://www.chromium.org/) 152 (inside Electron) | BSD-3-Clause and the licences of its bundled components | The rendering engine. Not modified. | 2026-10-02 |
| [PDFium](https://pdfium.googlesource.com/pdfium/) (inside Chromium) | BSD-3-Clause (checked in a local copy of the source) | PDF viewing, through Chromium's built-in PDF viewer. We **use** it; no PDFium code is copied or compiled by Ibon. | 2026-10-02 |
| [Crashpad](https://chromium.googlesource.com/crashpad/crashpad/) (inside Electron) | Apache-2.0 (checked in a local copy of the source) | Crash reports, through Electron's `crashReporter`. We **use** it; no Crashpad code is copied or compiled by Ibon. | 2026-10-02 |
| [React](https://react.dev/) and `react-dom` 19 | MIT | UI library, bundled into `dist/` by Vite. | 2026-10-02 |
| [Ghostery adblocker](https://github.com/ghostery/adblocker) 2.18: `@ghostery/adblocker`, `-content`, `-extended-selectors`, `-electron-preload`, and `@ghostery/url-parser` | MPL-2.0 | The ad and tracker filter engine (`electron/content-blocker.mjs`) and the page-side script for element hiding. Used **unmodified**, as npm dependencies; their `LICENSE` files ship inside the app. | 2026-10-02 |
| `@remusao/small`, `smaz`, `smaz-compress`, `smaz-decompress`, `trie`, `guess-url-type` ([remusao/mono](https://github.com/remusao/mono)) | MPL-2.0 | Helpers of the engine (compact encoding, URL type guessing). Unmodified. | 2026-10-02 |
| [tldts](https://github.com/remusao/tldts) (`tldts-experimental`, `tldts-core`) 7 | MIT | Hostname and domain parsing inside the engine. | 2026-10-02 |
| Ibon logo artwork (`assets/brand/`, `build/icon.png`) | Provided by the project owner | App icon, wordmark and in-app mark. | n/a |

## Downloaded at runtime (data, never shipped)

The ad blocker downloads these on the user's machine, from their publishers, and keeps them in the profile
(`filters/`). None of them is in the repository or in an installer, so their licences do not apply to Ibon's code
(decision D4: "filter lists are downloaded and cached at runtime, not vendored"). They are credited in the Blocking
panel. The list of URLs is `FILTER_LISTS` in `electron/content-blocker.mjs`.

| Item | Licence | How it is used | Checked |
| --- | --- | --- | --- |
| [uBlock Origin's filter lists](https://github.com/uBlockOrigin/uAssets) (uBlock filters: Ads, Badware risks, Privacy, Unbreak, Quick fixes) | GPL-3.0 | Filter rules, from `ublockorigin.github.io/uAssetsCDN` (mirror `ublockorigin.pages.dev`), the URLs uBO itself uses. | 2026-10-02 |
| [EasyList and EasyPrivacy](https://easylist.to/) | GPL-3.0 or later, or CC BY-SA 3.0 or later (dual) | Filter rules, from uBO's mirror of them. | 2026-10-02 |
| [Online Malicious URL Blocklist](https://gitlab.com/malware-filter/urlhaus-filter) | CC0 and MIT (its source, URLhaus, is CC0) | Filter rules against malware sites. | 2026-10-02 |
| uBlock Origin's scriptlets and redirect resources, as published by Ghostery (`packages/adblocker/assets/ublock-origin/resources.json` in [ghostery/adblocker](https://github.com/ghostery/adblocker)) | GPL-3.0 (uBlock Origin's code) | The code behind `##+js(...)` rules and the harmless stand-ins for `$redirect` rules. It is **code**, not just data: it is downloaded at runtime and runs inside web pages, the way a page's own scripts do; Ibon never distributes it. If that line is not acceptable, set `RESOURCES_URL` to `""` and scriptlets turn off (redirects fall back to the engine's built-in blank resources). | 2026-10-02 |

Left out: **Peter Lowe's Ad and tracking server list**, one of uBO's defaults. Its site states no licence or terms of
use (checked 2026-10-02), and D4 excludes unlicensed material. It is small and mostly covered by EasyList and
EasyPrivacy.

## Build and development tools (not shipped)

| Item | Licence | Checked |
| --- | --- | --- |
| Vite 7, `@vitejs/plugin-react` | MIT | 2026-10-02 |
| TypeScript 5 | Apache-2.0 | 2026-10-02 |
| electron-builder 26 | MIT | 2026-10-02 |
| Remaining transitive dev dependencies | MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, BlueOak-1.0.0, 0BSD, Python-2.0, WTFPL, CC-BY-4.0 (browser-support data). No GPL, LGPL or AGPL. | 2026-10-02 |

## Reference only (not part of the build)

Local checkouts of other projects (Chromium, PDFium, Crashpad, Min) were used to read how upstream behaves. They are
not part of this repository and should be kept outside the editor workspace.

| Item | Licence | Notes |
| --- | --- | --- |
| `chromium/` in this repository | Chromium's licence, kept at `chromium/LICENSE` | A trimmed slice of upstream Chromium used for reading and for porting behaviour. Never compiled. Do not edit it except through a documented update from upstream. |
| Local copies of the Chromium, PDFium and Crashpad source | See above | Used to read how upstream behaves. Keep them outside the editor workspace; Chromium alone is about half a million files. |

## Ported code

| Ibon file | Ported from | Licence | Notes |
| --- | --- | --- | --- |
| `electron/permission-manager.mjs` | Min `main/permissionManager.js` ([minbrowser/min](https://github.com/minbrowser/min) at 1.35.7, commit `c92079c`) | Apache-2.0 (no NOTICE file) | A rewrite of the rules, not a copy: ask per site, a grant lasts for the page, sub-frames refused, revoked on navigation. Changes: grants per tab, merged media types, duplicate prompts share one answer, Block remembered for the page, origins normalised. Credited in `THIRD_PARTY_NOTICES.md`, licence text in `LICENSES/Apache-2.0.txt`. |
| `electron/tlds.mjs` | [Public Suffix List](https://publicsuffix.org/list/), ICANN section, regenerated by `scripts/update-tlds.mjs` | MPL-2.0 (data) | 1,441 top-level domains. The file keeps the MPL header and stays MPL-2.0; licence text in `LICENSES/MPL-2.0.txt`. Min and Chromium use the same list for the same purpose. |
| `electron/address.mjs` | Approach from Min `js/util/urlParser.js` (Apache-2.0) and Chromium `url_fixer` (BSD-3-Clause); test vectors adapted from `url_fixer_unittest.cc` | BSD-3-Clause (independent implementation) | Not a copy of either: the code is new, only the idea ("a website is an IP, a local name or a real TLD") and some test cases come from upstream. Differences from Min: real domains default to https (Min uses http for sites outside its top-1000 list), IPv6 and port rules, no email-style `user@host`. |

Also taken from Min as **ideas only**, written independently with Electron's own APIs (no Min code involved, so no
licence terms attach): the keyboard shortcut set (`electron/shortcuts.mjs`, from `js/defaultKeybindings.js`), the
right-click menu contents (`electron/context-menu.mjs`, from `js/webviewMenu.js`), and the find-in-page behaviour
(from `js/findinpage.js`, which also showed how Electron's `findNext` flag really works). Credited here as a courtesy.

## Studied, not (yet) used

Licences read from each repository on 2026-10-02. "Take" lists what Ibon may reimplement or depend on.

| Project | Licence | Take | Task |
| --- | --- | --- | --- |
| [Min](https://github.com/minbrowser/min) | Apache-2.0 | URL and search detection (`js/util/urlParser.js`, with its HTTPS-upgrade list), search keywords and bangs, full-text history search, tab groups ("Tasks"), find in page, download manager, session restore, userscripts, reader-mode decision, keyboard shortcuts | C-01, C-02, C-04 to C-08, C-10, X-02, AI-25 |
| [DuckDuckGo privacy extension](https://github.com/duckduckgo/duckduckgo-privacy-extension) | Apache-2.0 | Privacy dashboard ideas, referrer and tracking-parameter protections | V-04, V-08 |
| [DuckDuckGo autoconsent](https://github.com/duckduckgo/autoconsent) | MPL-2.0 | Auto-dismiss cookie banners, as an unmodified dependency | new (V-11) |
| [Dark Reader](https://github.com/darkreader/darkreader) | MIT | Per-site page dark mode | new (U-10) |
| [Vimium](https://github.com/philc/vimium) | MIT | Keyboard link hints | C-10 |
| [Brave](https://github.com/brave/brave-core) and [adblock-rust](https://github.com/brave/adblock-rust) | MPL-2.0 | Shields design; fast native filter engine as a fallback (not needed so far, see V-01) | V-01 |
| `@ghostery/adblocker-electron` (the Electron wrapper of the engine Ibon uses) | MPL-2.0 | Read, not used: it takes the session's only `onBeforeRequest` slot, sets `ELECTRON_DISABLE_SECURITY_WARNINGS` for the whole app, and redirects to `data:` URLs, which Electron 44 refuses. `main.mjs` does the same job without those problems | V-01 |
| [PDF.js](https://github.com/mozilla/pdf.js) | Apache-2.0 | PDF text extraction for the assistant | C-21 |
| [Readability](https://github.com/mozilla/readability) | Apache-2.0 | Better article extraction | AI-25 |
| [Ferdium](https://github.com/ferdium/ferdium-app) | Apache-2.0 | Web apps as side panels with their own sessions | A-07 |
| [Puppeteer](https://github.com/puppeteer/puppeteer), [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Browser-automation design for the assistant and MCP | AI-22, M-01 |
| [web-vitals](https://github.com/GoogleChrome/web-vitals) | Apache-2.0 | Core Web Vitals in the Checkup | AI-10 |
| [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium) | BSD-3-Clause | Checklist of Google endpoints to confirm are absent | S-12 |
| [Zen browser](https://github.com/zen-browser/desktop) | MPL-2.0 | Workspace and layout ideas only (a Firefox fork) | U-02 |
| [Beaker](https://github.com/beakerbrowser/beaker) | MIT (archived) | Ideas only | |

## Looked at and excluded

| Project | Licence | Why |
| --- | --- | --- |
| [uBlock Origin](https://github.com/gorhill/uBlock) | GPL-3.0 | Copyleft. Its code is not in Ibon. Its filter syntax is read by the Ghostery engine, and its lists and scriptlets are downloaded at runtime (see "Downloaded at runtime" above). |
| [Peter Lowe's list](https://pgl.yoyo.org/adservers/) | None stated | No licence or terms of use. Left out of the default lists. |
| [qutebrowser](https://github.com/qutebrowser/qutebrowser) | GPL-3.0 | Copyleft. Keyboard-driven design may be reimplemented from the idea. |
| [Agregore](https://github.com/AgregoreWeb/agregore-browser) | AGPL-3.0 | Network copyleft. |
| [electron-browser-shell](https://github.com/samuelmaddock/electron-browser-shell) (`electron-chrome-extensions`) | GPL-3.0 | Copyleft. Use Electron's own `session.loadExtension` instead. |
| DuckDuckGo Tracker Radar | CC BY-NC-SA 4.0 | Non-commercial. |
| [Privacy Badger](https://github.com/EFForg/privacybadger) | Not detected by GitHub; the project is understood to be GPL | Treated as excluded until the licence is confirmed. |

## The original Aura prototype (`aura-browser`)

Ibon began as a Lovable-generated prototype (Aura, later Aether). Everything useful was carried over: Read mode
extraction, the tracker list, the LLM provider presets, the DNS, headers, ping and RDAP tools, and the webhook sender.
What is left is Lovable and TanStack scaffolding, about 50 generic UI components, an IP lookup, a port scanner that
probes arbitrary hosts (Ibon will only ever probe `localhost`, see ML-01), and a four-characters-per-token estimate
(to be reused for the usage meter, AI-04). Nothing there needs porting. The prototype remains on GitHub.

## Decisions recorded here

- **Ad blocking uses uBlock Origin's lists, not its code.** uBO is GPL-3.0; its lists are data, downloaded at runtime,
  and an MPL-2.0 engine that reads uBO's syntax runs them. This is option 1 in [licensing.md](licensing.md).
- **`$redirect` stand-ins are served from Ibon's own `ibon-resource:` scheme, not as `data:` URLs.** Electron 44
  refuses every redirect to a `data:` URL (scripts and images alike, with or without a Content-Security-Policy). A
  privileged scheme works, also on pages with a CSP, which is how uBO uses its extension's own URLs. Its host is
  random per run so pages cannot probe for Ibon.

- **Crash reporting and PDF viewing use what Electron already ships.** Compiling Crashpad or PDFium ourselves would add
  a native build chain and a second copy of code that is already in the app, with no capability gained. Ibon adds the
  parts upstream does not provide: recovering a crashed tab and showing where reports are kept.
- **Crashpad's retention is not re-implemented.** Its handler prunes its own database when it grows past 128 MB or a
  report is older than 365 days, and the handler inside Electron is the same code.

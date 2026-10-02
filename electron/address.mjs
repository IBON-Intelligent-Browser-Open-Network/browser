// What the address bar does with what you type: open a website, or search.
//
// Why this is not one regex: a developer types `localhost:3000`, `192.168.1.5:8080`, `[::1]:5173`, `myapp.local`,
// `api.test/health` as often as `nodejs.org`, and also types `package.json` or `what is a closure` and expects a
// search. The rules below follow the approach of Min's js/util/urlParser.js (Apache-2.0, an input is a website when
// its host is an IP address, a known local name or ends in a real top-level domain) and Chromium's url_fixer
// (a bare `host:123` counts as host and port only when 123 is a valid port, so `tel:123...` is not misread).
// This is an independent implementation. Test vectors adapted from Chromium's url_fixer_unittest.cc, BSD-3-Clause.
//
// Policy choices, so they are not surprises:
//  - Real domains get https. Local and private names and every IP address get http (dev servers rarely have TLS,
//    and a certificate cannot match an IP).
//  - Only http and https are ever opened from the address bar. Other schemes (javascript:, data:, file:, mailto:,
//    about:...) are treated as search text, so typed or pasted text cannot run script in the interface.
//  - `user@host` is treated as search text, not a login URL: it is usually an email address.
//
// SPDX-License-Identifier: BSD-3-Clause
import { domainToASCII } from "node:url";
import { TLDS } from "./tlds.mjs";

/** The default search engine. Its name is shown in the interface, for example "Search Google for …". */
export const SEARCH_ENGINE = "Google";
export const HOME = "https://www.google.com/";
export const SEARCH = "https://www.google.com/search?q=";

/** Names that only make sense on a private network or this machine. */
const LOCAL_SUFFIXES = ["localhost", "local", "test", "internal", "lan", "home.arpa", "localdomain", "intranet", "corp", "home"];

const NO_HOSTS = new Set();

const isLocalName = (host) => LOCAL_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));

function isIPv4(text) {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** A valid DNS name in ASCII form (IDN already converted), or null. */
function asciiHost(text) {
  const withoutDot = text.endsWith(".") ? text.slice(0, -1) : text;
  const host = domainToASCII(withoutDot);
  if (!host || host.length > 253) return null;
  const labels = host.split(".");
  if (!labels.every((l) => l.length > 0 && l.length <= 63 && /^[a-z0-9_-]+$/.test(l))) return null;
  return host;
}

/**
 * Turns what the user typed into the URL to open.
 * @param {string} raw
 * @param {{ home?: string, searchUrl?: string, hostNames?: Set<string> }} [options]
 *   hostNames: names from the OS hosts file, so `myapp` or `dev.shop` can be a site on a developer's machine.
 */
export function resolveInput(raw, { home = HOME, searchUrl = SEARCH, hostNames = NO_HOSTS } = {}) {
  const text = String(raw ?? "").trim();
  if (!text) return home;
  const search = () => searchUrl + encodeURIComponent(text);

  // An explicit web address is kept, but only http and https. Everything else with "://" is search text.
  const scheme = text.match(/^([a-z][a-z0-9+.-]*):\/\//i);
  if (scheme) {
    if (!/^https?$/i.test(scheme[1])) return search();
    try {
      return new URL(text).href;
    } catch {
      return search();
    }
  }

  // Look only at the host part: everything before the first / ? or #. A space in it means a sentence.
  const authority = text.match(/^[^/?#]*/)[0];
  if (/\s/.test(authority) || authority.includes("@") || authority.includes("\\")) return search();

  let host;
  let port = "";
  let ipv6 = false;
  const v6 = authority.match(/^\[([0-9a-f:.]+)\](?::(\d+))?$/i);
  if (v6) {
    ipv6 = true;
    host = `[${v6[1].toLowerCase()}]`;
    port = v6[2] ?? "";
  } else {
    const hp = authority.match(/^([^:]+)(?::(\d+))?$/);
    if (!hp) return search(); // "host:", "host:abc", "a:b:c", "::1" ...
    host = hp[1].toLowerCase();
    port = hp[2] ?? "";
  }
  // Leading zeros are fine ("host:00009999" is port 9999, as in Chromium), but the number must be a real port.
  const portDigits = port.replace(/^0+(?=\d)/, "");
  if (port !== "" && !(portDigits.length <= 5 && Number(portDigits) <= 65535)) return search();

  let scheme_;
  if (ipv6) {
    scheme_ = "http";
  } else if (/^[0-9.]+$/.test(host)) {
    // Digits and dots are an IP address or they are not a website at all ("3.14", "2024", "3:30").
    if (!isIPv4(host)) return search();
    scheme_ = "http";
  } else {
    const ascii = asciiHost(host);
    if (!ascii) return search();
    host = ascii;
    const bare = ascii.replace(/\.$/, "");
    const labels = bare.split(".");
    if (isLocalName(bare)) scheme_ = "http";
    else if (labels.length === 1) {
      // "nodejs" is a search, "nodejs:8080" and a name from the hosts file are a machine on the network.
      if (port === "" && !hostNames.has(bare)) return search();
      scheme_ = "http";
    } else if (TLDS.has(labels[labels.length - 1])) scheme_ = "https";
    else if (hostNames.has(bare)) scheme_ = "http";
    else return search(); // "package.json", "index.html", "v1.2.3": a file or a version, not a site
  }

  try {
    return new URL(`${scheme_}://${text}`).href;
  } catch {
    return search();
  }
}

/**
 * Names from the contents of an OS hosts file. Lines look like `127.0.0.1 myapp.test www.myapp.test # note`.
 * Capped, because some hosts files are huge ad-block lists.
 */
export function parseHostsFile(contents, maxBytes = 256 * 1024) {
  const names = new Set();
  const lines = String(contents).slice(0, maxBytes).split(/\r?\n/);
  for (const line of lines) {
    const fields = line.replace(/#.*/, "").trim().split(/\s+/);
    // A hosts line starts with an IP address: a dotted quad, or something with a colon for IPv6.
    if (fields.length < 2 || !/^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f]*:[0-9a-f:.]*)$/i.test(fields[0])) continue;
    for (const name of fields.slice(1)) {
      const n = name.toLowerCase();
      if (n && n !== "localhost" && !n.startsWith("ip6-") && n !== "broadcasthost" && /^[a-z0-9._-]+$/.test(n)) names.add(n);
    }
  }
  return names;
}

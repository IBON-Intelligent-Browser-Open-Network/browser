// Test vectors marked (Chromium) are adapted from components/url_formatter/url_fixer_unittest.cc,
// Copyright 2011 The Chromium Authors, BSD-3-Clause.
import { test } from "node:test";
import assert from "node:assert/strict";

import { HOME, SEARCH, parseHostsFile, resolveInput } from "./address.mjs";

const search = (text) => SEARCH + encodeURIComponent(text);

function table(rows, options) {
  for (const [input, expected] of rows) {
    assert.equal(resolveInput(input, options), expected, `resolveInput(${JSON.stringify(input)})`);
  }
}

test("empty input opens the home page", () => {
  assert.equal(resolveInput(""), HOME);
  assert.equal(resolveInput("   "), HOME);
  assert.equal(resolveInput(undefined), HOME);
});

test("real domains open over https", () => {
  table([
    ["nodejs.org", "https://nodejs.org/"],
    ["www.google.com", "https://www.google.com/"], // (Chromium)
    [" www.google.com     ", "https://www.google.com/"], // (Chromium)
    ["example.com/some/path?x=1#top", "https://example.com/some/path?x=1#top"],
    ["example.com?foo", "https://example.com/?foo"], // (Chromium)
    ["www.google.com#foo", "https://www.google.com/#foo"], // (Chromium)
    ["google.com:123", "https://google.com:123/"], // (Chromium)
    ["www.google.com:123?foo#bar", "https://www.google.com:123/?foo#bar"], // (Chromium)
    ["EXAMPLE.COM", "https://example.com/"],
    ["docs.rs", "https://docs.rs/"],
    ["github.io", "https://github.io/"],
    ["example.com.", "https://example.com./"],
  ]);
});

test("spaces in the path are encoded, not treated as a sentence", () => {
  assert.equal(resolveInput(" foo.com/asdf  bar"), "https://foo.com/asdf%20%20bar"); // (Chromium)
});

test("internationalised domains become punycode", () => {
  assert.equal(resolveInput("\u6C34.com"), "https://xn--1rw.com/"); // (Chromium)
});

test("developer addresses open over http", () => {
  table([
    ["localhost", "http://localhost/"],
    ["localhost:3000", "http://localhost:3000/"],
    ["LOCALHOST:3000/api?x=1", "http://localhost:3000/api?x=1"],
    ["127.0.0.1:8080", "http://127.0.0.1:8080/"],
    ["192.168.1.5:3000/admin", "http://192.168.1.5:3000/admin"],
    ["10.0.0.7", "http://10.0.0.7/"],
    ["8.8.8.8", "http://8.8.8.8/"],
    ["[::1]:3000", "http://[::1]:3000/"],
    ["[2001:db8::2]", "http://[2001:db8::2]/"], // (Chromium)
    ["[::]:80", "http://[::]/"], // (Chromium: the default port is dropped)
    ["[::]:180/path", "http://[::]:180/path"], // (Chromium)
    ["myapp.local", "http://myapp.local/"],
    ["api.test/health", "http://api.test/health"],
    ["shop.localhost:5173", "http://shop.localhost:5173/"],
    ["router.lan", "http://router.lan/"],
    ["nas.home.arpa", "http://nas.home.arpa/"],
  ]);
});

test("a single name with a port is a machine, without one it is a search", () => {
  table([
    ["host:123", "http://host:123/"], // (Chromium)
    ["host:80", "http://host/"], // (Chromium)
    ["host:00009999", "http://host:9999/"], // (Chromium)
    ["www:123", "http://www:123/"], // (Chromium)
    ["   www:123", "http://www:123/"], // (Chromium)
    ["host:65535", "http://host:65535/"], // (Chromium)
    ["nodejs", search("nodejs")],
    ["react", search("react")],
  ]);
});

test("things that look like a host and port but are not", () => {
  table([
    ["host:65536", search("host:65536")],
    ["host:-1", search("host:-1")],
    ["host:+123", search("host:+123")],
    ["host:1.23", search("host:1.23")],
    ["host:x", search("host:x")],
    ["host:", search("host:")],
    ["host: 123", search("host: 123")],
    ["host:18446744073709551619", search("host:18446744073709551619")],
    ["tel:12345678901", search("tel:12345678901")], // (Chromium: a phone number is not a port)
    ["tel:123-456-78901", search("tel:123-456-78901")],
    ["3:30", search("3:30")],
    ["::1", search("::1")],
  ]);
});

test("file names, versions and numbers are searches", () => {
  table([
    ["package.json", search("package.json")],
    ["index.html", search("index.html")],
    ["file.txt", search("file.txt")],
    ["app.js", search("app.js")],
    ["v1.2.3", search("v1.2.3")],
    ["3.14", search("3.14")],
    ["2024", search("2024")],
    ["256.1.1.1", search("256.1.1.1")],
    ["1.2.3", search("1.2.3")],
    ["e.g.", search("e.g.")],
    ["notatld.zzzz", search("notatld.zzzz")],
  ]);
});

test("a sentence is a search even if it contains a dot", () => {
  table([
    ["how do I use node.js", search("how do I use node.js")],
    ["what is a closure", search("what is a closure")],
    ["example.com is down", search("example.com is down")],
    ["C:\\Users\\me\\file.txt", search("C:\\Users\\me\\file.txt")],
  ]);
});

test("an email address is a search, not a login URL", () => {
  assert.equal(resolveInput("user@www.google.com"), search("user@www.google.com"));
  assert.equal(resolveInput("me@example.com"), search("me@example.com"));
});

test("explicit web addresses are kept", () => {
  table([
    ["http://localhost:5173", "http://localhost:5173/"],
    ["https://example.com/a b", "https://example.com/a%20b"],
    ["HTTP://Example.COM/Path", "http://example.com/Path"],
    ["http://example.com/s?q=\u0405", "http://example.com/s?q=%D0%85"], // (Chromium)
    ["https://user:pw@example.com/", "https://user:pw@example.com/"],
  ]);
});

test("schemes other than http and https are never opened from the address bar", () => {
  table([
    ["javascript:alert(1)", search("javascript:alert(1)")],
    ["data:text/html,<h1>x</h1>", search("data:text/html,<h1>x</h1>")],
    ["file:///C:/Windows/win.ini", search("file:///C:/Windows/win.ini")],
    ["ftp://example.com/x", search("ftp://example.com/x")],
    ["chrome://gpu", search("chrome://gpu")],
    ["devtools://bundled/devtools/node.html", search("devtools://bundled/devtools/node.html")],
    ["about:blank", search("about:blank")],
    ["mailto:me@example.com", search("mailto:me@example.com")],
    ["view-source:https://example.com", search("view-source:https://example.com")],
  ]);
});

test("names from the hosts file can be sites", () => {
  const hostNames = new Set(["myapp", "dev.shopfront", "intranet-wiki"]);
  table(
    [
      ["myapp", "http://myapp/"],
      ["myapp/login", "http://myapp/login"],
      ["dev.shopfront/cart", "http://dev.shopfront/cart"], // ".shopfront" is not a real top-level domain
      ["unknown", search("unknown")],
      ["example.com", "https://example.com/"],
    ],
    { hostNames },
  );
  // A real domain stays https even if the hosts file lists it.
  assert.equal(resolveInput("example.com", { hostNames: new Set(["example.com"]) }), "https://example.com/");
});

test("searches go to Google, and the home page is Google", () => {
  assert.equal(resolveInput("what is a closure"), "https://www.google.com/search?q=what%20is%20a%20closure");
  assert.equal(resolveInput(""), "https://www.google.com/");
});

test("the search engine and home page can be changed", () => {
  const options = { searchUrl: "https://www.example-search.test/?q=", home: "about:blank" };
  assert.equal(resolveInput("hello world", options), "https://www.example-search.test/?q=hello%20world");
  assert.equal(resolveInput("", options), "about:blank");
});

test("search text is fully encoded", () => {
  assert.equal(resolveInput("a&b=c d"), SEARCH + "a%26b%3Dc%20d");
  assert.equal(resolveInput("100% sure #1"), SEARCH + "100%25%20sure%20%231");
});

test("parseHostsFile reads names, ignores comments and noise", () => {
  const names = parseHostsFile(
    [
      "# comment",
      "127.0.0.1 localhost",
      "::1 localhost ip6-localhost ip6-loopback",
      "255.255.255.255 broadcasthost",
      "127.0.0.1\tMyApp.test www.myapp.test  # dev",
      "",
      "10.0.0.5 nas",
      "bad line",
      "0.0.0.0 ads.example.net",
    ].join("\r\n"),
  );
  assert.deepEqual([...names].sort(), ["ads.example.net", "myapp.test", "nas", "www.myapp.test"]);
});

test("parseHostsFile is capped so a huge blocklist cannot flood memory", () => {
  const huge = Array.from({ length: 20000 }, (_, i) => `0.0.0.0 tracker${i}.example.net`).join("\n");
  assert.ok(parseHostsFile(huge, 1024).size < 100);
});

import { useEffect, useState } from "react";

import { api, type BlockerStatus } from "../lib/api";

interface Props {
  activeUrl: string;
  /** Requests blocked on the current page. */
  blocked: number;
  /** Blocking is paused for the current site. */
  paused: boolean;
}

/** The site a page belongs to, or "" for anything that is not a web page. */
function siteOf(url: string): string {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.hostname : "";
  } catch {
    return "";
  }
}

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

function listsLine(s: BlockerStatus): string {
  const rules = s.networkRules + s.cosmeticRules;
  if (rules === 0) {
    return s.state === "updating"
      ? "Downloading uBlock Origin's filter lists…"
      : "Using Ibon's small built-in tracker list until uBlock Origin's filter lists download.";
  }
  const when = s.state === "updating" ? "updating now" : s.updatedAt ? `updated ${ago(s.updatedAt)}` : "from copies saved earlier";
  return `uBlock Origin's default lists · ${plural(rules, "rule")} · ${when}`;
}

// uBlock Origin's popup and its "My filters" pane, in the sidebar. The page view is drawn over the content area, so
// a popup under the toolbar button would be hidden behind the page; the sidebar sits beside it.
export function BlockingPanel({ activeUrl, blocked, paused }: Props) {
  const [status, setStatus] = useState<BlockerStatus | null>(null);
  const [draft, setDraft] = useState<string | null>(null); // My filters while being edited
  const [error, setError] = useState("");

  useEffect(() => {
    void api.blockerStatus().then(setStatus).catch(() => {});
    return api.onBlocker(setStatus);
  }, []);

  if (!status) return <p className="muted">Loading…</p>;

  const run = async (fn: () => Promise<BlockerStatus>) => {
    setError("");
    try {
      setStatus(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not work");
    }
  };

  const site = siteOf(activeUrl);
  // The entry that pauses this site may be a parent domain: pausing example.com covers www.example.com.
  const pausedBy = status.pausedSites.find((s) => site === s || site.endsWith(`.${s}`));
  const text = draft ?? status.myFiltersText;
  const edited = draft !== null && draft !== status.myFiltersText;
  const { rules, unsupported } = status.myFilters;

  return (
    <div className="tools blocking">
      {site ? (
        <div className="site-card">
          <div className="site-name" title={site}>{site}</div>
          <div className="muted">{paused ? "Blocking is paused on this site." : `${plural(blocked, "request")} blocked on this page`}</div>
          <button
            className={`pill${paused ? " on" : ""}`}
            onClick={() => run(() => api.pauseBlocking(pausedBy ?? site, !paused))}
            title={paused ? "Block ads and trackers on this site again, then reload" : "Allow everything on this site, then reload"}
          >
            {paused ? `Resume blocking on ${pausedBy ?? site}` : "Pause blocking on this site"}
          </button>
        </div>
      ) : (
        <p className="muted">Open a web page to see what is blocked on it.</p>
      )}

      <label className="muted">Filter lists</label>
      <p className="tight">{listsLine(status)}</p>
      <details>
        <summary className="muted">{plural(status.lists.length, "list")}{status.scriptlets ? " and uBO's scriptlets" : ""}</summary>
        <ul className="plain">
          {status.lists.map((l) => (
            <li key={l.id} className={l.ok ? "" : "muted"}>
              {l.ok ? "✓" : "–"} {l.name}
            </li>
          ))}
        </ul>
      </details>
      <div className="row">
        <button className="pill" disabled={status.state === "updating"} onClick={() => run(api.updateFilterLists)}>
          {status.state === "updating" ? "Updating…" : "Update now"}
        </button>
      </div>
      {status.error && <p className="error">{status.error}</p>}

      <label className="muted" htmlFor="my-filters">My filters</label>
      <textarea
        id="my-filters"
        className="filters"
        rows={6}
        value={text}
        spellCheck={false}
        placeholder={"||ads.example.com^\nexample.com##.cookie-banner\n@@||cdn.example.com^"}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="row">
        <button
          className="pill on"
          disabled={!edited}
          onClick={() =>
            run(async () => {
              const next = await api.setMyFilters(text);
              setDraft(null);
              return next;
            })
          }
        >
          Apply
        </button>
        <span className="muted">
          {plural(rules, "rule")}
          {unsupported > 0 ? ` · ${plural(unsupported, "line")} not understood` : ""}
        </span>
      </div>
      <p className="muted tight">
        uBlock Origin syntax, one rule per line: <code>||host^</code> blocks a server, <code>site##.selector</code> hides
        an element, <code>@@</code> makes an exception. Reload a page to see a change.
      </p>

      {status.pausedSites.length > 0 && (
        <>
          <label className="muted">Paused sites</label>
          <ul className="plain">
            {status.pausedSites.map((s) => (
              <li key={s} className="row-between">
                <span>{s}</span>
                <button className="link" onClick={() => run(() => api.pauseBlocking(s, false))}>resume</button>
              </li>
            ))}
          </ul>
        </>
      )}

      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Filter lists by uBlock Origin (GPL-3.0), EasyList (GPL-3.0 or CC BY-SA 3.0) and the URLhaus filter (CC0) are
        downloaded from their publishers; they are not part of Ibon. Filtering engine: Ghostery adblocker (MPL-2.0).
      </p>
    </div>
  );
}

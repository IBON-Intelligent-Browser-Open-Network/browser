import { useCallback, useEffect, useRef, useState } from "react";

import { api, type AppInfo, type ChatMessage, type CrashInfo, type Settings } from "../lib/api";
import { PROVIDER_PRESETS } from "../lib/providers";
import { BlockingPanel } from "./BlockingPanel";

export type Panel = "assistant" | "tools" | "blocking" | "settings" | null;

const PANEL_LABELS = { assistant: "Assistant", tools: "Dev tools", blocking: "Blocking", settings: "Settings" } as const;

interface Props {
  panel: Panel;
  setPanel: (p: Panel) => void;
  onAction: (name: string, arg?: string) => Promise<void>;
  activeUrl: string;
  activeTitle: string;
  /** Requests blocked on the active page, and whether blocking is paused on its site. */
  blocked: number;
  blockingPaused: boolean;
}

const ACTION_RE = /^\[action:(\w+)(?:\s+([^\]]+))?\]\s*$/;

export function Sidebar({ panel, setPanel, onAction, activeUrl, activeTitle, blocked, blockingPaused }: Props) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-tabs">
        {(Object.keys(PANEL_LABELS) as (keyof typeof PANEL_LABELS)[]).map((p) => (
          <button key={p} className={panel === p ? "on" : ""} onClick={() => setPanel(p)}>
            {PANEL_LABELS[p]}
          </button>
        ))}
      </nav>
      <div className="sidebar-body">
        {panel === "assistant" && <Assistant onAction={onAction} activeUrl={activeUrl} activeTitle={activeTitle} />}
        {panel === "tools" && <Tools activeUrl={activeUrl} />}
        {panel === "blocking" && <BlockingPanel activeUrl={activeUrl} blocked={blocked} paused={blockingPaused} />}
        {panel === "settings" && <SettingsPanel />}
      </div>
    </aside>
  );
}

function Assistant({ onAction, activeUrl, activeTitle }: Pick<Props, "onAction" | "activeUrl" | "activeTitle">) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  // Braces matter: an effect must return nothing or a cleanup function, and newer Chromium returns a Promise
  // from scrollIntoView(), which React would try to call as a cleanup and crash the whole UI.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, busy]);

  const handleReply = useCallback(
    async (reply: string) => {
      const visible: string[] = [];
      for (const line of reply.split("\n")) {
        const m = line.trim().match(ACTION_RE);
        if (m) await onAction(m[1], m[2]?.trim());
        else visible.push(line);
      }
      setMessages((prev) => [...prev, { role: "assistant", content: visible.join("\n").trim() || "Done." }]);
    },
    [onAction],
  );

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    const next = [...messages, { role: "user" as const, content: text.trim() }];
    setMessages(next);
    setInput("");
    setError("");
    setBusy(true);
    try {
      await handleReply(await api.chat(next, true));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  const summarize = async (length: "short" | "medium" | "detailed") => {
    if (busy) return;
    setError("");
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: `Summarize this page (${length})` }]);
    try {
      const { summary } = await api.summarize(length);
      setMessages((prev) => [...prev, { role: "assistant", content: summary }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Summarize failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="assistant">
      <div className="ctx muted" title={activeUrl}>On: {activeTitle || "—"}</div>
      <div className="row">
        {(["short", "medium", "detailed"] as const).map((l) => (
          <button key={l} className="pill" disabled={busy} onClick={() => summarize(l)}>
            Summarize · {l}
          </button>
        ))}
      </div>
      <div className="messages">
        {messages.length === 0 && <p className="muted">Ask about this page, or tell Ibon to open a site, switch read mode, or summarize. Pick your LLM in Settings.</p>}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>{m.content}</div>
        ))}
        {busy && <div className="msg assistant muted">Thinking…</div>}
        {error && <div className="error">{error}</div>}
        <div ref={endRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Ibon…" />
        <button className="pill on" disabled={busy}>Send</button>
      </form>
    </div>
  );
}

function Tools({ activeUrl }: { activeUrl: string }) {
  const [host, setHost] = useState("");
  const [out, setOut] = useState("");
  const [busy, setBusy] = useState(false);
  const [hook, setHook] = useState("");

  useEffect(() => {
    try {
      setHost(new URL(activeUrl).hostname);
    } catch {
      /* not a web url */
    }
  }, [activeUrl]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      setOut(JSON.stringify(await fn(), null, 2));
    } catch (e) {
      setOut(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tools">
      <label className="muted">Host</label>
      <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" />
      <div className="row">
        {(["dns", "headers", "ping", "rdap"] as const).map((t) => (
          <button key={t} className="pill" disabled={busy || !host} onClick={() => run(() => api.netTool(t, host))}>
            {t.toUpperCase()}
          </button>
        ))}
      </div>
      <label className="muted">Send page to a webhook (n8n, Zapier, custom)</label>
      <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="https://hooks.example.com/…" />
      <button
        className="pill"
        disabled={busy || !hook}
        onClick={() => run(async () => api.webhook(hook, await api.readPage()))}
      >
        Send readable text
      </button>
      <pre className="out">{out || "Results appear here."}</pre>
    </div>
  );
}

function SettingsPanel() {
  const [s, setS] = useState<Settings | null>(null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    void api.getSettings().then(setS);
  }, []);
  if (!s) return <p className="muted">Loading…</p>;

  const p = s.provider;
  const preset = PROVIDER_PRESETS.find((x) => x.id === p.id);
  const save = async (patch: Partial<typeof p>) => setS(await api.setSettings({ provider: { ...p, ...patch } }));

  const choose = (id: string) => {
    const pr = PROVIDER_PRESETS.find((x) => x.id === id)!;
    void save({ id, api: pr.api, baseUrl: pr.baseUrl, model: pr.model });
  };

  return (
    <div className="tools">
      <label className="muted">LLM provider (optional — Ibon works without one)</label>
      <select value={p.id} onChange={(e) => choose(e.target.value)}>
        {PROVIDER_PRESETS.map((x) => (
          <option key={x.id} value={x.id}>{x.label}</option>
        ))}
      </select>
      <label className="muted">Base URL</label>
      <input value={p.baseUrl} onChange={(e) => void save({ baseUrl: e.target.value })} />
      <label className="muted">Model</label>
      <input value={p.model} onChange={(e) => void save({ model: e.target.value })} />
      <label className="muted">API key {s.hasKey[p.id] ? "(saved, encrypted)" : preset?.needsKey ? "(required)" : "(optional)"}</label>
      <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s.hasKey[p.id] ? "••••••••" : "paste key"} />
      <div className="row">
        <button
          className="pill on"
          onClick={async () => {
            setS(await api.setKey(p.id, key));
            setKey("");
            setMsg("Key saved");
          }}
        >
          Save key
        </button>
        {s.hasKey[p.id] && (
          <button
            className="pill"
            onClick={async () => {
              setS(await api.setKey(p.id, ""));
              setMsg("Key removed");
            }}
          >
            Remove key
          </button>
        )}
      </div>
      {msg && <p className="muted">{msg}</p>}
      <p className="muted">Keys stay on this device, encrypted with your OS keychain, and are only sent to the provider you choose.</p>
      <Diagnostics />
    </div>
  );
}

function Diagnostics() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [crash, setCrash] = useState<CrashInfo | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    void api.appInfo().then(setInfo).catch(() => {});
    void api.crashInfo().then(setCrash).catch(() => {});
  }, []);

  const crashText =
    crash === null
      ? "…"
      : crash.count === 0
        ? "No crash reports."
        : `${crash.count} crash report${crash.count === 1 ? "" : "s"} (${(crash.bytes / 1048576).toFixed(1)} MB).`;

  return (
    <>
      <label className="muted">Diagnostics</label>
      <p className="muted">{crashText} They stay on this device and are never uploaded.</p>
      <div className="row">
        <button className="pill" onClick={() => api.openCrashFolder().catch((e) => setErr(e instanceof Error ? e.message : "Could not open the folder"))}>
          Open crash folder
        </button>
      </div>
      {err && <p className="error">{err}</p>}
      {info && <p className="muted">Ibon {info.version} · Chromium {info.chromium} · Electron {info.electron} · {info.platform}</p>}
    </>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { api, type FindResult, type PageText, type PermissionRequest, type TabInfo } from "./lib/api";
import { Sidebar, type Panel } from "./components/Sidebar";
import { Reader } from "./components/Reader";
import { CrashNotice } from "./components/CrashNotice";
import { PermissionBar } from "./components/PermissionBar";
import { FindBar } from "./components/FindBar";
import brandIcon from "../assets/brand/ibon-icon.svg";

export function App() {
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [permissionRequests, setPermissionRequests] = useState<PermissionRequest[]>([]);
  const [address, setAddress] = useState("");
  const [editing, setEditing] = useState(false);
  const [panel, setPanel] = useState<Panel>("assistant");
  const [reader, setReader] = useState<{ page?: PageText; error?: string; loading: boolean }>({ loading: false });
  const contentRef = useRef<HTMLDivElement>(null);
  const addressRef = useRef<HTMLInputElement>(null);
  const [findOpen, setFindOpen] = useState(false);
  const [findFocus, setFindFocus] = useState(0);
  const [findResult, setFindResult] = useState<FindResult | null>(null);

  const active = tabs.find((t) => t.active);
  const readMode = Boolean(active?.readMode);
  const crashed = active?.crashed ?? null;
  // The native page view is drawn above this UI, so hide it whenever the UI has to show something instead.
  const showPage = !readMode && !crashed;

  useEffect(() => api.onTabs(setTabs), []);
  useEffect(() => api.onFindResult((r) => setFindResult(r)), []);
  // Keyboard shortcuts that only the interface can carry out.
  useEffect(
    () =>
      api.onShortcut((action) => {
        if (action === "focus-address") {
          addressRef.current?.focus();
          addressRef.current?.select();
        } else if (action === "find") {
          setFindOpen(true);
          setFindFocus((n) => n + 1);
        }
      }),
    [],
  );
  // The find bar belongs to one page: close it when you switch tabs or the page changes.
  useEffect(() => {
    setFindOpen(false);
    setFindResult(null);
  }, [active?.id, active?.url]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindResult(null);
    void api.findStop();
  }, []);
  useEffect(() => {
    void api.permissions().then(setPermissionRequests).catch(() => {});
    return api.onPermissions(setPermissionRequests);
  }, []);
  // Only the tab you are looking at can ask; requests from other tabs wait until you switch to them.
  const myRequests = permissionRequests.filter((r) => r.tabId === active?.id);
  useEffect(() => {
    if (!editing) setAddress(active?.url ?? "");
  }, [active?.url, active?.id, editing]);

  // Tell the main process where the native page view should sit.
  const syncLayout = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    void api.layout({ x: r.x, y: r.y, width: r.width, height: r.height }, showPage);
  }, [showPage]);

  useEffect(() => {
    syncLayout();
    const el = contentRef.current;
    if (!el) return;
    const ro = new ResizeObserver(syncLayout);
    ro.observe(el);
    window.addEventListener("resize", syncLayout);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", syncLayout);
    };
  }, [syncLayout, panel]);

  const loadReader = useCallback(async () => {
    setReader({ loading: true });
    try {
      setReader({ loading: false, page: await api.readPage() });
    } catch (e) {
      setReader({ loading: false, error: e instanceof Error ? e.message : "Could not read page" });
    }
  }, []);

  useEffect(() => {
    if (readMode) void loadReader();
  }, [readMode, active?.id, active?.url, active?.loading, loadReader]);

  const toggleRead = () => void api.setReadMode(!readMode);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setEditing(false);
    void api.navigate(address);
  };

  // Lets the assistant drive the browser through [action:...] tags.
  const runAction = useCallback(
    async (name: string, arg?: string) => {
      if (name === "open_url" && arg) await api.createTab(arg);
      else if (name === "read_mode") await api.setReadMode();
      else if (name === "copy_content") await api.copy((await api.readPage()).text);
      else if (name === "summarize") setPanel("assistant");
    },
    [],
  );


  return (
    <div className="app">
      <div className="tabstrip">
        <img className="brand" src={brandIcon} alt="Ibon" draggable={false} />
        {tabs.map((t) => (
          <div key={t.id} className={`tab${t.active ? " active" : ""}`} onClick={() => api.activateTab(t.id)} title={t.url}>
            <span className="tab-title">{t.loading ? "… " : ""}{t.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                void api.closeTab(t.id);
              }}
              aria-label="Close tab"
            >
              ×
            </button>
          </div>
        ))}
        <button className="icon" onClick={() => api.createTab()} aria-label="New tab" title="New tab">+</button>
      </div>

      <form className="toolbar" onSubmit={submit}>
        <button type="button" className="icon" disabled={!active?.canGoBack} onClick={() => api.back()} title="Back">←</button>
        <button type="button" className="icon" disabled={!active?.canGoForward} onClick={() => api.forward()} title="Forward">→</button>
        <button type="button" className="icon" onClick={() => api.reload()} title="Reload">⟳</button>
        <input
          className="address"
          ref={addressRef}
          value={address}
          onFocus={(e) => {
            setEditing(true);
            e.currentTarget.select();
          }}
          onBlur={() => setEditing(false)}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Search Google or enter address"
          spellCheck={false}
        />
        <button type="button" className={`pill${readMode ? " on" : ""}`} onClick={toggleRead} title="Text-only read mode: blocks images, media and fonts">
          Read mode
        </button>
        <button type="button" className="icon" onClick={() => api.devtools()} title="Developer tools">{"</>"}</button>
        <button type="button" className={`icon${panel ? " on" : ""}`} onClick={() => setPanel(panel ? null : "assistant")} title="Sidebar">☰</button>
      </form>

      {myRequests.length > 0 && (
        <PermissionBar request={myRequests[0]} more={myRequests.length - 1} onRespond={(id, allow) => void api.respondPermission(id, allow)} />
      )}

      {findOpen && (
        <FindBar
          result={findResult}
          focusKey={findFocus}
          onQuery={(text) => {
            setFindResult(null); // searching: show nothing until the first answer
            void api.findRun(text, true, true);
          }}
          onStep={(text, forward) => void api.findRun(text, forward, false)}
          onClose={closeFind}
        />
      )}

      <div className="body">
        <div className="content" ref={contentRef}>
          {crashed ? <CrashNotice reason={crashed} onReload={() => void api.reload()} /> : readMode && <Reader state={reader} blocked={active?.blocked ?? 0} onRefresh={loadReader} />}
        </div>
        {panel && <Sidebar panel={panel} setPanel={setPanel} onAction={runAction} activeUrl={active?.url ?? ""} activeTitle={active?.title ?? ""} />}
      </div>
    </div>
  );
}

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  readMode: boolean;
  /** Requests blocked on the current page: ads and trackers, and in Read mode images, media and fonts. */
  blocked: number;
  /** True when ad and tracker blocking is paused for this site. */
  blockingPaused: boolean;
  /** Why this tab's renderer died (for example "crashed" or "oom"), or null while it is healthy. */
  crashed: string | null;
  active: boolean;
}

/** Find in page: which match is selected, and how many there are. */
export interface FindResult {
  active: number;
  matches: number;
}

/** Things the keyboard asks the interface to do (the rest are done by the main process). */
export type ShortcutAction = "focus-address" | "find";

/** A site asking to use something sensitive. It waits for the user's Allow or Block. */
export interface PermissionRequest {
  id: number;
  tabId: number;
  origin: string;
  permission: "media" | "notifications";
  mediaTypes: ("video" | "audio")[];
}

/** Ad and tracker blocking with uBlock Origin's filter lists. */
export interface BlockerStatus {
  /** ready: the lists are in use. updating: a download is under way. fallback: only the small built-in list. */
  state: "ready" | "updating" | "fallback";
  /** When the lists were last downloaded (ms since 1970); 0 when rebuilt from saved copies; null when there are none. */
  updatedAt: number | null;
  networkRules: number;
  cosmeticRules: number;
  /** Whether uBO's scriptlets (`##+js(...)`) could be loaded. */
  scriptlets: boolean;
  lists: { id: string; name: string; ok: boolean }[];
  myFilters: { rules: number; unsupported: number };
  /** The last download problem, or null. */
  error: string | null;
  pausedSites: string[];
  /** My filters as the user typed them. */
  myFiltersText: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chromium: string;
  platform: string;
}

export interface CrashInfo {
  dir: string;
  count: number;
  bytes: number;
  latest: number | null;
}

export interface Provider {
  id: string;
  api: "openai" | "anthropic";
  baseUrl: string;
  model: string;
}

export interface Bookmark {
  url: string;
  title: string;
}

export interface Settings {
  provider: Provider;
  hasKey: Record<string, boolean>;
  bookmarks: Bookmark[];
  webhooks: { name: string; url: string }[];
}

export interface PageText {
  url: string;
  title: string;
  description: string;
  text: string;
  words: number;
  bytes: number;
}

export type ChatMessage = { role: "user" | "assistant"; content: string };

interface Bridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  onTabs(cb: (tabs: TabInfo[]) => void): () => void;
  onPermissions(cb: (requests: PermissionRequest[]) => void): () => void;
  onShortcut(cb: (action: ShortcutAction) => void): () => void;
  onFindResult(cb: (result: FindResult) => void): () => void;
  onBlocker(cb: (status: BlockerStatus) => void): () => void;
}

declare global {
  interface Window {
    ibon: Bridge;
  }
}

const b = () => window.ibon;

export const api = {
  createTab: (url?: string) => b().invoke<number>("tab:create", url),
  closeTab: (id: number) => b().invoke("tab:close", id),
  activateTab: (id: number) => b().invoke("tab:activate", id),
  navigate: (url: string) => b().invoke("tab:navigate", url),
  back: () => b().invoke("tab:back"),
  forward: () => b().invoke("tab:forward"),
  reload: () => b().invoke("tab:reload"),
  devtools: () => b().invoke("tab:devtools"),
  setReadMode: (on?: boolean) => b().invoke<boolean>("tab:readMode", on),
  layout: (r: { x: number; y: number; width: number; height: number }, visible: boolean) => b().invoke("view:layout", r, visible),
  readPage: () => b().invoke<PageText>("page:read"),
  copy: (text: string) => b().invoke("clipboard:write", text),
  appInfo: () => b().invoke<AppInfo>("app:info"),
  crashInfo: () => b().invoke<CrashInfo>("crash:info"),
  openCrashFolder: () => b().invoke("crash:open"),
  getSettings: () => b().invoke<Settings>("settings:get"),
  setSettings: (patch: Partial<Pick<Settings, "provider" | "bookmarks" | "webhooks">>) => b().invoke<Settings>("settings:set", patch),
  setKey: (id: string, key: string) => b().invoke<Settings>("settings:setKey", id, key),
  chat: (messages: ChatMessage[], withPage: boolean) => b().invoke<string>("ai:chat", messages, withPage),
  summarize: (length: "short" | "medium" | "detailed") => b().invoke<{ summary: string; page: PageText }>("ai:summarize", length),
  netTool: (tool: "dns" | "headers" | "ping" | "rdap", host: string) => b().invoke<unknown>("dev:netTool", tool, host),
  webhook: (url: string, payload: unknown) => b().invoke<{ ok: boolean; status: number }>("dev:webhook", url, payload),
  onTabs: (cb: (tabs: TabInfo[]) => void) => b().onTabs(cb),
  findRun: (text: string, forward: boolean, newSession: boolean) => b().invoke("find:run", text, forward, newSession),
  findStop: () => b().invoke("find:stop"),
  onShortcut: (cb: (action: ShortcutAction) => void) => b().onShortcut(cb),
  onFindResult: (cb: (result: FindResult) => void) => b().onFindResult(cb),
  permissions: () => b().invoke<PermissionRequest[]>("permission:list"),
  respondPermission: (id: number, allow: boolean) => b().invoke("permission:respond", id, allow),
  onPermissions: (cb: (requests: PermissionRequest[]) => void) => b().onPermissions(cb),
  blockerStatus: () => b().invoke<BlockerStatus>("blocker:status"),
  updateFilterLists: () => b().invoke<BlockerStatus>("blocker:update"),
  pauseBlocking: (site: string, paused: boolean) => b().invoke<BlockerStatus>("blocker:pause", site, paused),
  setMyFilters: (text: string) => b().invoke<BlockerStatus>("blocker:setFilters", text),
  onBlocker: (cb: (status: BlockerStatus) => void) => b().onBlocker(cb),
};

const { contextBridge, ipcRenderer } = require("electron");

const call = async (channel, ...args) => {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (!res.ok) throw new Error(res.error);
  return res.data;
};

contextBridge.exposeInMainWorld("ibon", {
  invoke: call,
  onTabs(cb) {
    const listener = (_e, tabs) => cb(tabs);
    ipcRenderer.on("tabs", listener);
    return () => ipcRenderer.removeListener("tabs", listener);
  },
  onShortcut(cb) {
    const listener = (_e, action) => cb(action);
    ipcRenderer.on("shortcut", listener);
    return () => ipcRenderer.removeListener("shortcut", listener);
  },
  onFindResult(cb) {
    const listener = (_e, result) => cb(result);
    ipcRenderer.on("find-result", listener);
    return () => ipcRenderer.removeListener("find-result", listener);
  },
  onPermissions(cb) {
    const listener = (_e, requests) => cb(requests);
    ipcRenderer.on("permissions", listener);
    return () => ipcRenderer.removeListener("permissions", listener);
  },
  onBlocker(cb) {
    const listener = (_e, status) => cb(status);
    ipcRenderer.on("blocker", listener);
    return () => ipcRenderer.removeListener("blocker", listener);
  },
});

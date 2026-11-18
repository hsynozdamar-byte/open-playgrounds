// The bridge between the UI and the main process: state comes in, actions and pane rects go out.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pb", {
  shell: process.argv.includes("--pg-shell"),
  onState: (fn) => ipcRenderer.on("state", (_e, s) => fn(s)),
  onFocusAddress: (fn) => ipcRenderer.on("focusAddress", () => fn()),
  onToggleSide: (fn) => ipcRenderer.on("toggleSide", () => fn()),
  // Playgrounds shell: go to a page (when Rou brings a world forward), the last image of a covered tab.
  onRoute: (fn) => ipcRenderer.on("route", (_e, r) => fn(r)),
  onShot: (fn) => ipcRenderer.on("shot", (_e, x) => fn(x)),
  off: (ch) => ipcRenderer.removeAllListeners(ch),
  act: (a) => ipcRenderer.send("act", a),
  rects: (r) => ipcRenderer.send("rects", r),
});

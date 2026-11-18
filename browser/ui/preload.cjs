// Arayüz ile ana süreç arasındaki köprü: durum gelir, eylemler ve bölme alanları gider.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("pb", {
  shell: process.argv.includes("--pg-shell"),
  onState: (fn) => ipcRenderer.on("state", (_e, s) => fn(s)),
  onFocusAddress: (fn) => ipcRenderer.on("focusAddress", () => fn()),
  onToggleSide: (fn) => ipcRenderer.on("toggleSide", () => fn()),
  // Playgrounds kabuğu: sayfaya git (Rou bir dünyayı öne getirince), örtülen sekmenin son görüntüsü.
  onRoute: (fn) => ipcRenderer.on("route", (_e, r) => fn(r)),
  onShot: (fn) => ipcRenderer.on("shot", (_e, x) => fn(x)),
  off: (ch) => ipcRenderer.removeAllListeners(ch),
  act: (a) => ipcRenderer.send("act", a),
  rects: (r) => ipcRenderer.send("rects", r),
});

// Playgrounds for macOS: a menu bar app that runs the local server and shows the planner in a native window.
// Built by desktop/build.sh. The repo folder and the node binary are written into Info.plist at build time,
// so the app reads and writes the same data/playground.json as `pg` and your AI tools.
import Cocoa
import WebKit
import Carbon.HIToolbox
import ServiceManagement
import UserNotifications

let PORT = 5340
let BASE = URL(string: "http://localhost:\(PORT)/")!
let info = Bundle.main.infoDictionary ?? [:]
let ROOT = (info["PGRoot"] as? String) ?? FileManager.default.currentDirectoryPath
let NODE = (info["PGNode"] as? String) ?? "/usr/local/bin/node"

// MARK: - Server

final class Server {
  private var proc: Process?
  private(set) var ours = false

  // Uses a server that already runs on the port (npm run dev / npm start); otherwise starts server/app.mjs.
  func ensure(_ done: @escaping (Bool) -> Void) {
    ping { up in
      if up { return done(true) }
      self.launch()
      self.wait(tries: 60, done)
    }
  }

  private func ping(_ cb: @escaping (Bool) -> Void) {
    var req = URLRequest(url: BASE.appendingPathComponent("api/state"), timeoutInterval: 1)
    req.httpMethod = "HEAD"
    URLSession.shared.dataTask(with: req) { _, res, _ in
      DispatchQueue.main.async { cb((res as? HTTPURLResponse) != nil) }
    }.resume()
  }

  private func wait(tries: Int, _ done: @escaping (Bool) -> Void) {
    ping { up in
      if up || tries <= 0 { return done(up) }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { self.wait(tries: tries - 1, done) }
    }
  }

  private func launch() {
    if let p = proc, p.isRunning { return }
    let p = Process()
    p.executableURL = URL(fileURLWithPath: NODE)
    p.arguments = ["server/app.mjs"]
    p.currentDirectoryURL = URL(fileURLWithPath: ROOT)
    var env = ProcessInfo.processInfo.environment
    env["PORT"] = String(PORT)
    env["PATH"] = "\((NODE as NSString).deletingLastPathComponent):/usr/bin:/bin"
    p.environment = env
    let logDir = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs")
    let log = logDir.appendingPathComponent("Playgrounds.log")
    FileManager.default.createFile(atPath: log.path, contents: nil)
    if let h = try? FileHandle(forWritingTo: log) { p.standardOutput = h; p.standardError = h }
    do { try p.run(); proc = p; ours = true } catch { NSLog("Playgrounds: could not start node: \(error)") }
  }

  func stop() { if let p = proc, p.isRunning { p.terminate(); p.waitUntilExit() } }
}

// MARK: - Live state (for the timer in the menu bar)

struct TimerState: Decodable {
  let taskId: String; let startedAt: String; let mode: String; let phase: String; let length: Double
  let base: Double?; let pausedAt: String?
}
struct TaskLite: Decodable { let id: String; let title: String; let status: String?; let day: String? }
struct StateLite: Decodable { let tasks: [TaskLite]; let timer: TimerState? }

final class Live: NSObject, URLSessionDataDelegate {
  var onChange: ((StateLite?) -> Void)?
  var onDrop: (() -> Void)?
  private var session: URLSession!
  private var task: URLSessionDataTask?

  override init() {
    super.init()
    let cfg = URLSessionConfiguration.default
    cfg.timeoutIntervalForRequest = .infinity
    session = URLSession(configuration: cfg, delegate: self, delegateQueue: .main)
  }

  // /api/events sends the file's revision on every write; each one reloads the state.
  func connect() {
    task?.cancel()
    var req = URLRequest(url: BASE.appendingPathComponent("api/events"))
    req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
    task = session.dataTask(with: req)
    task?.resume()
  }

  func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if String(decoding: data, as: UTF8.self).contains("data:") { load() }
  }

  func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    if (error as? URLError)?.code == .cancelled { return }
    onDrop?()
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.connect() }
  }

  func load() {
    URLSession.shared.dataTask(with: BASE.appendingPathComponent("api/state")) { data, _, _ in
      let s = data.flatMap { try? JSONDecoder().decode(StateLite.self, from: $0) }
      DispatchQueue.main.async { self.onChange?(s) }
    }.resume()
  }
}

let iso: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return f }()
let isoPlain = ISO8601DateFormatter()
func parse(_ s: String) -> Date? { iso.date(from: s) ?? isoPlain.date(from: s) }

func clock(_ sec: Int) -> String {
  let s = max(0, sec)
  return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
}

// MARK: - Window

final class Web: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
  let view: WKWebView

  override init() {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .default()
    // window.Notification in the page becomes a native notification.
    let shim = """
    (() => {
      const post = (title, o) => window.webkit.messageHandlers.notify.postMessage({ title: String(title), body: String((o && o.body) || "") });
      function N(title, o) { post(title, o); this.close = () => {}; }
      N.permission = "granted";
      N.requestPermission = (cb) => { window.webkit.messageHandlers.notify.postMessage({ ask: true }); cb && cb("granted"); return Promise.resolve("granted"); };
      window.Notification = N;
      document.documentElement.classList.add("mac-app");
    })();
    """
    cfg.userContentController.addUserScript(WKUserScript(source: shim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    view = WKWebView(frame: .zero, configuration: cfg)
    super.init()
    cfg.userContentController.add(self, name: "notify")
    view.navigationDelegate = self
    view.uiDelegate = self
    view.allowsBackForwardNavigationGestures = false
    view.setValue(false, forKey: "drawsBackground")
  }

  func load() { view.load(URLRequest(url: BASE)) }

  func showError() {
    let html = """
    <html><body style="font:14px -apple-system;display:grid;place-items:center;height:100vh;margin:0;color:#8a919e;background:transparent">
    <div style="text-align:center"><p style="font-size:16px;color:#555">Playgrounds is not running.</p>
    <p>Run <code>npm run build</code> in the repo, then reopen the app.<br>Log: ~/Library/Logs/Playgrounds.log</p>
    <p><a href="\(BASE.absoluteString)" style="color:#8a72ff">Try again</a></p></div></body></html>
    """
    view.loadHTMLString(html, baseURL: nil)
  }

  // Links to other sites open in the default browser.
  func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    if let u = a.request.url, let h = u.host, h != "localhost" && h != "127.0.0.1", u.scheme?.hasPrefix("http") == true {
      NSWorkspace.shared.open(u); return decisionHandler(.cancel)
    }
    decisionHandler(.allow)
  }

  func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = a.request.url { NSWorkspace.shared.open(u) }
    return nil
  }

  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) { showError() }

  func webViewWebContentProcessDidTerminate(_ w: WKWebView) { load() }

  func webView(_ w: WKWebView, runOpenPanelWith p: WKOpenPanelParameters, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
    let panel = NSOpenPanel()
    panel.allowsMultipleSelection = p.allowsMultipleSelection
    panel.canChooseDirectories = false
    panel.begin { completionHandler($0 == .OK ? panel.urls : nil) }
  }

  func webView(_ w: WKWebView, runJavaScriptAlertPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping () -> Void) {
    let a = NSAlert(); a.messageText = m; a.runModal(); completionHandler()
  }

  func webView(_ w: WKWebView, runJavaScriptConfirmPanelWithMessage m: String, initiatedByFrame f: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
    let a = NSAlert(); a.messageText = m; a.addButton(withTitle: "OK"); a.addButton(withTitle: "Cancel")
    completionHandler(a.runModal() == .alertFirstButtonReturn)
  }

  func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
    guard let d = m.body as? [String: Any] else { return }
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { ok, _ in
      guard ok, let title = d["title"] as? String else { return }
      let n = UNMutableNotificationContent()
      n.title = title
      n.body = (d["body"] as? String) ?? ""
      center.add(UNNotificationRequest(identifier: UUID().uuidString, content: n, trigger: nil))
    }
  }
}

final class Window: NSWindow {
  // ⌘W hides; the app keeps running in the menu bar.
  override func performClose(_ sender: Any?) { orderOut(nil); (NSApp.delegate as? App)?.windowHidden() }
}

// MARK: - App

final class App: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuDelegate, UNUserNotificationCenterDelegate {
  let server = Server()
  let live = Live()
  var item: NSStatusItem!
  var window: Window!
  var web: Web!
  var state: StateLite?
  var tick: Timer?
  var hotKey: EventHotKeyRef?
  var restarting = false

  func applicationDidFinishLaunching(_ n: Notification) {
    UNUserNotificationCenter.current().delegate = self
    buildMainMenu()
    buildStatusItem()
    buildWindow()
    server.ensure { up in
      if up { self.web.load(); self.live.connect() } else { self.web.showError() }
    }
    live.onChange = { [weak self] s in self?.state = s; self?.refreshTitle() }
    // The server went away (e.g. npm run dev was stopped): start our own; the page reconnects by itself.
    live.onDrop = { [weak self] in
      guard let self, !self.restarting else { return }
      self.restarting = true
      self.server.ensure { _ in self.restarting = false }
    }
    tick = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.refreshTitle() }
    registerHotKey()
    showWindow()
  }

  func applicationWillTerminate(_ n: Notification) { server.stop() }

  // Clicking the Dock icon (while the window is shown) or reopening the app brings the window back.
  func applicationShouldHandleReopen(_ s: NSApplication, hasVisibleWindows: Bool) -> Bool { showWindow(); return false }

  func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler h: @escaping (UNNotificationPresentationOptions) -> Void) {
    h([.banner, .sound])
  }

  func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler h: @escaping () -> Void) {
    showWindow(); h()
  }

  // Status item: the orb. Left click toggles the window, right click (or ⌃ click) opens the menu.
  func buildStatusItem() {
    item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    guard let b = item.button else { return }
    b.image = orbImage(size: 16)
    b.imagePosition = .imageLeading
    b.target = self
    b.action = #selector(statusClick)
    b.sendAction(on: [.leftMouseUp, .rightMouseUp])
    b.toolTip = "Playgrounds"
  }

  // orb.png is the logo with a transparent ground (desktop/make-icon.swift).
  func orbImage(size: CGFloat) -> NSImage {
    guard let src = Bundle.main.image(forResource: "orb") else { return NSImage(systemSymbolName: "circle.fill", accessibilityDescription: "Playgrounds")! }
    let img = NSImage(size: NSSize(width: size, height: size), flipped: false) { r in
      src.draw(in: r, from: .zero, operation: .sourceOver, fraction: 1); return true
    }
    img.accessibilityDescription = "Playgrounds"
    return img
  }

  @objc func statusClick() {
    let e = NSApp.currentEvent
    if e?.type == .rightMouseUp || e?.modifierFlags.contains(.control) == true {
      item.menu = buildMenu()
      item.button?.performClick(nil)
      item.menu = nil
    } else {
      toggleWindow()
    }
  }

  func buildMenu() -> NSMenu {
    let m = NSMenu()
    if let t = state?.timer {
      let title = state?.tasks.first { $0.id == t.taskId }?.title ?? "Timer"
      let head = NSMenuItem(title: "\(t.pausedAt == nil ? "●" : "❚❚")  \(title)", action: #selector(showWindowAction), keyEquivalent: "")
      head.target = self
      m.addItem(head)
      m.addItem(.separator())
    }
    let today = todayOpen()
    if !today.isEmpty {
      let h = NSMenuItem(title: "Today", action: nil, keyEquivalent: ""); h.isEnabled = false
      m.addItem(h)
      for t in today.prefix(8) {
        let i = NSMenuItem(title: (t.status == "doing" ? "◐  " : "○  ") + t.title, action: #selector(showWindowAction), keyEquivalent: "")
        i.target = self
        m.addItem(i)
      }
      if today.count > 8 { let more = NSMenuItem(title: "\(today.count - 8) more…", action: #selector(showWindowAction), keyEquivalent: ""); more.target = self; m.addItem(more) }
      m.addItem(.separator())
    }
    add(m, "Open Playgrounds", #selector(showWindowAction), "p", [.option, .command])
    add(m, "Open in browser", #selector(openBrowser))
    m.addItem(.separator())
    let login = add(m, "Open at login", #selector(toggleLogin))
    login.state = SMAppService.mainApp.status == .enabled ? .on : .off
    m.addItem(.separator())
    add(m, "Quit Playgrounds", #selector(quit), "q")
    return m
  }

  @discardableResult
  func add(_ m: NSMenu, _ title: String, _ sel: Selector, _ key: String = "", _ mods: NSEvent.ModifierFlags = [.command]) -> NSMenuItem {
    let i = NSMenuItem(title: title, action: sel, keyEquivalent: key)
    i.keyEquivalentModifierMask = mods
    i.target = self
    m.addItem(i)
    return i
  }

  func todayOpen() -> [TaskLite] {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
    let d = f.string(from: Date())
    return (state?.tasks ?? []).filter { $0.day == d && $0.status != "done" }
  }

  // The running timer shows next to the orb.
  func refreshTitle() {
    guard let b = item?.button else { return }
    guard let t = state?.timer, let start = parse(t.startedAt) else {
      if !b.title.isEmpty { b.title = "" }
      return
    }
    let seg = t.pausedAt == nil ? Int(Date().timeIntervalSince(start)) : 0
    let done = Int(t.base ?? 0) + seg
    let sec = t.mode == "pomo" ? Int(t.length * 60) - done : done
    let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize - 1, weight: .medium)
    let label = (t.phase == "break" ? "Break " : "") + clock(sec) + (t.pausedAt == nil ? "" : " ❚❚")
    b.attributedTitle = NSAttributedString(string: " " + label, attributes: [.font: font, .baselineOffset: 0.5])
  }

  func buildWindow() {
    web = Web()
    window = Window(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                    styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                    backing: .buffered, defer: false)
    window.title = "Playgrounds"
    window.titleVisibility = .hidden
    window.titlebarAppearsTransparent = true
    window.isMovableByWindowBackground = false
    window.minSize = NSSize(width: 720, height: 520)
    window.backgroundColor = NSColor(name: nil) { a in
      a.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? NSColor(srgbRed: 0.039, green: 0.043, blue: 0.055, alpha: 1) : NSColor(srgbRed: 0.957, green: 0.961, blue: 0.969, alpha: 1)
    }
    window.isReleasedWhenClosed = false
    window.delegate = self
    window.tabbingMode = .disallowed

    // The page sits below a thin drag strip, so the traffic lights never cover the app.
    let root = NSView()
    let drag = DragStrip()
    web.view.translatesAutoresizingMaskIntoConstraints = false
    drag.translatesAutoresizingMaskIntoConstraints = false
    root.addSubview(web.view)
    root.addSubview(drag)
    NSLayoutConstraint.activate([
      drag.topAnchor.constraint(equalTo: root.topAnchor),
      drag.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      drag.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      drag.heightAnchor.constraint(equalToConstant: 28),
      web.view.topAnchor.constraint(equalTo: drag.bottomAnchor),
      web.view.leadingAnchor.constraint(equalTo: root.leadingAnchor),
      web.view.trailingAnchor.constraint(equalTo: root.trailingAnchor),
      web.view.bottomAnchor.constraint(equalTo: root.bottomAnchor),
    ])
    window.contentView = root
    window.setFrameAutosaveName("PlaygroundsMain")
    if !window.setFrameUsingName("PlaygroundsMain") { window.center() }
  }

  func showWindow() {
    NSApp.setActivationPolicy(.regular)
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  func toggleWindow() {
    if window.isVisible && window.isKeyWindow && NSApp.isActive { window.orderOut(nil); windowHidden() } else { showWindow() }
  }

  // With the window gone, the app leaves the Dock and lives only in the menu bar.
  func windowHidden() {
    NSApp.setActivationPolicy(.accessory)
    NSApp.hide(nil)
  }

  func windowShouldClose(_ w: NSWindow) -> Bool { w.orderOut(nil); windowHidden(); return false }

  @objc func showWindowAction() { showWindow() }
  @objc func openBrowser() { NSWorkspace.shared.open(BASE) }
  @objc func reload() { web.load() }
  @objc func quit() { NSApp.terminate(nil) }
  @objc func zoomIn() { web.view.pageZoom = min(2, web.view.pageZoom + 0.1) }
  @objc func zoomOut() { web.view.pageZoom = max(0.6, web.view.pageZoom - 0.1) }
  @objc func zoomReset() { web.view.pageZoom = 1 }

  @objc func toggleLogin() {
    let s = SMAppService.mainApp
    do { if s.status == .enabled { try s.unregister() } else { try s.register() } }
    catch {
      let a = NSAlert(); a.messageText = "Could not change Open at login"; a.informativeText = error.localizedDescription; a.runModal()
    }
  }

  // Main menu: needed for ⌘C / ⌘V / ⌘Z in the page, plus reload and zoom.
  func buildMainMenu() {
    let main = NSMenu()
    func sub(_ title: String, _ items: [(String, Selector?, String, NSEvent.ModifierFlags, AnyObject?)]) {
      let top = NSMenuItem(); let m = NSMenu(title: title); top.submenu = m; main.addItem(top)
      for (t, sel, key, mods, target) in items {
        if t == "-" { m.addItem(.separator()); continue }
        let i = NSMenuItem(title: t, action: sel, keyEquivalent: key); i.keyEquivalentModifierMask = mods; i.target = target; m.addItem(i)
      }
    }
    sub("Playgrounds", [
      ("Open in browser", #selector(openBrowser), "", [], self),
      ("-", nil, "", [], nil),
      ("Hide window", #selector(NSWindow.performClose(_:)), "w", [.command], nil),
      ("Quit Playgrounds", #selector(quit), "q", [.command], self),
    ])
    sub("Edit", [
      ("Undo", Selector(("undo:")), "z", [.command], nil),
      ("Redo", Selector(("redo:")), "z", [.command, .shift], nil),
      ("-", nil, "", [], nil),
      ("Cut", #selector(NSText.cut(_:)), "x", [.command], nil),
      ("Copy", #selector(NSText.copy(_:)), "c", [.command], nil),
      ("Paste", #selector(NSText.paste(_:)), "v", [.command], nil),
      ("Select all", #selector(NSText.selectAll(_:)), "a", [.command], nil),
    ])
    sub("View", [
      ("Reload", #selector(reload), "r", [.command], self),
      ("-", nil, "", [], nil),
      ("Zoom in", #selector(zoomIn), "+", [.command], self),
      ("Zoom out", #selector(zoomOut), "-", [.command], self),
      ("Actual size", #selector(zoomReset), "0", [.command], self),
      ("-", nil, "", [], nil),
      ("Enter full screen", #selector(NSWindow.toggleFullScreen(_:)), "f", [.command, .control], nil),
    ])
    sub("Window", [
      ("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m", [.command], nil),
    ])
    NSApp.mainMenu = main
  }

  // ⌥⌘P from anywhere shows or hides the window.
  func registerHotKey() {
    var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
    InstallEventHandler(GetApplicationEventTarget(), { _, _, ctx in
      let me = Unmanaged<App>.fromOpaque(ctx!).takeUnretainedValue()
      DispatchQueue.main.async { me.toggleWindow() }
      return noErr
    }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), nil)
    let id = EventHotKeyID(signature: OSType(0x5047_4E44), id: 1)
    RegisterEventHotKey(UInt32(kVK_ANSI_P), UInt32(cmdKey | optionKey), id, GetApplicationEventTarget(), 0, &hotKey)
  }
}

// A transparent strip under the title bar that moves the window and zooms on double click.
final class DragStrip: NSView {
  override var mouseDownCanMoveWindow: Bool { true }
  override func mouseUp(with e: NSEvent) {
    if e.clickCount == 2 { window?.performZoom(nil) }
  }
}

let app = NSApplication.shared
let delegate = App()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

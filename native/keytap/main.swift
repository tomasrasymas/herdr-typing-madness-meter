// keytap: listen-only keyboard counter for the typing-madness-meter herdr plugin.
//
// Privacy: this helper never emits key codes or characters. Each key-down is
// reduced to a class (char | backspace | enter | other) before it leaves the
// process, and only while an allowlisted terminal app is frontmost.
//
// Output: NDJSON on stdout.
//   {"status":"ready"} | {"status":"no_permission"} | {"status":"tap_failed"}
//   {"t":<ms since epoch>,"c":"char"}
// The process exits when stdin closes, so it never outlives its parent.

import AppKit
import CoreGraphics
import Foundation

setvbuf(stdout, nil, _IOLBF, 0)

var allowlist: Set<String> = [
    "com.googlecode.iterm2",
    "com.mitchellh.ghostty",
    "com.apple.Terminal",
    "com.github.wez.wezterm",
    "net.kovidgoyal.kitty",
    "org.alacritty",
    "dev.warp.Warp-Stable",
]
var allowAny = false

var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
    switch arg {
    case "--allow":
        if let list = args.popFirst() {
            allowlist = Set(list.split(separator: ",").map { String($0) })
        }
    case "--allow-any":
        allowAny = true
    default:
        break
    }
}

func emit(_ line: String) {
    print(line)
}

// Track the frontmost app through activation notifications; reading
// frontmostApplication on every key would also work but costs more.
var frontmostAllowed: Bool = {
    guard let id = NSWorkspace.shared.frontmostApplication?.bundleIdentifier else { return false }
    return allowAny || allowlist.contains(id)
}()

NSWorkspace.shared.notificationCenter.addObserver(
    forName: NSWorkspace.didActivateApplicationNotification,
    object: nil,
    queue: .main
) { note in
    let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
    let id = app?.bundleIdentifier ?? ""
    frontmostAllowed = allowAny || allowlist.contains(id)
}

// Exit when the parent closes our stdin.
Thread.detachNewThread {
    while let _ = readLine(strippingNewline: true) {}
    exit(0)
}

var tap: CFMachPort?

func classify(_ event: CGEvent) -> String? {
    let flags = event.flags
    if flags.contains(.maskCommand) { return nil }
    let code = event.getIntegerValueField(.keyboardEventKeycode)
    switch code {
    case 51, 117: return "backspace"
    case 36, 76: return "enter"
    default: break
    }
    if flags.contains(.maskControl) { return "other" }
    var length = 0
    var chars = [UniChar](repeating: 0, count: 4)
    event.keyboardGetUnicodeString(maxStringLength: 4, actualStringLength: &length, unicodeString: &chars)
    guard length > 0 else { return "other" }
    // Printable if not a control char and not in the private-use area that
    // macOS uses for function and arrow keys.
    let u = chars[0]
    if u < 0x20 || u == 0x7F || (u >= 0xF700 && u <= 0xF8FF) { return "other" }
    return "char"
}

let callback: CGEventTapCallBack = { _, type, event, _ in
    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
        if let tap = tap { CGEvent.tapEnable(tap: tap, enable: true) }
        return Unmanaged.passUnretained(event)
    }
    guard type == .keyDown, frontmostAllowed else { return Unmanaged.passUnretained(event) }
    if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return Unmanaged.passUnretained(event) }
    if let cls = classify(event) {
        let ms = Int64(Date().timeIntervalSince1970 * 1000)
        emit("{\"t\":\(ms),\"c\":\"\(cls)\"}")
    }
    return Unmanaged.passUnretained(event)
}

func startTap() -> Bool {
    let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
    guard let created = CGEvent.tapCreate(
        tap: .cgSessionEventTap,
        place: .headInsertEventTap,
        options: .listenOnly,
        eventsOfInterest: mask,
        callback: callback,
        userInfo: nil
    ) else { return false }
    tap = created
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, created, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: created, enable: true)
    return true
}

if CGPreflightListenEventAccess() {
    emit(startTap() ? "{\"status\":\"ready\"}" : "{\"status\":\"tap_failed\"}")
} else {
    CGRequestListenEventAccess()
    emit("{\"status\":\"no_permission\"}")
    // Poll until the user grants access, then start without a restart.
    Timer.scheduledTimer(withTimeInterval: 2.0, repeats: true) { timer in
        if CGPreflightListenEventAccess() {
            timer.invalidate()
            emit(startTap() ? "{\"status\":\"ready\"}" : "{\"status\":\"tap_failed\"}")
        }
    }
}

RunLoop.main.run()

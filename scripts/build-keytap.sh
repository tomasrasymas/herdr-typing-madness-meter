#!/bin/sh
# Build the keytap helper as a minimal, ad-hoc signed .app bundle so macOS
# gives it a stable identity for the Input Monitoring permission.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
app="$root/bin/keytap.app"
mkdir -p "$app/Contents/MacOS"

swiftc -O -o "$app/Contents/MacOS/keytap" "$root/native/keytap/main.swift"

cat > "$app/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key><string>dev.typing-madness-meter.keytap</string>
  <key>CFBundleName</key><string>typing-madness-meter keytap</string>
  <key>CFBundleExecutable</key><string>keytap</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict>
</plist>
PLIST

codesign --force -s - --identifier dev.typing-madness-meter.keytap "$app"
echo "built $app"

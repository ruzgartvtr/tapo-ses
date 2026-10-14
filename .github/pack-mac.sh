#!/bin/bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

pack() {
  local app="$1"
  local zipname="$2"
  local dir
  dir="$(mktemp -d)"
  cp -R "$app" "$dir/Tapo Ses.app"
  codesign --force --deep --sign - "$dir/Tapo Ses.app"
  cat > "$dir/Ac.command" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
xattr -cr "Tapo Ses.app"
open "Tapo Ses.app"
EOF
  chmod +x "$dir/Ac.command"
  rm -f "release/$zipname"
  (cd "$dir" && zip -r -y -q "$root/release/$zipname" "Tapo Ses.app" "Ac.command")
}

pack "release/mac-arm64/Tapo Ses.app" "Tapo Ses-0.1.0-arm64-mac.zip"
pack "release/mac/Tapo Ses.app" "Tapo Ses-0.1.0-mac.zip"

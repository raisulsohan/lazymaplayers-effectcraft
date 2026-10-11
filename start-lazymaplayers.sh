#!/bin/sh
# LazyMapLayers for EffectCraft (macOS and Linux): starts EffectCraft with its control channel when it
# is not running yet, and opens the LazyMapLayers panel in its own window. Close that window to stop.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "LazyMapLayers for EffectCraft needs Node.js 22 or newer: https://nodejs.org"
  exit 1
fi
if [ ! -f dist/host/lazymaplayers-effectcraft.jsx ]; then
  node tools/build.mjs || exit 1
fi
exec node app/server.mjs "$@"

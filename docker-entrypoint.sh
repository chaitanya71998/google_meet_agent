#!/usr/bin/env bash
set -e

# Start a virtual X display so headful Chrome can run without a physical monitor.
Xvfb :99 -screen 0 1280x720x24 >/dev/null 2>&1 &
XVFB_PID=$!

cleanup() {
  kill $XVFB_PID 2>/dev/null || true
}
trap cleanup EXIT

exec node dist/server.js

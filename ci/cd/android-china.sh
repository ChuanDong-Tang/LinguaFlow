#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# China builds use Alipay and are never submitted to Google Play.
export OIO_ANDROID_TARGET=china
exec bash "$SCRIPT_DIR/android-play.sh" --build-only "$@"

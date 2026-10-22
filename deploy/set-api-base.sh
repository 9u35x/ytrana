#!/bin/sh
set -eu

if [ -z "${YTRANA_API_BASE:-}" ]; then
  echo "YTRANA_API_BASE is required for the self-hosted frontend" >&2
  exit 1
fi
case "$YTRANA_API_BASE" in
  http://*|https://*) ;;
  *) echo "YTRANA_API_BASE must start with http:// or https://" >&2; exit 1 ;;
esac
case "$YTRANA_API_BASE" in
  *[!A-Za-z0-9._:/-]*) echo "YTRANA_API_BASE contains unsupported characters" >&2; exit 1 ;;
esac

api_base=${YTRANA_API_BASE%/}
printf 'const YTRANA_CONFIG = { API_BASE: "%s" };\n' "$api_base" > /usr/share/nginx/html/js/config.js

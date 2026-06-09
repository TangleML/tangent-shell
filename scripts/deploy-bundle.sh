#!/usr/bin/env bash
#
# Bumps a Configuration Bundle's semver, repacks it, and installs it to a
# running Tangent server.
#
# Usage:
#   scripts/deploy-bundle.sh [SOURCE_DIR] [options]
#
# Arguments:
#   SOURCE_DIR            Bundle source folder (default:
#                         examples/configs/tangle-ml-pipeline-optimizer).
#                         May also be passed via -s/--source.
#
# Options:
#   -s, --source DIR      Bundle source folder (same as the positional arg).
#   -b, --bump PART       Which semver part to bump: major | minor | patch | none
#                         (default: minor). Bumping a part resets lower parts.
#   -u, --server URL      Tangent server base URL (default: http://localhost:8787).
#       --no-install      Bump + pack only; skip the upload to the server.
#       --reinstall       DELETE an existing bundle of the same id before upload
#                         (use with --bump none to overwrite without a version bump).
#   -h, --help            Show this help.
#
# The bundle id and version are read from <SOURCE_DIR>/tangent.yaml. The packed
# archive lands at examples/configs/<id>.zip (see scripts/pack-bundle.mjs).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

SOURCE_DIR="examples/configs/tangle-ml-pipeline-optimizer"
BUMP="minor"
SERVER="http://localhost:8787"
DO_INSTALL=1
REINSTALL=0

usage() {
  sed -n '2,32p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    -s|--source) SOURCE_DIR="$2"; shift 2 ;;
    -b|--bump) BUMP="$2"; shift 2 ;;
    -u|--server) SERVER="$2"; shift 2 ;;
    --no-install) DO_INSTALL=0; shift ;;
    --reinstall) REINSTALL=1; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) echo "error: unknown option '$1'" >&2; usage >&2; exit 1 ;;
    *) SOURCE_DIR="$1"; shift ;;
  esac
done

case "$BUMP" in
  major|minor|patch|none) ;;
  *) echo "error: --bump must be one of major|minor|patch|none (got '$BUMP')" >&2; exit 1 ;;
esac

cd "$REPO_ROOT"

MANIFEST="$SOURCE_DIR/tangent.yaml"
if [[ ! -f "$MANIFEST" ]]; then
  echo "error: manifest not found: $MANIFEST" >&2
  exit 1
fi

# Bump the semver in place, resetting all lower-order parts to 0.
if [[ "$BUMP" != "none" ]]; then
  perl -i -pe "
    s/^(version:\s*)(\d+)\.(\d+)\.(\d+).*\$/
      my (\$pre,\$maj,\$min,\$pat)=(\$1,\$2,\$3,\$4);
      if ('$BUMP' eq 'major') { \$maj++; \$min=0; \$pat=0; }
      elsif ('$BUMP' eq 'minor') { \$min++; \$pat=0; }
      else { \$pat++; }
      \"\$pre\$maj.\$min.\$pat\";
    /e
  " "$MANIFEST"
fi

# Read id + version straight from the manifest (simple flat scalar lookups).
BUNDLE_ID="$(sed -n 's/^id:[[:space:]]*//p' "$MANIFEST" | head -n1 | tr -d '\r')"
BUNDLE_VERSION="$(sed -n 's/^version:[[:space:]]*//p' "$MANIFEST" | head -n1 | tr -d '\r')"

if [[ -z "$BUNDLE_ID" ]]; then
  echo "error: could not read 'id' from $MANIFEST" >&2
  exit 1
fi

echo "Bundle:  $BUNDLE_ID@$BUNDLE_VERSION"
echo "Source:  $SOURCE_DIR"

# Pack into examples/configs/<id>.zip.
pnpm pack:bundle "$SOURCE_DIR"
ZIP_PATH="examples/configs/$BUNDLE_ID.zip"

if [[ "$DO_INSTALL" -eq 0 ]]; then
  echo "Packed (install skipped): $ZIP_PATH"
  exit 0
fi

if [[ "$REINSTALL" -eq 1 ]]; then
  echo "Removing any existing bundle '$BUNDLE_ID' on $SERVER ..."
  curl -sS -X DELETE "$SERVER/api/agent-bundles/$BUNDLE_ID" -o /dev/null || true
fi

echo "Installing to $SERVER ..."
HTTP_CODE="$(curl -sS -o /tmp/deploy-bundle-resp.json -w '%{http_code}' \
  -X POST "$SERVER/api/agent-bundles" \
  -F "bundle=@$ZIP_PATH;type=application/zip")"

echo "HTTP $HTTP_CODE"
cat /tmp/deploy-bundle-resp.json 2>/dev/null || true
echo

if [[ "$HTTP_CODE" != "201" ]]; then
  echo "error: install failed (HTTP $HTTP_CODE)" >&2
  [[ "$HTTP_CODE" == "409" ]] && echo "hint: $BUNDLE_ID@$BUNDLE_VERSION already exists; bump the version or pass --reinstall." >&2
  exit 1
fi

echo "Installed $BUNDLE_ID@$BUNDLE_VERSION."

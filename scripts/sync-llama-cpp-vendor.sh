#!/usr/bin/env bash
#
# Re-vendor llama.cpp inside node_modules/llama.rn to a newer upstream build.
#
# llama.rn ships a *patched* llama.cpp: its own changes to llama.cpp internals
# (chat parsing, PEG parser, sampling, OpenCL kernels, ...) live as .patch files
# in the llama.rn repo, not in the published npm package. Bumping llama.rn
# therefore cannot move llama.cpp on its own — this script rebuilds the vendored
# tree from a pristine upstream tag and re-applies llama.rn's patches on top.
#
# Usage:
#   scripts/sync-llama-cpp-vendor.sh <build-tag> [commit]
#   scripts/sync-llama-cpp-vendor.sh b11979
#   scripts/sync-llama-cpp-vendor.sh b11979 bf48103ad164d919fbad6a28359c3f728e4ad942
#
# The commit is resolved from the tag when omitted.
#
# This is an unsupported, experimental path: llama.rn's patches are written
# against the llama.cpp revision it vendors, so hunks legitimately fail on a
# newer tree and need hand-resolution. Everything it cannot apply is reported
# and left untouched (the file keeps the pristine upstream content).
#
# Env:
#   LLAMA_RN_TAG  llama.rn release whose patch set is replayed
#                 (default: the version installed in node_modules)
#   KEEP_WORK     set to 1 to keep the extracted trees for inspection

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLAMA_RN="$ROOT/node_modules/llama.rn"
VENDOR="$LLAMA_RN/vendor/llama.cpp"
UPSTREAM_REPO="https://github.com/ggml-org/llama.cpp"
LLAMA_RN_REPO="https://github.com/mybigday/llama.rn"

TAG="${1:-}"
COMMIT="${2:-}"

if [ -z "$TAG" ]; then
  echo "usage: $0 <build-tag> [commit]" >&2
  exit 1
fi

if [ ! -d "$VENDOR" ]; then
  echo "error: $VENDOR not found; run yarn install first" >&2
  exit 1
fi

if [ -z "${LLAMA_RN_TAG:-}" ]; then
  # `node -p` needs a path it understands: resolve from the repo root instead of
  # passing MSYS-style paths, which Windows node does not accept.
  LLAMA_RN_TAG="v$(cd "$ROOT" && node -p "require('./node_modules/llama.rn/package.json').version")"
fi

BUILD_NUMBER="${TAG#b}"
if ! [[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "error: '$TAG' does not look like a llama.cpp build tag (b<number>)" >&2
  exit 1
fi

if [ -z "$COMMIT" ]; then
  COMMIT="$(git ls-remote --tags "$UPSTREAM_REPO" "refs/tags/$TAG^{}" "refs/tags/$TAG" |
    awk 'NR==1 {print $1}')"
  if [ -z "$COMMIT" ]; then
    echo "error: cannot resolve tag $TAG on $UPSTREAM_REPO" >&2
    exit 1
  fi
fi

WORK="$(mktemp -d)"
cleanup() {
  if [ "${KEEP_WORK:-0}" = "1" ]; then
    echo "work dir kept: $WORK"
  else
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

echo "llama.cpp : $TAG ($COMMIT)"
echo "llama.rn  : $LLAMA_RN_TAG"
echo "work      : $WORK"

# 1. Pristine upstream tree at the target tag.
curl -fsSL "$UPSTREAM_REPO/archive/$COMMIT.tar.gz" -o "$WORK/llama.cpp.tgz"
mkdir -p "$WORK/llama.cpp"
tar xzf "$WORK/llama.cpp.tgz" -C "$WORK/llama.cpp" --strip-components=1

# Upstream ships an application tree llama.rn never compiles. Mirror the export
# subset described in llama.rn's vendor/README.md: it keeps the tree small and,
# more importantly, keeps every CLI's main() out of rnllama's source globs —
# cmake/rnllama-sources.cmake globs tools/mtmd/*.cpp, whose CLI helpers would
# collide with the JNI wrapper at link time.
LL="$WORK/llama.cpp"
for dir in app benches ci conversion docs examples tests tools .devops .github .agents .pi; do
  rm -rf "$LL/$dir"
done
# Desktop-only GPU backends, excluded from llama.rn's package as well.
rm -rf "$LL/ggml/src/ggml-cuda" "$LL/ggml/src/ggml-vulkan" "$LL/ggml/src/ggml-webgpu"

# The mtmd library is the one part of tools/ the builds need; restore it without
# its CLIs.
for entry in tools/mtmd/*.h tools/mtmd/*.cpp tools/mtmd/models; do
  rm -rf "$LL/$entry"
done
mkdir -p "$LL/tools"
tar xzf "$WORK/llama.cpp.tgz" -C "$LL" --strip-components=1 \
  --wildcards '*/tools/mtmd/*' 2>/dev/null || true
grep -rlE '^[[:space:]]*int main[[:space:]]*\(' "$LL/tools/mtmd" | xargs -r rm -f

# 2. llama.rn's llama.cpp patch set for the release being kept.
curl -fsSL "https://codeload.github.com/mybigday/llama.rn/tar.gz/refs/tags/$LLAMA_RN_TAG" \
  -o "$WORK/llama.rn.tgz"
mkdir -p "$WORK/llama.rn"
tar xzf "$WORK/llama.rn.tgz" -C "$WORK/llama.rn" --strip-components=1
PATCH_DIR="$WORK/llama.rn/scripts/patches/llama.cpp"

if [ ! -d "$PATCH_DIR" ]; then
  echo "error: $LLAMA_RN_TAG has no scripts/patches/llama.cpp" >&2
  exit 1
fi

# 3. Replace the vendored tree. Keep llama.rn's own build-info.cpp out of the
#    way: it hardcodes the build number and is rewritten below.
cp -a "$VENDOR/../VERSIONS" "$WORK/VERSIONS.orig"

echo
echo "== applying llama.rn patches =="
FAILED=0
for patch_file in "$PATCH_DIR"/*.patch; do
  name="$(basename "$patch_file" .patch)"
  if out="$(patch -p1 -l -F3 --no-backup-if-mismatch -d "$WORK/llama.cpp" -i "$patch_file" 2>&1)"; then
    fuzzy="$(printf '%s\n' "$out" | grep -c 'fuzz' || true)"
    if [ "$fuzzy" -gt 0 ]; then
      echo "  WARN $name (applied with fuzz: review the hunks)"
    else
      echo "  ok   $name"
    fi
  else
    FAILED=$((FAILED + 1))
    echo "  FAIL $name"
    printf '%s\n' "$out" | grep -E 'FAILED|Hunk' | sed 's/^/         /' || true
  fi
done

# 4. build-info.cpp: llama.rn replaces upstream's git-derived version strings
#    with constants, which is what the JS `BuildInfo` export reads.
cat > "$WORK/llama.cpp/common/build-info.cpp" <<EOF
#include "build-info.h"

#include <cstdio>
#include <string>

int LLAMA_BUILD_NUMBER = $BUILD_NUMBER;
char const * LLAMA_COMMIT = "${COMMIT:0:7}";
char const * LLAMA_COMPILER = "unknown";
char const * LLAMA_BUILD_TARGET = "unknown";

int llama_build_number(void) {
    return LLAMA_BUILD_NUMBER;
}

const char * llama_commit(void) {
    return LLAMA_COMMIT;
}

const char * llama_compiler(void) {
    return LLAMA_COMPILER;
}

const char * llama_build_target(void) {
    return LLAMA_BUILD_TARGET;
}

const char * llama_build_info(void) {
    static std::string s = "b" + std::to_string(LLAMA_BUILD_NUMBER) + "-" + LLAMA_COMMIT;
    return s.c_str();
}
EOF

# 4b. Version headers. llama.rn's build bypasses upstream's CMake, so the two
#     headers upstream generates with configure_file() have to exist on disk.
VERSION_LINE() {
  grep -E "^set\($1 " "$2" | head -1 | sed -E 's/.* ([0-9]+)\).*/\1/'
}
ggml_version="$(VERSION_LINE GGML_VERSION_MAJOR "$WORK/llama.cpp/ggml/CMakeLists.txt")."\
"$(VERSION_LINE GGML_VERSION_MINOR "$WORK/llama.cpp/ggml/CMakeLists.txt")."\
"$(VERSION_LINE GGML_VERSION_PATCH "$WORK/llama.cpp/ggml/CMakeLists.txt")"
llama_version="$(VERSION_LINE LLAMA_VERSION_MAJOR "$WORK/llama.cpp/CMakeLists.txt")."\
"$(VERSION_LINE LLAMA_VERSION_MINOR "$WORK/llama.cpp/CMakeLists.txt")."\
"$(VERSION_LINE LLAMA_VERSION_PATCH "$WORK/llama.cpp/CMakeLists.txt")"
cat > "$WORK/llama.cpp/ggml/src/ggml-version.h" <<EOF
#pragma once

#define GGML_VERSION "${ggml_version}-dev"
#define GGML_COMMIT  "${COMMIT:0:7}"
EOF
cat > "$WORK/llama.cpp/src/llama-version.h" <<EOF
#pragma once

#define LLAMA_VERSION "${llama_version}-dev"
#define LLAMA_COMMIT  "${COMMIT:0:7}"
EOF

# 4b-bis. src/version.ts is what the JS `BuildInfo` export reads (the app shows
#          it on the About screen), plus its two compiled copies.
for f in src/version.ts lib/module/version.js lib/commonjs/version.js; do
  if [ -f "$LLAMA_RN/$f" ]; then
    sed -i.bak -e "s|BUILD_NUMBER = '[0-9]*'|BUILD_NUMBER = '$BUILD_NUMBER'|" \
      -e "s|BUILD_COMMIT = '[0-9a-f]*'|BUILD_COMMIT = '${COMMIT:0:7}'|" "$LLAMA_RN/$f"
    rm -f "$LLAMA_RN/$f.bak"
  fi
done

# 4c. Local fix-ups: hunks that resolved by hand for this target, applied after
#     llama.rn's patch set. See scripts/patches/llama-cpp-<tag>/*.patch.
FIXUP_DIR="$ROOT/scripts/patches/llama-cpp-$TAG"
if [ -d "$FIXUP_DIR" ]; then
  echo
  echo "== applying local fix-ups ($TAG) =="
  for patch_file in "$FIXUP_DIR"/*.patch; do
    [ -e "$patch_file" ] || continue
    name="$(basename "$patch_file" .patch)"
    if patch -p1 -l --no-backup-if-mismatch -d "$WORK/llama.cpp" -i "$patch_file" > /dev/null 2>&1; then
      echo "  ok   $name"
    else
      FAILED=$((FAILED + 1))
      echo "  FAIL $name"
      patch -p1 -l --dry-run -d "$WORK/llama.cpp" -i "$patch_file" 2>&1 | grep -E 'FAILED|Hunk' | sed 's/^/         /' || true
    fi
  done
fi

# Leftovers from hunks that did not apply; keeping them would ship broken
# sources the build then silently ignores.
find "$WORK/llama.cpp" \( -name '*.rej' -o -name '*.orig' \) -delete

# 4d. Fix-ups for llama.rn's own files (not the vendored tree): a new llama.cpp
#     can need code the installed llama.rn does not know about yet — b11979's
#     Hexagon host code moved into htp-opnode/htp-fusion/htp-kparams, which
#     llama.rn's CMake source list predates.
PKG_FIXUP_DIR="$ROOT/scripts/patches/llama-rn-$TAG"
if [ -d "$PKG_FIXUP_DIR" ]; then
  echo
  echo "== applying llama.rn package fix-ups ($TAG) =="
  for patch_file in "$PKG_FIXUP_DIR"/*.patch; do
    [ -e "$patch_file" ] || continue
    name="$(basename "$patch_file" .patch)"
    if patch -p1 -l --no-backup-if-mismatch -d "$LLAMA_RN" -i "$patch_file" > /dev/null 2>&1; then
      echo "  ok   $name"
    else
      FAILED=$((FAILED + 1))
      echo "  FAIL $name"
      patch -p1 -l --dry-run -d "$LLAMA_RN" -i "$patch_file" 2>&1 | grep -E 'FAILED|Hunk' | sed 's/^/         /' || true
    fi
  done
fi

# 5. Swap in the result.
rm -rf "$VENDOR"
mv "$WORK/llama.cpp" "$VENDOR"

sed -i.bak -e "s|^LLAMA_CPP_REF=.*|LLAMA_CPP_REF=$TAG|" \
  -e "s|^LLAMA_CPP_COMMIT=.*|LLAMA_CPP_COMMIT=$COMMIT|" \
  "$LLAMA_RN/vendor/VERSIONS" && rm -f "$LLAMA_RN/vendor/VERSIONS.bak"

# 6. The vendored tree is patched again after every install, so tell the caller
#    what else has to be replayed by hand.
echo
echo "== vendored $TAG ($BUILD_NUMBER) =="
echo "patches failed: $FAILED (see FAIL lines above)"
echo
echo "next:"
echo "  1. patch-package's own hunks that touch vendor/llama.cpp are already in"
echo "     the fix-ups above; keep them in sync with patches/llama.rn+*.patch"
echo "  2. rebuild and run yarn typecheck / yarn test"

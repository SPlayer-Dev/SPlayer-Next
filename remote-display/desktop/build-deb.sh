#!/usr/bin/env bash
set -euo pipefail
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd -- "$source_dir/../.." && pwd)"
output_dir="${1:-$repo_dir/remote-display/dist-package}"
mkdir -p "$output_dir"
stage_dir="$(mktemp -d)"
trap 'rm -rf -- "$stage_dir"' EXIT
install -Dm644 "$source_dir/control" "$stage_dir/DEBIAN/control"
install -Dm755 "$source_dir/surface-player" "$stage_dir/usr/bin/surface-player"
install -Dm644 "$source_dir/surface-player.py" "$stage_dir/usr/share/surface-player/surface-player.py"
install -Dm644 "$source_dir/surface-player.desktop" "$stage_dir/usr/share/applications/surface-player.desktop"
install -Dm644 "$source_dir/surface-player.svg" "$stage_dir/usr/share/icons/hicolor/scalable/apps/surface-player.svg"
install -Dm644 "$repo_dir/LICENSE" "$stage_dir/usr/share/doc/surface-player/copyright"
dpkg-deb --root-owner-group --build "$stage_dir" "$output_dir/surface-player_0.1.1_all.deb"

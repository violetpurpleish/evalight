#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
bun_version="$(node -p "require('./package.json').packageManager.replace(/^bun@/, '')")"
bun_dir="$project_dir/.vercel-bun"
bun_binary="$bun_dir/bin/bun"

# Download the official binary directly; the npm wrapper moves files out of
# its package-manager cache and can fail across filesystem boundaries.
if [[ ! -x "$bun_binary" ]] || [[ "$("$bun_binary" --version)" != "$bun_version" ]]; then
    case "$(uname -s)-$(uname -m)" in
        Linux-x86_64) target=linux-x64 ;;
        Linux-aarch64 | Linux-arm64) target=linux-aarch64 ;;
        Darwin-x86_64) target=darwin-x64 ;;
        Darwin-arm64) target=darwin-aarch64 ;;
        *) printf 'Unsupported Bun platform: %s\n' "$(uname -s)-$(uname -m)" >&2; exit 1 ;;
    esac

    mkdir -p "$bun_dir/bin"
    download_dir="$(mktemp -d "$bun_dir/install.XXXXXX")"
    trap 'rm -rf "$download_dir"' EXIT
    curl --fail --silent --show-error --location --retry 3 \
        "https://github.com/oven-sh/bun/releases/download/bun-v${bun_version}/bun-${target}.zip" \
        --output "$download_dir/bun.zip"
    unzip -q "$download_dir/bun.zip" -d "$download_dir"
    mv "$download_dir/bun-$target/bun" "$bun_binary"
    chmod +x "$bun_binary"
    rm -rf "$download_dir"
    trap - EXIT
fi

# Child scripts and the postinstall hook must use this same Bun version.
export PATH="$bun_dir/bin:$PATH"
printf 'Using Bun %s\n' "$("$bun_binary" --version)"
exec "$bun_binary" "$@"

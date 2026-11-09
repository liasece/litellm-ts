#!/bin/sh
# Build the application runtime and the ABI-compatible libraries required
# when an operator explicitly selects an older upstream release.
set -eu
out_dir=${1:?output directory required}
mkdir -p "$out_dir/plugins" "$out_dir/licenses"
out_dir=$(cd "$out_dir" && pwd)
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(cd "$source_dir/../.." && pwd)
case "$(go env GOOS)" in
    darwin) extension=dylib ;;
    linux) extension=so ;;
    *) echo "unsupported subscription runtime platform" >&2; exit 1 ;;
esac
export CGO_ENABLED=1
for id in commandcode-go-cliproxyapi opencode-go-cliproxyapi; do
    (
        cd "$repo_dir/plugins/$id"
        go build -mod=readonly -trimpath -buildmode=c-shared -ldflags="-s -w" -o "$out_dir/plugins/$id.$extension" .
        rm -f "$out_dir/plugins/$id.h"
        if command -v sha256sum >/dev/null 2>&1; then
            digest=$(sha256sum "$out_dir/plugins/$id.$extension")
        else
            digest=$(shasum -a 256 "$out_dir/plugins/$id.$extension")
        fi
        echo "${digest%% *}" > "$out_dir/plugins/$id.$extension.litellm-sha256"
        install -m 0644 LICENSE "$out_dir/licenses/$id.txt"
    )
done
cd "$source_dir"
go mod download github.com/router-for-me/CLIProxyAPI/v8
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/litellm-ts-builtin.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT
go run -mod=readonly ./builtin/cmd/overlay -out "$work_dir"
go build -mod=readonly -trimpath -modfile="$work_dir/builtin.mod" -ldflags="-s -w" -o "$out_dir/litellm-subscriptions" .
sdk_dir=$(go list -m -f '{{.Dir}}' github.com/router-for-me/CLIProxyAPI/v8)
install -m 0644 "$sdk_dir/LICENSE" "$out_dir/licenses/CLIProxyAPI.txt"

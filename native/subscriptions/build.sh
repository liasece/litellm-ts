#!/bin/sh
# Build the single subscription host and ship the licenses for its embedded plugins.
set -eu
out_dir=${1:?output directory required}
mkdir -p "$out_dir/plugins" "$out_dir/licenses"
out_dir=$(cd "$out_dir" && pwd)
source_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(cd "$source_dir/../.." && pwd)
export CGO_ENABLED=1
for id in commandcode-go-cliproxyapi opencode-go-cliproxyapi; do
    install -m 0644 "$repo_dir/plugins/$id/LICENSE" "$out_dir/licenses/$id.txt"
done
cd "$source_dir"
go mod download github.com/router-for-me/CLIProxyAPI/v8
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/litellm-ts-builtin.XXXXXX")
trap 'rm -rf "$work_dir"' EXIT
go run -mod=readonly ./builtin/cmd/overlay -out "$work_dir"
go build -mod=readonly -trimpath -modfile="$work_dir/builtin.mod" -ldflags="-s -w" -o "$out_dir/litellm-subscriptions" .
sdk_dir=$(go list -m -f '{{.Dir}}' github.com/router-for-me/CLIProxyAPI/v8)
install -m 0644 "$sdk_dir/LICENSE" "$out_dir/licenses/CLIProxyAPI.txt"

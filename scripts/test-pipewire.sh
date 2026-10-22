#!/usr/bin/env bash
set -euo pipefail

# 私有 D-Bus 和运行目录避免连接或改变用户正在使用的音频服务。
if [[ "${SPLAYER_TEST_DBUS:-}" != 1 ]]; then
  exec dbus-run-session -- env SPLAYER_TEST_DBUS=1 bash "$0" "$@"
fi

for tool in pipewire wireplumber pw-cli pw-cat pw-link pw-metadata cargo; do
  command -v "$tool" >/dev/null || { echo "缺少测试依赖: $tool" >&2; exit 1; }
done

test_dir=$(mktemp -d /tmp/splayer-pipewire.XXXXXX)
export XDG_RUNTIME_DIR="$test_dir/run"
export PIPEWIRE_CONFIG_DIR="$test_dir/config"
export PIPEWIRE_REMOTE=pipewire-0
unset PIPEWIRE_PROPS
mkdir -p "$XDG_RUNTIME_DIR" "$PIPEWIRE_CONFIG_DIR/pipewire.conf.d"
chmod 700 "$XDG_RUNTIME_DIR"
config_source="${PIPEWIRE_TEST_CONFIG_SOURCE:-/usr/share/pipewire}"
cp "$config_source/pipewire.conf" "$PIPEWIRE_CONFIG_DIR/pipewire.conf"
cp "$config_source/client.conf" "$PIPEWIRE_CONFIG_DIR/client.conf"
if [[ -f "$config_source/client-rt.conf" ]]; then
  cp "$config_source/client-rt.conf" "$PIPEWIRE_CONFIG_DIR/client-rt.conf"
else
  cp "$config_source/client.conf" "$PIPEWIRE_CONFIG_DIR/client-rt.conf"
fi
cat > "$PIPEWIRE_CONFIG_DIR/pipewire.conf.d/99-splayer-test.conf" <<'CONFIG'
context.properties = {
    default.clock.rate = 48000
    default.clock.allowed-rates = [ 44100 48000 88200 96000 176400 192000 352800 ]
    default.clock.quantum = 1024
    default.clock.min-quantum = 64
    default.clock.max-quantum = 8192
}
context.objects = [
    { factory = adapter
      args = {
        factory.name = support.null-audio-sink
        node.name = splayer-test-output
        node.description = SPlayer-Test-Output
        media.class = Audio/Sink
        audio.position = [ FL FR ]
        node.virtual = true
      }
    }
]
CONFIG

children=()
cleanup() {
  for pid in "${children[@]}"; do kill "$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  echo "PipeWire 测试日志: $test_dir"
}
trap cleanup EXIT

pipewire > "$test_dir/pipewire.log" 2>&1 &
children+=("$!")
pipewire --version > "$test_dir/versions.log"
wireplumber --version >> "$test_dir/versions.log"
for _ in {1..50}; do
  [[ -S "$XDG_RUNTIME_DIR/pipewire-0" ]] && break
  sleep 0.1
done
[[ -S "$XDG_RUNTIME_DIR/pipewire-0" ]]
wireplumber > "$test_dir/wireplumber.log" 2>&1 &
children+=("$!")
sleep 2
pw-cli ls Node > "$test_dir/nodes.log"
grep -q splayer-test-output "$test_dir/nodes.log"
pw-metadata -m -n settings > "$test_dir/clock.log" 2>&1 &
children+=("$!")

# 两组使用同一服务配置，保留每个速率的供数欠载、耗时和重建诊断。
cargo test -p audio-engine pipewire_real_output_rate_matrix -- --ignored --nocapture --test-threads=1 2>&1 | tee "$test_dir/alone.log"
pw-cat --record --target=splayer-test-output --rate=48000 --channels=2 --format=f32 - > /dev/null 2> "$test_dir/monitor.log" &
children+=("$!")
sleep 0.5
kill -0 "${children[-1]}"
pw-link -l > "$test_dir/monitor-links.log"
grep -q splayer-test-output "$test_dir/monitor-links.log"
cargo test -p audio-engine pipewire_real_output_rate_matrix -- --ignored --nocapture --test-threads=1 2>&1 | tee "$test_dir/monitoring.log"

# 小 quantum 与自定义 SPA JSON 覆盖，验证不依赖固定图速率或重写用户属性。
kill "${children[-1]}"
wait "${children[-1]}" 2>/dev/null || true
unset 'children[-1]'
pw-metadata -n settings 0 clock.force-quantum 256
PIPEWIRE_PROPS='{ node.latency = 256/48000 }' cargo test -p audio-engine pipewire_real_output_rate_matrix -- --ignored --nocapture --test-threads=1 2>&1 | tee "$test_dir/small-quantum.log"

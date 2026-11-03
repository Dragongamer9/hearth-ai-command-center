// One-click installs of every AI's official tool, without hunting for installers.
//
// Everything runs in a terminal you can see (a fixed script, written by the app,
// with every value passed as an argument, never pasted into shell text):
//   - Node.js: if no usable node/npm is found, the official Node.js LTS build is
//     downloaded from nodejs.org, checked against the official SHASUMS256.txt and
//     unpacked into ~/.local/share/hearth-ai/node. No password.
//   - npm packages always install to your own prefix (~/.local), so they never
//     need root. Programs land in ~/.local/bin.
//   - uv (for Mistral Vibe): Astral's official installer, into ~/.local/bin. No password.
//   - Ollama: its official installer needs administrator rights. It asks for your
//     computer password in the terminal itself; this app never sees, asks for,
//     stores or passes it.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Gemini CLI and Qwen Code need Node.js 20 or newer (Claude Code needs 18).
const MIN_NODE_MAJOR = 20;
const NODE_DIST = 'https://nodejs.org/dist';
const UV_INSTALLER = 'https://astral.sh/uv/install.sh';
const OLLAMA_INSTALLER = 'https://ollama.com/install.sh';

const NPM_PACKAGE = {
  anthropic: '@anthropic-ai/claude-code',
  openai: '@openai/codex',
  google: '@google/gemini-cli',
  xai: '@xai-official/grok',
  qwen: '@qwen-code/qwen-code',
  freebuff: 'freebuff',
};
const UV_TOOL = { mistral: 'mistral-vibe' };
const LABEL = { anthropic: 'Claude Code', openai: 'Codex CLI', google: 'Gemini CLI', xai: 'Grok Build CLI', qwen: 'Qwen Code', freebuff: 'FreeBuff', mistral: 'Mistral Vibe', ollama: 'Ollama' };
// Install order for "Install all": CLI tools first, Ollama (password) last.
const ORDER = ['anthropic', 'openai', 'google', 'xai', 'qwen', 'freebuff', 'mistral', 'ollama'];

const canInstall = (agent) => ORDER.includes(agent);

function dataHome() {
  const x = process.env.XDG_DATA_HOME;
  return x && path.isAbsolute(x) ? x : path.join(os.homedir(), '.local', 'share');
}
const appDir = () => path.join(dataHome(), 'hearth-ai');
const nodeDir = () => path.join(appDir(), 'node');
const nodeBin = () => path.join(nodeDir(), 'bin');
const userPrefix = () => path.join(os.homedir(), '.local');
const statusDir = () => path.join(appDir(), 'install');

function isExec(p) {
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function nodeArch(arch = process.arch) {
  return { x64: 'x64', arm64: 'arm64' }[arch] || null;
}

function parseNodeVersion(s) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(String(s || '').trim());
  return m ? { major: Number(m[1]), version: `v${m[1]}.${m[2]}.${m[3]}` } : null;
}
function nodeUsable(s) {
  const v = parseNodeVersion(s);
  return Boolean(v && v.major >= MIN_NODE_MAJOR);
}

// nodejs.org/dist/index.json is newest first; the first LTS with a Linux build wins.
function pickLts(index, arch) {
  if (!Array.isArray(index)) return null;
  for (const r of index) {
    const v = r && parseNodeVersion(r.version);
    if (v && r.lts && Array.isArray(r.files) && r.files.includes(`linux-${arch}`)) return v.version;
  }
  return null;
}

const nodeTarball = (version, arch) => `node-${version}-linux-${arch}.tar.gz`;

// "<sha256>  <file>" lines from the official SHASUMS256.txt.
function parseShasums(text) {
  const out = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m) out[m[2]] = m[1].toLowerCase();
  }
  return out;
}

// Which Node.js to download, and the checksum it must have.
async function resolveNode({ fetchImpl = fetch, arch = nodeArch() } = {}) {
  if (!arch) throw new Error(`there is no official Node.js build for this processor (${process.arch})`);
  const get = async (url, kind) => {
    const r = await fetchImpl(url, { signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`nodejs.org answered HTTP ${r.status}`);
    return kind === 'json' ? r.json() : r.text();
  };
  const version = pickLts(await get(`${NODE_DIST}/index.json`, 'json'), arch);
  if (!version) throw new Error('nodejs.org listed no LTS release for Linux');
  const file = nodeTarball(version, arch);
  const sha256 = parseShasums(await get(`${NODE_DIST}/${version}/SHASUMS256.txt`, 'text'))[file];
  if (!sha256) throw new Error(`the official SHASUMS256.txt has no checksum for ${file}`);
  return { version, file, url: `${NODE_DIST}/${version}/${file}`, sha256 };
}

// First node (>= MIN_NODE_MAJOR) on the search path that has npm next to it.
async function detectNode(dirs, versionOf) {
  for (const d of dirs) {
    const node = path.join(d, 'node');
    const npm = path.join(d, 'npm');
    if (!isExec(node) || !isExec(npm)) continue;
    const v = await versionOf(node).catch(() => '');
    if (nodeUsable(v)) return { node, npm, version: parseNodeVersion(v).version };
  }
  return null;
}

const findIn = (dirs, name) => dirs.map((d) => path.join(d, name)).find(isExec) || null;

// Work out the steps for the terminal script. Returns the script's arguments.
async function prepare({ agents, dirs, versionOf, fetchImpl, arch }) {
  const want = ORDER.filter((a) => agents.includes(a));
  if (!want.length) return { ok: false, message: 'No installer for this agent.' };
  const steps = [];
  const plan = [];
  const npmAgents = want.filter((a) => NPM_PACKAGE[a]);
  if (npmAgents.length) {
    const node = await detectNode(dirs, versionOf);
    let npm = node?.npm;
    if (!node) {
      let rel;
      try {
        rel = await resolveNode({ fetchImpl, arch });
      } catch (e) {
        return { ok: false, message: `Node.js ${MIN_NODE_MAJOR}+ is needed and could not be fetched from nodejs.org: ${e.message}. Check your internet connection and try again.` };
      }
      steps.push('node', rel.version, rel.sha256, rel.url);
      plan.push(`Node.js ${rel.version}`);
      npm = path.join(nodeBin(), 'npm');
    }
    for (const a of npmAgents) {
      steps.push('npm', a, npm, NPM_PACKAGE[a], LABEL[a]);
      plan.push(LABEL[a]);
    }
  }
  if (want.includes('mistral')) {
    if (!findIn(dirs, 'uv')) {
      steps.push('uv');
      plan.push('uv');
    }
    steps.push('uvtool', 'mistral', UV_TOOL.mistral, LABEL.mistral);
    plan.push(LABEL.mistral);
  }
  if (want.includes('ollama')) {
    steps.push('ollama');
    plan.push(LABEL.ollama);
  }
  return { ok: true, agents: want, plan, args: [appDir(), userPrefix(), ...steps] };
}

// The script is fixed text; agent ids, paths, URLs and checksums arrive as "$@".
const SCRIPT = `#!/bin/sh
# Hearth AI Command Center installer. Written by the app and run in a terminal
# you can see. Official tools only, installed into your own folders. Only the
# Ollama step (Ollama's own installer) asks for your password, typed here; the
# app never sees it.
set -u
set -f
APP_DIR=$1
PREFIX=$2
shift 2
NODE_DIR="$APP_DIR/node"
STATUS_DIR="$APP_DIR/install"
PATH="$NODE_DIR/bin:$PREFIX/bin:$PATH"
export PATH
mkdir -p "$STATUS_DIR" "$PREFIX/bin" || exit 1
TMP=$(mktemp -d "\${TMPDIR:-/tmp}/hearth-install.XXXXXX") || exit 1
trap 'rm -rf "$TMP"' EXIT
OK_LIST=""
FAIL_LIST=""
NODE_FAILED=0
UV_FAILED=0

say() { printf '\\n==> %s\\n' "$*"; }
mark() { printf '%s\\n' "$2" > "$STATUS_DIR/$1"; }
done_ok() { OK_LIST="$OK_LIST|$1"; [ -n "\${2:-}" ] && mark "$2" ok; echo "OK: $1"; }
done_fail() { FAIL_LIST="$FAIL_LIST|$1"; [ -n "\${2:-}" ] && mark "$2" failed; echo "FAILED: $1"; }

fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fL --proto '=https' --tlsv1.2 --retry 2 -o "$2" "$1"
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only -O "$2" "$1"
  else
    echo "Neither curl nor wget is installed, so nothing can be downloaded."
    return 1
  fi
}

verify_sha256() {
  actual=$(sha256sum "$1" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$actual" ] && [ "$actual" = "$2" ]; then
    echo "Checksum OK (matches the official SHASUMS256.txt)."
    return 0
  fi
  echo "Checksum MISMATCH: expected $2, got \${actual:-nothing}. The download was NOT installed."
  return 1
}

install_node_file() {
  verify_sha256 "$1" "$2" || return 1
  rm -rf "$APP_DIR/node.new" && mkdir -p "$APP_DIR/node.new" || return 1
  if ! tar -xzf "$1" -C "$APP_DIR/node.new" --strip-components=1 --no-same-owner; then
    rm -rf "$APP_DIR/node.new"
    echo "Could not unpack Node.js."
    return 1
  fi
  if [ ! -x "$APP_DIR/node.new/bin/node" ]; then
    rm -rf "$APP_DIR/node.new"
    echo "The download has no bin/node."
    return 1
  fi
  rm -rf "$APP_DIR/node.old"
  if [ -d "$NODE_DIR" ]; then mv "$NODE_DIR" "$APP_DIR/node.old" || return 1; fi
  mv "$APP_DIR/node.new" "$NODE_DIR" || return 1
  rm -rf "$APP_DIR/node.old"
  echo "Node.js $("$NODE_DIR/bin/node" --version 2>/dev/null) is ready in $NODE_DIR"
}

echo "Hearth AI Command Center: one-click install"
echo "Programs go to $PREFIX/bin (and Node.js, if needed, to $NODE_DIR)."
echo "None of this needs your password, except Ollama's own installer if you chose it."

while [ $# -gt 0 ]; do
  step=$1
  shift
  case $step in
    node)
      ver=$1; sha=$2; url=$3; shift 3
      say "Node.js $ver: official build from nodejs.org, into your own folder (no password)"
      echo "Downloading $url"
      file="$TMP/node.tar.gz"
      if fetch "$url" "$file" && install_node_file "$file" "$sha"; then done_ok "Node.js $ver"; else NODE_FAILED=1; done_fail "Node.js $ver"; fi
      ;;
    nodefile)
      file=$1; sha=$2; shift 2
      say "Node.js from $file"
      if install_node_file "$file" "$sha"; then done_ok "Node.js"; else NODE_FAILED=1; done_fail "Node.js"; fi
      ;;
    npm)
      agent=$1; npm=$2; pkg=$3; label=$4; shift 4
      mark "$agent" running
      say "$label: npm install $pkg into $PREFIX (no password)"
      if [ "$NODE_FAILED" = 1 ]; then
        echo "Skipped because Node.js could not be installed (see above)."
        done_fail "$label" "$agent"
      elif ( PATH="$(dirname "$npm"):$PATH"; export PATH; "$npm" install -g --prefix "$PREFIX" --no-fund --no-audit "$pkg" ); then
        done_ok "$label" "$agent"
      else
        echo "npm could not install $pkg. The lines above say why (often no internet connection)."
        done_fail "$label" "$agent"
      fi
      ;;
    uv)
      say "uv: Astral's official installer ($UV_URL), into $PREFIX/bin (no password)"
      if fetch "$UV_URL" "$TMP/uv-install.sh" && env UV_NO_MODIFY_PATH=1 UV_INSTALL_DIR="$PREFIX/bin" sh "$TMP/uv-install.sh"; then done_ok "uv"; else UV_FAILED=1; done_fail "uv"; fi
      ;;
    uvtool)
      agent=$1; pkg=$2; label=$3; shift 3
      mark "$agent" running
      say "$label: uv tool install $pkg (no password)"
      if [ "$UV_FAILED" = 1 ] || ! command -v uv >/dev/null 2>&1; then
        echo "Skipped because uv is not available (see above)."
        done_fail "$label" "$agent"
      elif env UV_TOOL_BIN_DIR="$PREFIX/bin" uv tool install "$pkg"; then
        done_ok "$label" "$agent"
      else
        done_fail "$label" "$agent"
      fi
      ;;
    ollama)
      mark ollama running
      say "Ollama: its official installer ($OLLAMA_URL)"
      echo "Ollama installs system-wide, so its installer needs administrator rights."
      echo "It will ask for your computer password HERE, in this terminal."
      echo "Hearth AI Command Center never sees, stores or passes your password."
      if ! command -v curl >/dev/null 2>&1; then
        echo "Ollama's installer needs curl. Install it first (for example: sudo apt install curl), then press Install again."
        done_fail "Ollama" ollama
      elif fetch "$OLLAMA_URL" "$TMP/ollama-install.sh" && sh "$TMP/ollama-install.sh"; then
        done_ok "Ollama" ollama
        echo "Next: download a model, for example: ollama pull llama3.2"
      else
        done_fail "Ollama" ollama
      fi
      ;;
    *)
      echo "Unknown install step: $step"
      exit 2
      ;;
  esac
done

echo
echo "================ Summary ================"
IFS='|'
for x in $OK_LIST; do [ -n "$x" ] && echo "  OK      $x"; done
for x in $FAIL_LIST; do [ -n "$x" ] && echo "  FAILED  $x"; done
unset IFS
code=0
if [ -z "$FAIL_LIST" ]; then
  echo "Everything installed. Back in Hearth AI, each card updates by itself."
else
  code=1
  echo "Some steps failed; the messages above say why. Fix that and press Install again."
fi
if [ -t 0 ]; then printf 'Press Enter to close... '; read _ || true; fi
exit $code
`.replace('set -f\n', `set -f\nUV_URL='${UV_INSTALLER}'\nOLLAMA_URL='${OLLAMA_INSTALLER}'\n`);

function writeScript(file = path.join(appDir(), 'installer.sh')) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, SCRIPT, { mode: 0o700 });
  fs.chmodSync(file, 0o700);
  return file;
}

// Last install result per agent, written by the script: queued/running/ok/failed.
function readRun(agent) {
  if (!canInstall(agent)) return null;
  try {
    const v = fs.readFileSync(path.join(statusDir(), agent), 'utf8').trim();
    return ['queued', 'running', 'ok', 'failed'].includes(v) ? v : null;
  } catch {
    return null;
  }
}
function markQueued(agents) {
  fs.mkdirSync(statusDir(), { recursive: true, mode: 0o700 });
  for (const a of agents) if (canInstall(a)) fs.writeFileSync(path.join(statusDir(), a), 'queued\n', { mode: 0o600 });
}

module.exports = {
  MIN_NODE_MAJOR, NODE_DIST, UV_INSTALLER, OLLAMA_INSTALLER, NPM_PACKAGE, UV_TOOL, LABEL, ORDER, SCRIPT,
  canInstall, appDir, nodeDir, nodeBin, userPrefix, statusDir, nodeArch, parseNodeVersion, nodeUsable,
  pickLts, nodeTarball, parseShasums, resolveNode, detectNode, prepare, writeScript, readRun, markQueued,
};

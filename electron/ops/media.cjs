// Image facts and tools for team chat: dimensions from file headers, this computer's
// memory (for Local AI model fit), Real-ESRGAN upscaling with an ffmpeg fallback.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Width/height from PNG, JPEG, GIF or WebP headers (no decoding).
function imageSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 24) return null;
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.toString('ascii', 0, 3) === 'GIF') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    const kind = buf.toString('ascii', 12, 16);
    if (kind === 'VP8X') return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    return null;
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}
function imageInfo(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(256 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    return imageSize(buf.subarray(0, n)) || {};
  } catch { return {}; }
}

// nvidia-smi gives a discrete card's VRAM (MiB). AMD cards report VRAM in sysfs; an APU
// (Ally, laptops) reports only a small carve-out, so under 6 GB counts as shared memory.
function parseHardware({ totalBytes = 0, nvidiaMiB = '', amdVramBytes = [] } = {}) {
  const ramGb = Math.round(totalBytes / 2 ** 30);
  const nv = String(nvidiaMiB || '').split('\n').map((x) => Number(x.trim())).filter((x) => x > 0);
  if (nv.length) return { ramGb, vramGb: Math.round(Math.max(...nv) / 1024), discrete: true, gpu: 'NVIDIA' };
  const amd = amdVramBytes.map(Number).filter((x) => x > 0);
  const best = amd.length ? Math.max(...amd) : 0;
  if (best >= 6 * 2 ** 30) return { ramGb, vramGb: Math.round(best / 2 ** 30), discrete: true, gpu: 'AMD' };
  return { ramGb, vramGb: best ? Math.round(best / 2 ** 30) : null, discrete: false, gpu: best ? 'integrated / shared memory' : null };
}
function readAmdVram() {
  const out = [];
  try {
    for (const c of fs.readdirSync('/sys/class/drm')) {
      if (!/^card\d+$/.test(c)) continue;
      try { out.push(Number(fs.readFileSync(`/sys/class/drm/${c}/device/mem_info_vram_total`, 'utf8'))); } catch {}
    }
  } catch {}
  return out;
}

// Upscale targets (height). Real-ESRGAN makes 4x, then ffmpeg resizes to the target if present.
const TARGETS = { '1080p': 1080, '1440p': 1440, '4k': 2160 };
function esrganArgs(input, output) { return ['-i', input, '-o', output, '-s', '4', '-n', 'realesrgan-x4plus']; }
function ffmpegScaleArgs(input, output, height) { return ['-y', '-i', input, '-vf', `scale=-2:${height}:flags=lanczos`, output]; }

// Real-ESRGAN's official Linux build from its GitHub release.
const ESRGAN_REPO = 'xinntao/Real-ESRGAN';
function pickEsrganAsset(release) {
  const a = (release?.assets || []).find((x) => /realesrgan-ncnn-vulkan-.*-ubuntu\.zip$/i.test(x.name));
  if (!a) return null;
  const m = String(a.digest || '').match(/^sha256:([0-9a-f]{64})$/);
  return { name: a.name, url: a.browser_download_url, sha256: m ? m[1] : null };
}
const toolsDir = (dataDir) => path.join(dataDir, 'tools', 'realesrgan');
function findEsrgan(find, dataDir) {
  const own = path.join(toolsDir(dataDir), 'realesrgan-ncnn-vulkan');
  try { fs.accessSync(own, fs.constants.X_OK); return own; } catch {}
  return find('realesrgan-ncnn-vulkan');
}

module.exports = { imageSize, imageInfo, parseHardware, readAmdVram, TARGETS, esrganArgs, ffmpegScaleArgs, ESRGAN_REPO, pickEsrganAsset, toolsDir, findEsrgan, tmp: () => os.tmpdir() };

# three.js (vendored)

Used by the Habitat's 3D lodge view (`src/habitat3d/`). Bundled locally by Vite, so the
app's Content Security Policy stays `script-src 'self'` (no CDN).

- Package: `three` **0.170.0** (released October 2024), MIT licence (see `LICENSE`).
- Source: the official npm tarball `https://registry.npmjs.org/three/-/three-0.170.0.tgz`
- Tarball integrity (npm `dist.integrity`, checked against `https://registry.npmjs.org/three/0.170.0`):
  `sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==`
- Tarball shasum (sha1): `6087f97aab79e9e9312f9c89fcef6808642dfbb7`
- Extracted unchanged: `package/build/three.module.min.js` and `package/LICENSE`.
- `three.module.min.js` sha256: `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7`
  (checked by `test/habitat3d.test.mjs`).

No addons are used: the camera controls, walk mode and glow are written in `src/habitat3d/`.

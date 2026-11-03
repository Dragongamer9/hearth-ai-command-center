# Hearth AI Command Center

## RED FLAGS (the owner's rules; never break them)

- **In-app updates must always work, for AppImage and .deb installs.** Never break or bypass `electron/updater.cjs` (AppImage, electron-updater) or `electron/updater-deb.cjs` (.deb: SHA256SUMS check, pkexec install with an argument array). `release.yml` must keep uploading the AppImage, the .deb, `latest-linux.yml` and `SHA256SUMS.txt`. Guarded by `test/redflag-updates.test.cjs`.
- **The owner picks every version number.** Never pick, bump or apply one; ask first.
- **Commits only as the owner** (Dragongamer9): no AI author, no Co-authored-by, Claude-Session or "Generated with" lines.
- **Settings never change by themselves.** Only the owner changes them.

Also: no merges to main, tags or releases without the owner's approval. Tests run in CI (`node --test test/*.test.*`).

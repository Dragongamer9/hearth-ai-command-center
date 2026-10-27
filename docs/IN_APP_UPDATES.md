# In-app updates

The app updates itself from **published GitHub Releases** of this repository using `electron-updater`.

## How it works

1. You build a release with the manual **Draft release** workflow (Actions tab → *Draft release (manual, owner only)* → enter the version that's in `package.json`). It uploads the AppImage and `latest-linux.yml` to a **draft** release.
2. Drafts are invisible to the updater. Nothing reaches anyone until you open the draft on GitHub and press **Publish release**. That button is the sign-off.
3. In the app, **Settings → App updates → Check for updates** reads `latest-linux.yml` from the latest published release.
4. If a newer version exists you get a notice. You choose **Download update** (progress bar shown); the download is verified against the SHA-512 in `latest-linux.yml`.
5. You choose **Restart & install**. The new AppImage replaces the old file in place and the app relaunches.

The app never downloads, installs or restarts on its own. Pre-releases and drafts are ignored, and it never downgrades.

## Limitations

- Updates only work when launched **from the `.AppImage` file** (the `APPIMAGE` environment variable must be set). Running from `release/linux-unpacked` or `npm start` shows "updates disabled".
- The AppImage file must be in a folder you can write to (e.g. `~/Applications`), because the update replaces that file.
- Integrity is SHA-512 against the manifest served by the same GitHub release; the AppImage is not GPG-signed. Anyone who can publish releases on this repo can ship an update, so keep repo write access tight.
- Branch builds from the *Build Linux AppImage* workflow are artifacts only and are never offered as updates.

## Error states shown in the app

| Situation | Message |
|---|---|
| No published release yet | "No published release found yet." |
| Offline / GitHub unreachable | "Offline or GitHub unreachable." |
| Already current | "You are on the latest version." |
| Bad download | "Downloaded update failed its integrity check and was discarded." |

## What has been verified

- Packaging produces `latest-linux.yml` with the AppImage's SHA-512 and size, and `app-update.yml` (GitHub provider, this repo) is embedded in the AppImage.
- Updates are disabled in development/unpacked runs.
- **Not yet verified end to end:** an actual update from one published release to the next, because no release has been published. The first real test is: publish version A, install it, then publish version B and check from inside A.

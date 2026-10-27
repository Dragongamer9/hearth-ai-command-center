# In-app updates (Linux AppImage)

## User experience

The desktop app should have a Settings > Updates panel with:
- Current installed version and update channel.
- A **Check for updates** action and last-checked status.
- A clear update-available notice with version and release notes.
- Download progress, verification status, and an explicit **Restart to install** action.
- A **Check automatically** preference. Checking can happen at startup and periodically; installation must never happen silently.
- Friendly errors and a **View release page** fallback if the updater cannot complete.

## Distribution model

Use `electron-updater` with `electron-builder`'s GitHub provider for the repository `Dragongamer9/hearth-ai-command-center`. Linux AppImage updates need the AppImage artifact and electron-builder-generated update metadata (for example, `latest-linux.yml`) attached to a GitHub Release. A CI artifact alone is not an update feed.

A later, explicitly approved release workflow should:
1. Run source checks and tests.
2. Build the Linux AppImage on a supported Linux runner.
3. Verify the AppImage and generated updater metadata exist.
4. Publish them as GitHub Release assets only after an authorized release action.
5. Keep release publishing separate from ordinary branch pushes and CI artifact uploads.

Do not publish releases automatically from feature-branch pushes. Until a release feed exists, the UI should say updates are not configured rather than pretending an update check succeeded.

## Security requirements

- Never execute a downloaded update script or arbitrary shell command.
- Use electron-updater/electron-builder's supported update flow and validate the release metadata and download according to the library's supported checks.
- Keep update checks and downloads on HTTPS.
- Require an explicit user confirmation before restart/install.
- Do not put provider API keys or app session tokens in updater metadata, URLs, logs, or release notes.
- Do not let an update change the local backend's loopback-only binding or bypass approval controls.
- Do not install updates from pull requests, feature branches, or arbitrary URLs.
- Handle offline mode, rate limits, missing metadata, interrupted downloads, and unsupported installs without breaking app startup.

## Implementation checklist

- [ ] Add and pin `electron-updater` as a production dependency.
- [ ] Configure electron-builder's GitHub publish target without enabling automatic release publishing.
- [ ] Add main-process updater lifecycle and narrow preload IPC methods for status/check/download/install.
- [ ] Add the Updates settings panel and progress/error states.
- [ ] Add unit tests for state transitions and IPC authorization.
- [ ] Add a manually triggered release workflow, guarded against accidental publishing.
- [ ] Test an actual AppImage update from one approved test release on Linux before declaring the feature ready.

## Current state

This document is the implementation plan only. The source code must be present in the GitHub branch before CI can build or test the app. No release has been published and no AppImage update feed is live.

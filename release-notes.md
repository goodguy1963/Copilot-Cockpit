### Changed

- **One-time task editor** — Editing an active one-time task now shows the remaining countdown instead of the original full delay, so the form reflects the real in-flight timer.
- **Release resilience** — Tag builds now continue through GitHub release creation when Open VSX is temporarily read-only instead of aborting after the Open VSX publish step.

### Fixed

- **One-time task updates** — Saving an unchanged one-time task no longer restarts its countdown from the beginning; existing `nextRun` timing is preserved unless the timer settings actually change.
- **VSIX packaging hygiene** — Scratch logs and temp scripts are excluded from packaged releases, and packaging now fails fast if they leak back into the archive.

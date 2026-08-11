# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.1.0] - Unreleased

### Added

- Activity Bar view listing scheduled Claude Code jobs.
- Add/Edit job form (name, prompt, working directory, schedule, output file).
- Schedule presets (daily, weekdays, hourly, every N minutes) plus custom cron expressions,
  with a live next-run preview.
- Run Now, Enable/Disable, View Last Output, Open Prompt File, and Delete actions per job.
- Automatic `claude` CLI detection via a login shell, with manual override settings.
- Managed, non-destructive crontab sync (only the extension's own block is touched).
- Crontab drift detection with a one-click resync.

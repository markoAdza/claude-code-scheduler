# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Fixed

- Working directory and output path values that contain shell metacharacters (`"`, `$`, backticks)
  are now properly quoted in generated Linux/macOS run scripts, instead of being interpolated
  unescaped into the shell command.

### Added

- "Duplicate Job" action that opens a prefilled New Job form from an existing job's settings, so
  variations on a job no longer need to be built from scratch. The duplicate starts disabled so it
  can't start firing on the original's schedule before it's been reviewed.
- "View Run History" and "View Error Log" actions per job. Each run now appends its timestamp and
  exit code to a `history.jsonl` file (trimmed to the most recent 50 entries), viewable as a
  pass/fail list from which the error log can be opened directly.
- A soft warning in the job form when a schedule (preset or custom cron) runs more often than
  every 5 minutes, since a very frequent schedule against a paid API can get expensive fast. It's
  informational only and doesn't block saving.
- Job status shown in the tree view (icon, "last exit" text, and tooltip) now reflects every real
  run of a job — including ones triggered by the OS scheduler while VS Code was closed — instead
  of only manual "Run Now" invocations.
- A per-job lock so two overlapping runs of the same job (e.g. a slow prompt on a frequent
  schedule) no longer race on the same output file; the later run is skipped and noted in the
  job's error log.
- A configurable run timeout (`claudeCodeScheduler.jobTimeoutMinutes`, default 30) that terminates
  a hung `claude` invocation — for example one stuck on a permission prompt with no terminal to
  answer it — instead of letting it block indefinitely and wedge every subsequent scheduled run.

## [0.2.0] - 2026-08-12

### Added

- Windows support via native Task Scheduler integration (each job becomes its own Scheduled Task
  under a `Claude Code Scheduler` folder), alongside the existing Linux/macOS cron backend.
- macOS-specific guidance for granting `cron` Full Disk Access when jobs touch protected folders
  (Desktop, Documents, Downloads, iCloud Drive).
- Automatic `claude` CLI detection on Windows via `where`, preferring the `claude.ps1` shim over
  `claude.cmd` to avoid `cmd.exe` mangling prompts.

## [0.1.0] - 2026-08-11

### Added

- Activity Bar view listing scheduled Claude Code jobs.
- Add/Edit job form (name, prompt, working directory, schedule, output file).
- Schedule presets (daily, weekdays, hourly, every N minutes) plus custom cron expressions,
  with a live next-run preview.
- Run Now, Enable/Disable, View Last Output, Open Prompt File, and Delete actions per job.
- Automatic `claude` CLI detection via a login shell, with manual override settings.
- Managed, non-destructive crontab sync (only the extension's own block is touched).
- Crontab drift detection with a one-click resync.

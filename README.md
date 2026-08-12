# Prompt Scheduler for Claude Code

Schedule recurring [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI prompts on
**Linux, macOS, or Windows**, managed from a panel in VS Code. Each job is registered with your
operating system's own scheduler — **cron** on Linux/macOS, **Windows Task Scheduler** on
Windows — so it keeps running on schedule even when VS Code is closed. The extension is a GUI on
top of your OS scheduler, not a replacement that only works while VS Code is open.

## Features

- Add, edit, enable/disable, and delete scheduled prompts from a tree view in the Activity Bar.
- Each job has its own prompt, working directory, schedule, and output file.
- Schedule presets (daily, weekdays, hourly, every N minutes) with a live preview of the next few
  run times, or a raw cron expression on Linux/macOS.
- "Run Now" to try a job immediately without waiting for its schedule.
- Auto-detects the `claude` CLI even when it's only on your login shell's PATH (e.g. installed
  via nvm) on Linux/macOS, or on `PATH` via `where` on Windows.
- Only ever touches the entries it created — every other crontab line or scheduled task on your
  system is left untouched.

## Requirements

- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and already
  authenticated (`claude` should work from your terminal) — required on every OS.
- **Linux**: the `crontab` command available (installed by default on almost every distro).
- **macOS**: the `crontab` command (built in). Modern macOS runs `cron` under the system's
  privacy protections — if a job's working directory or output file lives under a protected
  folder (Desktop, Documents, Downloads, iCloud Drive), grant **Full Disk Access** to
  `/usr/sbin/cron` in **System Settings → Privacy & Security → Full Disk Access**, or the job may
  silently fail to read/write there.
- **Windows**: PowerShell (installed by default) and the Task Scheduler service running (enabled
  by default). Only the built-in schedule presets are supported — see [Limitations](#limitations).
  If `claude` was installed via `npm install -g`, the extension prefers its `claude.ps1` shim over
  `claude.cmd` so prompts aren't re-parsed by `cmd.exe` (which would mangle any `%...%` text).

## Usage

1. Open the **Claude Code Scheduler** icon in the Activity Bar.
2. Click **Add Job** and fill in a name, prompt, working directory, schedule, and output file.
3. Save — the extension writes a runner script and registers it with your OS scheduler
   automatically.
4. Use the job's inline actions to run it immediately, edit it, enable/disable it, view its last
   output, open its prompt file, or delete it.

## How it works

For each job, the extension writes a `prompt.txt` and a runner script under its data directory
(default `~/.claude-code-scheduler/scripts/<job-id>/`), then registers that script with the OS
scheduler.

**On Linux/macOS**, one line is added per job inside a managed block in your crontab:

```
# >>> claude-code-scheduler managed jobs (do not edit manually) >>>
0 7 * * * /bin/bash "/home/you/.claude-code-scheduler/scripts/<job-id>/run.sh" # claude-code-scheduler:<job-id>
# <<< claude-code-scheduler managed jobs <<<
```

Editing a job regenerates its script and re-syncs this block; everything outside the markers in
your crontab is left exactly as it was.

**On Windows**, each job becomes its own Scheduled Task, grouped under a
`Claude Code Scheduler` folder in Task Scheduler, running:

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\Users\you\.claude-code-scheduler\scripts\<job-id>\run.ps1"
```

with a native `DAILY`/`WEEKLY`/`HOURLY`/`MINUTE` trigger matching the preset you picked. Disabling
or deleting a job removes its task; nothing else in Task Scheduler is touched.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeCodeScheduler.claudeExecutablePath` | `""` (auto-detect) | Absolute path to the `claude` CLI. |
| `claudeCodeScheduler.additionalPathEntries` | `[]` | Extra directories prepended to `PATH`/`Path` in generated scripts. |
| `claudeCodeScheduler.dataDirectory` | `~/.claude-code-scheduler` | Where job definitions, scripts, prompts, and logs live. |
| `claudeCodeScheduler.shell` | `""` (`$SHELL`, or `/bin/bash`) | **Linux/macOS only.** Shell used to run job scripts and detect the `claude` CLI. Ignored on Windows. |

## Limitations

- Cron's/Task Scheduler's scheduling granularity is one minute — sub-minute schedules aren't
  supported.
- **Windows only supports the built-in presets** (daily, weekdays, hourly, every N minutes).
  Windows Task Scheduler's native triggers can't represent arbitrary cron syntax, so raw
  "Custom cron expression" schedules aren't available there — the job form will warn you and
  block saving if you pick one on Windows.
- **macOS** may require granting `cron` Full Disk Access for jobs that read/write protected
  folders — see [Requirements](#requirements).

## License

MIT — see [LICENSE](LICENSE).

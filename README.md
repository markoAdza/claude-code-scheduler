# Prompt Scheduler for Claude Code

Schedule recurring [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI prompts on
Linux, managed from a panel in VS Code. Each job is a plain Linux **cron** entry under the
hood, so it keeps running on schedule even when VS Code is closed — the extension is a GUI on
top of your crontab, not a replacement scheduler that only works while VS Code is open.

## Features

- Add, edit, enable/disable, and delete scheduled prompts from a tree view in the Activity Bar.
- Each job has its own prompt, working directory, cron schedule, and output file.
- Schedule presets (daily, weekdays, hourly, every N minutes) or a raw cron expression, with a
  live preview of the next few run times.
- "Run Now" to try a job immediately without waiting for its schedule.
- Auto-detects the `claude` CLI even when it's only on your login shell's PATH (e.g. installed
  via nvm), so generated cron jobs can find it.
- Only ever touches its own clearly delimited block in your crontab — every other cron entry
  you have is left untouched.

## Requirements

- Linux, with the `crontab` command available.
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code) installed and already
  authenticated (`claude` should work from your terminal).

## Usage

1. Open the **Claude Code Scheduler** icon in the Activity Bar.
2. Click **Add Job** and fill in a name, prompt, working directory, schedule, and output file.
3. Save — the extension writes a runner script and syncs your crontab automatically.
4. Use the job's inline actions to run it immediately, edit it, enable/disable it, view its last
   output, open its prompt file, or delete it.

## How it works

For each job, the extension writes `prompt.txt` and `run.sh` under its data directory (default
`~/.claude-code-scheduler/scripts/<job-id>/`), and adds one line for it inside a managed block
in your crontab:

```
# >>> claude-code-scheduler managed jobs (do not edit manually) >>>
0 7 * * * /bin/bash "/home/you/.claude-code-scheduler/scripts/<job-id>/run.sh" # claude-code-scheduler:<job-id>
# <<< claude-code-scheduler managed jobs <<<
```

Editing a job regenerates its script and re-syncs this block; everything outside the markers in
your crontab is left exactly as it was.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `claudeCodeScheduler.claudeExecutablePath` | `""` (auto-detect) | Absolute path to the `claude` CLI. |
| `claudeCodeScheduler.additionalPathEntries` | `[]` | Extra directories prepended to `PATH` in generated scripts. |
| `claudeCodeScheduler.dataDirectory` | `~/.claude-code-scheduler` | Where job definitions, scripts, prompts, and logs live. |
| `claudeCodeScheduler.shell` | `/bin/bash` | Shell used to run job scripts and detect the `claude` CLI. |

## Limitations

- Linux-only (relies on `crontab`); untested on macOS/Windows.
- Cron's scheduling granularity is one minute — sub-minute schedules aren't supported.

## License

MIT — see [LICENSE](LICENSE).

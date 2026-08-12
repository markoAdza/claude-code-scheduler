import * as fs from 'fs/promises';
import * as path from 'path';
import { ClaudeJob } from './job';
import { RUN_HISTORY_MAX_ENTRIES } from './runHistory';
import { getRunsTouchFile } from './runStatus';

export const DEFAULT_JOB_TIMEOUT_MINUTES = 30;

export interface JobScriptPaths {
  dir: string;
  promptFile: string;
  runScript: string;
  errorLog: string;
  statusFile: string;
  historyFile: string;
  lockDir: string;
}

export function getScriptPaths(
  dataDir: string,
  jobId: string,
  platform: NodeJS.Platform = process.platform,
): JobScriptPaths {
  const dir = path.join(dataDir, 'scripts', jobId);
  const scriptExt = platform === 'win32' ? 'ps1' : 'sh';
  return {
    dir,
    promptFile: path.join(dir, 'prompt.txt'),
    runScript: path.join(dir, `run.${scriptExt}`),
    errorLog: path.join(dir, 'error.log'),
    statusFile: path.join(dir, 'status.json'),
    historyFile: path.join(dir, 'history.jsonl'),
    lockDir: path.join(dir, '.lock'),
  };
}

/** Wraps `value` in single quotes for POSIX shells, escaping embedded single quotes. Every
 * user- or config-supplied string (working directory, output path, CLI path, PATH entries) must
 * go through this before being interpolated into a generated script — otherwise a value
 * containing `"`, `$`, or backticks can break out of the surrounding quoting and run arbitrary
 * shell code the next time the job fires. */
function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildRunScriptPosix(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  dataDir: string,
  timeoutMinutes: number,
): string {
  const timeoutSeconds = Math.max(1, Math.round(timeoutMinutes * 60));
  const lines = ['#!/bin/bash'];
  if (additionalPathEntries.length > 0) {
    lines.push(`export PATH=${additionalPathEntries.map(shQuote).join(':')}:"$PATH"`);
  }

  // Portable mutex: `mkdir` is atomic on every POSIX filesystem, unlike `flock` (util-linux only,
  // not shipped on macOS) which would make this unusable on half of the supported platforms.
  lines.push(
    `LOCK_DIR=${shQuote(paths.lockDir)}`,
    'if ! mkdir "$LOCK_DIR" 2>/dev/null; then',
    `  printf '%s previous run still in progress, skipping\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> ${shQuote(paths.errorLog)}`,
    '  exit 0',
    'fi',
    // Single-quoted so "$LOCK_DIR" is expanded when the trap actually fires, not right now —
    // nesting a second quoted literal inside this string (rather than a variable reference)
    // would terminate the outer quoting early and produce invalid shell syntax.
    "trap 'rmdir \"$LOCK_DIR\" 2>/dev/null' EXIT",
    '',
    'EXIT_CODE=1',
    `if cd ${shQuote(job.cwd)}; then`,
    `  ${shQuote(claudeExecutablePath)} -p "$(cat ${shQuote(paths.promptFile)})" > ${shQuote(job.outputPath)} 2>> ${shQuote(paths.errorLog)} &`,
    '  CLAUDE_PID=$!',
    // A watchdog subshell that SIGTERMs (then SIGKILLs, since not every process honors SIGTERM)
    // the claude invocation if it's still running once the configured timeout elapses — without
    // this, a run stuck on e.g. an unanswerable permission prompt (no TTY under cron/Task
    // Scheduler) blocks forever and, combined with the lock above, wedges every future run too.
    `  ( sleep ${timeoutSeconds}; kill -TERM "$CLAUDE_PID" 2>/dev/null; sleep 5; kill -KILL "$CLAUDE_PID" 2>/dev/null ) &`,
    '  WATCHDOG_PID=$!',
    '  wait "$CLAUDE_PID"',
    '  EXIT_CODE=$?',
    '  kill "$WATCHDOG_PID" 2>/dev/null',
    '  wait "$WATCHDOG_PID" 2>/dev/null',
    'fi',
    '',
    // Written on every run — scheduled or manual — so the extension can show real run status
    // instead of only reflecting runs started from inside VS Code.
    `printf '{"timestamp":"%s","exitCode":%d}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EXIT_CODE" > ${shQuote(paths.statusFile)}`,
    // Appended (not overwritten) so the extension can show run history, then trimmed to the
    // most recent entries so a job scheduled every minute doesn't grow this file forever.
    `printf '{"timestamp":"%s","exitCode":%d}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$EXIT_CODE" >> ${shQuote(paths.historyFile)}`,
    `tail -n ${RUN_HISTORY_MAX_ENTRIES} ${shQuote(paths.historyFile)} > ${shQuote(`${paths.historyFile}.tmp`)} 2>/dev/null && mv ${shQuote(`${paths.historyFile}.tmp`)} ${shQuote(paths.historyFile)}`,
    `touch ${shQuote(getRunsTouchFile(dataDir))} 2>/dev/null`,
    'exit "$EXIT_CODE"',
  );
  return `${lines.join('\n')}\n`;
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildRunScriptWindows(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  dataDir: string,
  timeoutMinutes: number,
): string {
  const timeoutSeconds = Math.max(1, Math.round(timeoutMinutes * 60));
  const lines = [
    '$ErrorActionPreference = "Stop"',
    // Without these, Windows PowerShell decodes/re-encodes native-process I/O using the
    // legacy console codepage instead of UTF-8, corrupting non-ASCII prompt/output text.
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    '$OutputEncoding = [System.Text.Encoding]::UTF8',
  ];
  if (additionalPathEntries.length > 0) {
    lines.push(`$env:Path = ${psQuote(`${additionalPathEntries.join(';')};`)} + $env:Path`);
  }

  // Portable mutex: creating a directory is atomic, so a second concurrent run backs off instead
  // of racing the first on the same output file.
  lines.push(
    `$lockDir = ${psQuote(paths.lockDir)}`,
    'try {',
    '  New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop | Out-Null',
    '} catch {',
    '  exit 0',
    '}',
    '',
    '$exitCode = 1',
    'try {',
    `  Set-Location -LiteralPath ${psQuote(job.cwd)}`,
    `  $prompt = [System.IO.File]::ReadAllText(${psQuote(paths.promptFile)}, [System.Text.Encoding]::UTF8)`,
    '',
    // Runs claude in a background job so a `Wait-Job -Timeout` can enforce the configured
    // timeout — a run stuck on an unanswerable permission prompt (no TTY under Task Scheduler)
    // would otherwise block forever and, combined with the lock above, wedge every future run.
    '  $job = Start-Job -ScriptBlock {',
    '    param($promptText)',
    `    & ${psQuote(claudeExecutablePath)} -p $promptText 1> ${psQuote(job.outputPath)} 2>> ${psQuote(paths.errorLog)}`,
    '    $LASTEXITCODE',
    '  } -ArgumentList $prompt',
    '',
    `  Wait-Job -Job $job -Timeout ${timeoutSeconds} | Out-Null`,
    "  if ($job.State -eq 'Completed') {",
    '    $received = Receive-Job -Job $job',
    '    if ($null -ne $received) { $exitCode = $received }',
    '  } else {',
    '    Stop-Job -Job $job',
    '  }',
    '  Remove-Job -Job $job -Force -ErrorAction SilentlyContinue',
    '} catch {',
    '  $exitCode = 1',
    '}',
    '',
    // Written on every run — scheduled or manual — so the extension can show real run status
    // instead of only reflecting runs started from inside VS Code.
    "$status = '{\"timestamp\":\"' + (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') + '\",\"exitCode\":' + $exitCode + '}'",
    `try { [System.IO.File]::WriteAllText(${psQuote(paths.statusFile)}, $status, [System.Text.Encoding]::UTF8) } catch {}`,
    // Appended (not overwritten) so the extension can show run history, then trimmed to the
    // most recent entries so a job scheduled every minute doesn't grow this file forever.
    `try { Add-Content -LiteralPath ${psQuote(paths.historyFile)} -Value $status -Encoding UTF8 } catch {}`,
    `try { (Get-Content -LiteralPath ${psQuote(paths.historyFile)} -ErrorAction Stop | Select-Object -Last ${RUN_HISTORY_MAX_ENTRIES}) | Set-Content -LiteralPath ${psQuote(paths.historyFile)} -Encoding UTF8 } catch {}`,
    `try { [System.IO.File]::WriteAllText(${psQuote(getRunsTouchFile(dataDir))}, '', [System.Text.Encoding]::UTF8) } catch {}`,
    'Remove-Item -LiteralPath $lockDir -Recurse -Force -ErrorAction SilentlyContinue',
    'exit $exitCode',
  );
  return `${lines.join('\n')}\n`;
}

export function buildRunScript(
  job: ClaudeJob,
  paths: JobScriptPaths,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  dataDir: string,
  timeoutMinutes: number = DEFAULT_JOB_TIMEOUT_MINUTES,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32'
    ? buildRunScriptWindows(job, paths, claudeExecutablePath, additionalPathEntries, dataDir, timeoutMinutes)
    : buildRunScriptPosix(job, paths, claudeExecutablePath, additionalPathEntries, dataDir, timeoutMinutes);
}

export async function writeJobScript(
  job: ClaudeJob,
  dataDir: string,
  claudeExecutablePath: string,
  additionalPathEntries: string[],
  timeoutMinutes: number = DEFAULT_JOB_TIMEOUT_MINUTES,
  platform: NodeJS.Platform = process.platform,
): Promise<JobScriptPaths> {
  const paths = getScriptPaths(dataDir, job.id, platform);
  await fs.mkdir(paths.dir, { recursive: true });
  await fs.writeFile(paths.promptFile, job.prompt, 'utf8');
  const script = buildRunScript(job, paths, claudeExecutablePath, additionalPathEntries, dataDir, timeoutMinutes, platform);
  await fs.writeFile(paths.runScript, script, platform === 'win32' ? 'utf8' : { mode: 0o755 });
  return paths;
}

export async function removeJobScript(dataDir: string, jobId: string): Promise<void> {
  const { dir } = getScriptPaths(dataDir, jobId);
  await fs.rm(dir, { recursive: true, force: true });
}

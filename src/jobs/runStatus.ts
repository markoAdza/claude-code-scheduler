import * as fsSync from 'fs';
import * as path from 'path';

/** Filename touched inside the data directory root after every job run, so a single directory
 * watcher there (mirroring {@link JobStore}'s watch for `jobs.json`) can pick up completions of
 * scripts that run outside VS Code (i.e. actual OS-scheduled runs, not just "Run Now"). */
export const RUNS_TOUCH_FILENAME = 'runs.touch';

export function getRunsTouchFile(dataDir: string): string {
  return path.join(dataDir, RUNS_TOUCH_FILENAME);
}

export interface JobRunStatus {
  timestamp: string;
  exitCode: number;
}

/**
 * Best-effort, synchronous read of a job's last-run status. The generated run script writes this
 * file after every execution — whether triggered by the OS scheduler or "Run Now" — so it reflects
 * real runs instead of only ones started from inside VS Code. Synchronous because tree items are
 * built synchronously and this file is only a few bytes.
 */
export function readRunStatus(statusFile: string): JobRunStatus | undefined {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(statusFile, 'utf8')) as Partial<JobRunStatus>;
    if (typeof parsed.exitCode === 'number' && typeof parsed.timestamp === 'string') {
      return { timestamp: parsed.timestamp, exitCode: parsed.exitCode };
    }
    return undefined;
  } catch {
    return undefined;
  }
}

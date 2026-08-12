import * as fsSync from 'fs';

/** Generated scripts truncate history.jsonl to this many most-recent lines after every run, so
 * a job scheduled every minute for months doesn't grow the file without bound. */
export const RUN_HISTORY_MAX_ENTRIES = 50;

export interface JobRunHistoryEntry {
  timestamp: string;
  exitCode: number;
}

/**
 * Best-effort read of a job's run history from its `history.jsonl` file (one JSON object per
 * line, oldest first — mirroring append order in the generated script). Malformed or partial
 * lines (e.g. a run that was interrupted mid-write) are skipped rather than failing the read.
 */
export function readRunHistory(historyFile: string): JobRunHistoryEntry[] {
  let raw: string;
  try {
    raw = fsSync.readFileSync(historyFile, 'utf8');
  } catch {
    return [];
  }
  const entries: JobRunHistoryEntry[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as Partial<JobRunHistoryEntry>;
      if (typeof parsed.exitCode === 'number' && typeof parsed.timestamp === 'string') {
        entries.push({ timestamp: parsed.timestamp, exitCode: parsed.exitCode });
      }
    } catch {
      // Skip a malformed line rather than failing the whole read.
    }
  }
  return entries;
}

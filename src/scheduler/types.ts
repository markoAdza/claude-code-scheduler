import { ClaudeJob } from '../jobs/job';

export interface SchedulerContext {
  dataDir: string;
  /** POSIX shell used to run generated job scripts and detect the claude CLI. Ignored on Windows. */
  shell: string;
}

/**
 * Abstracts over the OS-native scheduling mechanism (cron on Linux/macOS, Windows Task
 * Scheduler on Windows) so the rest of the extension doesn't need to branch on platform.
 */
export interface SchedulerBackend {
  readonly displayName: string;
  /** Command whose absence should surface a startup warning (e.g. "crontab", "schtasks"). */
  readonly requiredCommand: string;
  sync(jobs: ClaudeJob[], context: SchedulerContext): Promise<void>;
  hasDrifted(jobs: ClaudeJob[], context: SchedulerContext): Promise<boolean>;
}

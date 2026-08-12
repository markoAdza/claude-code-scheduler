import { CronManager } from '../cron/cronManager';
import { ClaudeJob } from '../jobs/job';
import { SchedulerBackend, SchedulerContext } from './types';

/** Adapts the existing crontab-based {@link CronManager} to the {@link SchedulerBackend} interface. */
export class CronSchedulerBackend implements SchedulerBackend {
  readonly displayName = 'cron';
  readonly requiredCommand = 'crontab';

  constructor(private readonly manager: CronManager = new CronManager()) {}

  async sync(jobs: ClaudeJob[], context: SchedulerContext): Promise<void> {
    await this.manager.sync(jobs, context.dataDir, context.shell);
  }

  async hasDrifted(jobs: ClaudeJob[], context: SchedulerContext): Promise<boolean> {
    return this.manager.hasDrifted(jobs, context.dataDir, context.shell);
  }
}

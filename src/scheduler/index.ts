import { CronSchedulerBackend } from './cronSchedulerBackend';
import { SchedulerBackend } from './types';
import { WindowsTaskSchedulerBackend } from './windowsTaskSchedulerBackend';

export { SchedulerBackend, SchedulerContext } from './types';

export function createSchedulerBackend(platform: NodeJS.Platform = process.platform): SchedulerBackend {
  return platform === 'win32' ? new WindowsTaskSchedulerBackend() : new CronSchedulerBackend();
}

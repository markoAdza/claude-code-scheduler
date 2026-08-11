import { execFile } from 'child_process';
import { ClaudeJob } from '../jobs/job';
import { getScriptPaths } from '../jobs/scriptGenerator';

export const CRON_BEGIN_MARKER = '# >>> claude-code-scheduler managed jobs (do not edit manually) >>>';
export const CRON_END_MARKER = '# <<< claude-code-scheduler managed jobs <<<';

export interface CrontabRunner {
  read(): Promise<string>;
  write(content: string): Promise<void>;
}

/** Real crontab I/O, isolated behind {@link CrontabRunner} so the merge logic can be unit-tested without touching the system crontab. */
export class SystemCrontabRunner implements CrontabRunner {
  async read(): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      execFile('crontab', ['-l'], (error, stdout) => {
        if (!error) {
          resolve(stdout);
          return;
        }
        // "no crontab for <user>" exits with status 1 on every common distro.
        if (error.code === 1) {
          resolve('');
          return;
        }
        reject(error);
      });
    });
  }

  async write(content: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const child = execFile('crontab', ['-'], (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
      child.stdin?.end(content);
    });
  }
}

export function buildManagedBlock(jobs: ClaudeJob[], dataDir: string, shell: string): string {
  const lines = jobs
    .filter((job) => job.enabled)
    .map((job) => {
      const { runScript } = getScriptPaths(dataDir, job.id);
      return `${job.schedule} ${shell} "${runScript}" # claude-code-scheduler:${job.id}`;
    });
  return [CRON_BEGIN_MARKER, ...lines, CRON_END_MARKER].join('\n');
}

export function extractManagedBlock(crontab: string): string | undefined {
  const beginIndex = crontab.indexOf(CRON_BEGIN_MARKER);
  const endIndex = crontab.indexOf(CRON_END_MARKER);
  if (beginIndex === -1 || endIndex === -1) {
    return undefined;
  }
  return crontab.slice(beginIndex, endIndex + CRON_END_MARKER.length);
}

export function replaceManagedBlock(crontab: string, managedBlock: string): string {
  const beginIndex = crontab.indexOf(CRON_BEGIN_MARKER);
  const endIndex = crontab.indexOf(CRON_END_MARKER);

  if (beginIndex === -1 || endIndex === -1) {
    const trimmed = crontab.replace(/\s+$/, '');
    return `${trimmed}${trimmed ? '\n\n' : ''}${managedBlock}\n`;
  }

  const before = crontab.slice(0, beginIndex);
  const after = crontab.slice(endIndex + CRON_END_MARKER.length);
  return `${before}${managedBlock}${after}`;
}

export class CronManager {
  constructor(private readonly runner: CrontabRunner = new SystemCrontabRunner()) {}

  async sync(jobs: ClaudeJob[], dataDir: string, shell: string): Promise<void> {
    const current = await this.runner.read();
    const managedBlock = buildManagedBlock(jobs, dataDir, shell);
    await this.runner.write(replaceManagedBlock(current, managedBlock));
  }

  async hasDrifted(jobs: ClaudeJob[], dataDir: string, shell: string): Promise<boolean> {
    const current = await this.runner.read();
    const liveBlock = extractManagedBlock(current);
    const expectedBlock = buildManagedBlock(jobs, dataDir, shell);
    if (liveBlock === undefined) {
      return jobs.some((job) => job.enabled);
    }
    return liveBlock !== expectedBlock;
  }
}

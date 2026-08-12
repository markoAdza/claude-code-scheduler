import { execFile } from 'child_process';
import { promisify } from 'util';
import { ClaudeJob } from '../jobs/job';
import { getScriptPaths } from '../jobs/scriptGenerator';
import { SchedulerBackend, SchedulerContext } from './types';

const execFileAsync = promisify(execFile);

/** Task Scheduler folder every job task lives under, so they're grouped in the Task Scheduler UI. */
export const WINDOWS_TASK_FOLDER = '\\ClaudeCodeScheduler';

const DAY_NAMES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export type WindowsScheduleType = 'DAILY' | 'WEEKLY' | 'HOURLY' | 'MINUTE';

export interface WindowsTrigger {
  schedule: WindowsScheduleType;
  /** 24h "HH:MM" start time. */
  startTime: string;
  /** Repeat interval for HOURLY (hours) and MINUTE (minutes) triggers. */
  modifier?: number;
  /** Day-of-week abbreviations (e.g. ["MON", "TUE"]) for WEEKLY triggers. */
  days?: string[];
}

export function taskNameFor(jobId: string): string {
  return `${WINDOWS_TASK_FOLDER}\\${jobId}`;
}

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

function parseSingleInt(field: string): number | undefined {
  return /^\d+$/.test(field) ? Number.parseInt(field, 10) : undefined;
}

function parseStep(field: string): number | undefined {
  const match = /^\*\/(\d+)$/.exec(field);
  return match ? Number.parseInt(match[1], 10) : undefined;
}

/** Expands a cron day-of-week field (list of single values and/or ranges, 0-7, 7=Sunday) to day abbreviations. */
function parseDowList(field: string): string[] | undefined {
  if (field === '*') {
    return undefined;
  }
  const days = new Set<number>();
  for (const part of field.split(',')) {
    const rangeMatch = /^(\d)-(\d)$/.exec(part);
    if (rangeMatch) {
      const lo = Number.parseInt(rangeMatch[1], 10);
      const hi = Number.parseInt(rangeMatch[2], 10);
      if (lo > hi || lo < 0 || hi > 7) {
        return undefined;
      }
      for (let value = lo; value <= hi; value++) {
        days.add(value === 7 ? 0 : value);
      }
      continue;
    }
    const single = parseSingleInt(part);
    if (single === undefined || single < 0 || single > 7) {
      return undefined;
    }
    days.add(single === 7 ? 0 : single);
  }
  return days.size > 0 ? Array.from(days).sort((a, b) => a - b).map((day) => DAY_NAMES[day]) : undefined;
}

/**
 * Recognizes exactly the four schedule shapes the job form's presets produce (daily, weekdays,
 * hourly, every N minutes) and maps them to a native Task Scheduler trigger. Anything else
 * (custom cron expressions with day-of-month/month restrictions, list/range minute or hour
 * fields, etc.) returns undefined — Windows Task Scheduler can't represent arbitrary cron syntax.
 */
export function translateCronToWindowsTrigger(cronExpression: string): WindowsTrigger | undefined {
  const fields = cronExpression.trim().split(/\s+/);
  if (fields.length !== 5) {
    return undefined;
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (dayOfMonth !== '*' || month !== '*') {
    return undefined;
  }

  if (dayOfWeek !== '*') {
    const minuteVal = parseSingleInt(minute);
    const hourVal = parseSingleInt(hour);
    const days = parseDowList(dayOfWeek);
    if (minuteVal === undefined || hourVal === undefined || !days) {
      return undefined;
    }
    return { schedule: 'WEEKLY', days, startTime: `${pad2(hourVal)}:${pad2(minuteVal)}` };
  }

  const minuteStep = parseStep(minute);
  if (minuteStep !== undefined && hour === '*') {
    return { schedule: 'MINUTE', modifier: minuteStep, startTime: '00:00' };
  }

  const minuteVal = parseSingleInt(minute);
  if (minuteVal !== undefined && hour === '*') {
    return { schedule: 'HOURLY', modifier: 1, startTime: `00:${pad2(minuteVal)}` };
  }

  const hourVal = parseSingleInt(hour);
  if (minuteVal !== undefined && hourVal !== undefined) {
    return { schedule: 'DAILY', startTime: `${pad2(hourVal)}:${pad2(minuteVal)}` };
  }

  return undefined;
}

export function buildWindowsAction(runScriptPath: string): string {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${runScriptPath}"`;
}

export function buildSchtasksCreateArgs(taskName: string, trigger: WindowsTrigger, action: string): string[] {
  const args = [
    '/Create',
    '/F',
    '/TN',
    taskName,
    '/TR',
    action,
    '/SC',
    trigger.schedule,
    '/ST',
    trigger.startTime,
    '/RL',
    'LIMITED',
  ];
  if (trigger.modifier !== undefined) {
    args.push('/MO', String(trigger.modifier));
  }
  if (trigger.days) {
    args.push('/D', trigger.days.join(','));
  }
  return args;
}

export interface TaskSchedulerRunner {
  /** Lists task names (e.g. "\ClaudeCodeScheduler\<jobId>") currently registered under our folder. */
  list(): Promise<string[]>;
  create(taskName: string, trigger: WindowsTrigger, action: string): Promise<void>;
  delete(taskName: string): Promise<void>;
}

/** Real `schtasks.exe` I/O, isolated behind {@link TaskSchedulerRunner} so sync logic is unit-testable. */
export class SystemTaskSchedulerRunner implements TaskSchedulerRunner {
  async list(): Promise<string[]> {
    try {
      const { stdout } = await execFileAsync('schtasks', ['/Query', '/FO', 'CSV', '/NH']);
      return stdout
        .split(/\r?\n/)
        .map((line) => line.split(',')[0]?.replace(/^"|"$/g, ''))
        .filter((name): name is string => !!name && name.startsWith(`${WINDOWS_TASK_FOLDER}\\`));
    } catch {
      return [];
    }
  }

  async create(taskName: string, trigger: WindowsTrigger, action: string): Promise<void> {
    await execFileAsync('schtasks', buildSchtasksCreateArgs(taskName, trigger, action));
  }

  async delete(taskName: string): Promise<void> {
    try {
      await execFileAsync('schtasks', ['/Delete', '/TN', taskName, '/F']);
    } catch {
      // Already absent — fine.
    }
  }
}

export class WindowsTaskSchedulerBackend implements SchedulerBackend {
  readonly displayName = 'Windows Task Scheduler';
  readonly requiredCommand = 'schtasks';

  constructor(private readonly runner: TaskSchedulerRunner = new SystemTaskSchedulerRunner()) {}

  async sync(jobs: ClaudeJob[], context: SchedulerContext): Promise<void> {
    const existing = await this.runner.list();
    const expected = new Set<string>();
    const errors: string[] = [];

    for (const job of jobs.filter((j) => j.enabled)) {
      const trigger = translateCronToWindowsTrigger(job.schedule);
      if (!trigger) {
        errors.push(
          `"${job.name}": schedule "${job.schedule}" isn't supported on Windows. Use one of the built-in presets (daily, weekdays, hourly, every N minutes).`,
        );
        continue;
      }
      const taskName = taskNameFor(job.id);
      expected.add(taskName);
      const { runScript } = getScriptPaths(context.dataDir, job.id, 'win32');
      await this.runner.create(taskName, trigger, buildWindowsAction(runScript));
    }

    for (const taskName of existing) {
      if (!expected.has(taskName)) {
        await this.runner.delete(taskName);
      }
    }

    if (errors.length > 0) {
      throw new Error(errors.join('\n'));
    }
  }

  async hasDrifted(jobs: ClaudeJob[], _context: SchedulerContext): Promise<boolean> {
    const existing = new Set(await this.runner.list());
    const expected = new Set(
      jobs
        .filter((job) => job.enabled && translateCronToWindowsTrigger(job.schedule) !== undefined)
        .map((job) => taskNameFor(job.id)),
    );
    if (existing.size !== expected.size) {
      return true;
    }
    for (const taskName of expected) {
      if (!existing.has(taskName)) {
        return true;
      }
    }
    return false;
  }
}

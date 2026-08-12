import * as assert from 'assert';
import { ClaudeJob } from '../../src/jobs/job';
import {
  TaskSchedulerRunner,
  WindowsTaskSchedulerBackend,
  WindowsTrigger,
  buildSchtasksCreateArgs,
  buildWindowsAction,
  taskNameFor,
  translateCronToWindowsTrigger,
} from '../../src/scheduler/windowsTaskSchedulerBackend';

function makeJob(overrides: Partial<ClaudeJob> = {}): ClaudeJob {
  return {
    id: 'abc-123',
    name: 'Test job',
    prompt: 'Hello',
    cwd: 'C:\\Users\\dev\\project',
    schedule: '0 7 * * *',
    outputPath: 'C:\\Users\\dev\\project\\output.md',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

class FakeTaskSchedulerRunner implements TaskSchedulerRunner {
  created: { taskName: string; trigger: WindowsTrigger; action: string }[] = [];
  deleted: string[] = [];

  constructor(private tasks: string[] = []) {}

  async list(): Promise<string[]> {
    return [...this.tasks];
  }

  async create(taskName: string, trigger: WindowsTrigger, action: string): Promise<void> {
    this.created.push({ taskName, trigger, action });
    if (!this.tasks.includes(taskName)) {
      this.tasks.push(taskName);
    }
  }

  async delete(taskName: string): Promise<void> {
    this.deleted.push(taskName);
    this.tasks = this.tasks.filter((name) => name !== taskName);
  }
}

suite('translateCronToWindowsTrigger', () => {
  test('maps the "daily" preset shape to a DAILY trigger', () => {
    assert.deepStrictEqual(translateCronToWindowsTrigger('30 7 * * *'), {
      schedule: 'DAILY',
      startTime: '07:30',
    });
  });

  test('maps the "weekdays" preset shape to a WEEKLY trigger', () => {
    assert.deepStrictEqual(translateCronToWindowsTrigger('0 9 * * 1-5'), {
      schedule: 'WEEKLY',
      days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
      startTime: '09:00',
    });
  });

  test('treats day-of-week 7 as Sunday and dedupes against 0', () => {
    assert.deepStrictEqual(translateCronToWindowsTrigger('0 0 * * 0,6,7'), {
      schedule: 'WEEKLY',
      days: ['SUN', 'SAT'],
      startTime: '00:00',
    });
  });

  test('maps the "hourly" preset shape to an HOURLY trigger anchored at the given minute', () => {
    assert.deepStrictEqual(translateCronToWindowsTrigger('0 * * * *'), {
      schedule: 'HOURLY',
      modifier: 1,
      startTime: '00:00',
    });
    assert.deepStrictEqual(translateCronToWindowsTrigger('15 * * * *'), {
      schedule: 'HOURLY',
      modifier: 1,
      startTime: '00:15',
    });
  });

  test('maps the "every N minutes" preset shape to a MINUTE trigger anchored at midnight', () => {
    assert.deepStrictEqual(translateCronToWindowsTrigger('*/15 * * * *'), {
      schedule: 'MINUTE',
      modifier: 15,
      startTime: '00:00',
    });
  });

  test('rejects expressions with day-of-month or month restrictions', () => {
    assert.strictEqual(translateCronToWindowsTrigger('0 7 1 * *'), undefined);
    assert.strictEqual(translateCronToWindowsTrigger('0 7 * 6 *'), undefined);
  });

  test('rejects list/range minute or hour fields not produced by any preset', () => {
    assert.strictEqual(translateCronToWindowsTrigger('15,45 * * * *'), undefined);
    assert.strictEqual(translateCronToWindowsTrigger('*/5 3 * * *'), undefined);
  });

  test('rejects malformed expressions', () => {
    assert.strictEqual(translateCronToWindowsTrigger('not a cron expression'), undefined);
    assert.strictEqual(translateCronToWindowsTrigger('* * * *'), undefined);
  });
});

suite('buildSchtasksCreateArgs', () => {
  test('builds args for a DAILY trigger', () => {
    const args = buildSchtasksCreateArgs('\\ClaudeCodeScheduler\\job-1', { schedule: 'DAILY', startTime: '07:30' }, 'run.exe');
    assert.deepStrictEqual(args, [
      '/Create',
      '/F',
      '/TN',
      '\\ClaudeCodeScheduler\\job-1',
      '/TR',
      'run.exe',
      '/SC',
      'DAILY',
      '/ST',
      '07:30',
      '/RL',
      'LIMITED',
    ]);
  });

  test('includes /MO for MINUTE triggers and /D for WEEKLY triggers', () => {
    const minuteArgs = buildSchtasksCreateArgs('\\x\\y', { schedule: 'MINUTE', modifier: 15, startTime: '00:00' }, 'run.exe');
    assert.ok(minuteArgs.includes('/MO') && minuteArgs[minuteArgs.indexOf('/MO') + 1] === '15');

    const weeklyArgs = buildSchtasksCreateArgs(
      '\\x\\y',
      { schedule: 'WEEKLY', days: ['MON', 'TUE'], startTime: '09:00' },
      'run.exe',
    );
    assert.ok(weeklyArgs.includes('/D') && weeklyArgs[weeklyArgs.indexOf('/D') + 1] === 'MON,TUE');
  });
});

suite('buildWindowsAction', () => {
  test('wraps the run script in a hidden, non-interactive PowerShell invocation', () => {
    const action = buildWindowsAction('C:\\data\\scripts\\job-1\\run.ps1');
    assert.strictEqual(
      action,
      'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "C:\\data\\scripts\\job-1\\run.ps1"',
    );
  });
});

suite('WindowsTaskSchedulerBackend', () => {
  test('sync creates a task per enabled job with a translatable schedule', async () => {
    const runner = new FakeTaskSchedulerRunner();
    const backend = new WindowsTaskSchedulerBackend(runner);
    const job = makeJob();

    await backend.sync([job], { dataDir: 'C:\\data', shell: '' });

    assert.strictEqual(runner.created.length, 1);
    assert.strictEqual(runner.created[0].taskName, taskNameFor(job.id));
    assert.deepStrictEqual(runner.created[0].trigger, { schedule: 'DAILY', startTime: '07:00' });
  });

  test('sync skips disabled jobs', async () => {
    const runner = new FakeTaskSchedulerRunner();
    const backend = new WindowsTaskSchedulerBackend(runner);

    await backend.sync([makeJob({ enabled: false })], { dataDir: 'C:\\data', shell: '' });

    assert.strictEqual(runner.created.length, 0);
  });

  test('sync removes tasks for jobs that are no longer enabled/present', async () => {
    const staleTaskName = taskNameFor('stale-job');
    const runner = new FakeTaskSchedulerRunner([staleTaskName]);
    const backend = new WindowsTaskSchedulerBackend(runner);

    await backend.sync([makeJob()], { dataDir: 'C:\\data', shell: '' });

    assert.ok(runner.deleted.includes(staleTaskName));
  });

  test('sync throws an aggregate error for jobs with unsupported schedules, but still schedules the rest', async () => {
    const runner = new FakeTaskSchedulerRunner();
    const backend = new WindowsTaskSchedulerBackend(runner);
    const goodJob = makeJob({ id: 'good', schedule: '0 7 * * *' });
    const badJob = makeJob({ id: 'bad', name: 'Bad job', schedule: '15,45 * * * *' });

    await assert.rejects(
      () => backend.sync([goodJob, badJob], { dataDir: 'C:\\data', shell: '' }),
      /Bad job.*isn't supported on Windows/,
    );
    assert.strictEqual(runner.created.length, 1);
    assert.strictEqual(runner.created[0].taskName, taskNameFor('good'));
  });

  test('hasDrifted is false right after a sync', async () => {
    const runner = new FakeTaskSchedulerRunner();
    const backend = new WindowsTaskSchedulerBackend(runner);
    const jobs = [makeJob()];

    await backend.sync(jobs, { dataDir: 'C:\\data', shell: '' });

    assert.strictEqual(await backend.hasDrifted(jobs, { dataDir: 'C:\\data', shell: '' }), false);
  });

  test('hasDrifted is true when a managed task was removed outside the extension', async () => {
    const runner = new FakeTaskSchedulerRunner();
    const backend = new WindowsTaskSchedulerBackend(runner);
    const jobs = [makeJob()];

    await backend.sync(jobs, { dataDir: 'C:\\data', shell: '' });
    await runner.delete(taskNameFor(jobs[0].id));

    assert.strictEqual(await backend.hasDrifted(jobs, { dataDir: 'C:\\data', shell: '' }), true);
  });
});

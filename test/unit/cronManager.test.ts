import * as assert from 'assert';
import {
  CRON_BEGIN_MARKER,
  CRON_END_MARKER,
  CronManager,
  CrontabRunner,
  buildManagedBlock,
  extractManagedBlock,
  replaceManagedBlock,
} from '../../src/cron/cronManager';
import { ClaudeJob } from '../../src/jobs/job';

function makeJob(overrides: Partial<ClaudeJob> = {}): ClaudeJob {
  return {
    id: 'abc-123',
    name: 'Test job',
    prompt: 'Hello',
    cwd: '/home/user/project',
    schedule: '0 7 * * *',
    outputPath: '/home/user/project/output.md',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

class FakeCrontabRunner implements CrontabRunner {
  written: string[] = [];

  constructor(private content: string) {}

  async read(): Promise<string> {
    return this.content;
  }

  async write(content: string): Promise<void> {
    this.content = content;
    this.written.push(content);
  }
}

suite('cronManager', () => {
  test('buildManagedBlock only includes enabled jobs', () => {
    const jobs = [makeJob({ id: 'a', enabled: true }), makeJob({ id: 'b', enabled: false })];
    const block = buildManagedBlock(jobs, '/data', '/bin/bash');

    assert.ok(block.includes('claude-code-scheduler:a'));
    assert.ok(!block.includes('claude-code-scheduler:b'));
    assert.ok(block.startsWith(CRON_BEGIN_MARKER));
    assert.ok(block.endsWith(CRON_END_MARKER));
  });

  test('extractManagedBlock returns undefined when no markers are present', () => {
    assert.strictEqual(extractManagedBlock('0 5 * * * /usr/bin/backup.sh\n'), undefined);
  });

  test('replaceManagedBlock appends the block to a crontab that has none yet', () => {
    const existing = '0 5 * * * /usr/bin/backup.sh\n';
    const block = `${CRON_BEGIN_MARKER}\n0 7 * * * /bin/bash "/data/scripts/a/run.sh" # claude-code-scheduler:a\n${CRON_END_MARKER}`;

    const result = replaceManagedBlock(existing, block);

    assert.ok(result.startsWith(existing.trimEnd()));
    assert.ok(result.includes(block));
  });

  test('replaceManagedBlock replaces only the managed section, preserving the rest', () => {
    const existing = [
      '0 5 * * * /usr/bin/backup.sh',
      CRON_BEGIN_MARKER,
      '0 7 * * * /bin/bash "/data/scripts/OLD/run.sh" # claude-code-scheduler:OLD',
      CRON_END_MARKER,
      '0 9 * * * /usr/bin/other.sh',
      '',
    ].join('\n');
    const newBlock = `${CRON_BEGIN_MARKER}\n0 8 * * * /bin/bash "/data/scripts/NEW/run.sh" # claude-code-scheduler:NEW\n${CRON_END_MARKER}`;

    const result = replaceManagedBlock(existing, newBlock);

    assert.ok(result.includes('/usr/bin/backup.sh'));
    assert.ok(result.includes('/usr/bin/other.sh'));
    assert.ok(result.includes('claude-code-scheduler:NEW'));
    assert.ok(!result.includes('claude-code-scheduler:OLD'));
  });

  test('CronManager.sync writes the merged crontab through the injected runner', async () => {
    const runner = new FakeCrontabRunner('0 5 * * * /usr/bin/backup.sh\n');
    const manager = new CronManager(runner);

    await manager.sync([makeJob()], '/data', '/bin/bash');

    assert.strictEqual(runner.written.length, 1);
    assert.ok(runner.written[0].includes('/usr/bin/backup.sh'));
    assert.ok(runner.written[0].includes('claude-code-scheduler:abc-123'));
  });

  test('CronManager.hasDrifted is false right after a sync', async () => {
    const runner = new FakeCrontabRunner('');
    const manager = new CronManager(runner);
    const jobs = [makeJob()];

    await manager.sync(jobs, '/data', '/bin/bash');

    assert.strictEqual(await manager.hasDrifted(jobs, '/data', '/bin/bash'), false);
  });

  test('CronManager.hasDrifted is true when the crontab was hand-edited afterwards', async () => {
    const runner = new FakeCrontabRunner('');
    const manager = new CronManager(runner);
    const jobs = [makeJob()];

    await manager.sync(jobs, '/data', '/bin/bash');
    await runner.write('');

    assert.strictEqual(await manager.hasDrifted(jobs, '/data', '/bin/bash'), true);
  });
});

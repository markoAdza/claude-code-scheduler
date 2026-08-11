import * as assert from 'assert';
import { ClaudeJob } from '../../src/jobs/job';
import { buildRunScript, getScriptPaths } from '../../src/jobs/scriptGenerator';

function makeJob(overrides: Partial<ClaudeJob> = {}): ClaudeJob {
  return {
    id: 'job-1',
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

suite('scriptGenerator', () => {
  test('builds a script that cds into the working directory and redirects output', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', []);

    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /cd "\/home\/user\/project" \|\| exit 1/);
    assert.match(
      script,
      /"\/usr\/bin\/claude" -p "\$\(cat "\/data\/scripts\/job-1\/prompt\.txt"\)" > "\/home\/user\/project\/output\.md" 2>> "\/data\/scripts\/job-1\/error\.log"/,
    );
    assert.ok(script.endsWith('\n'));
  });

  test('prepends additional PATH entries when provided', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', ['/home/user/.nvm/versions/node/v22/bin']);

    assert.match(script, /export PATH="\/home\/user\/\.nvm\/versions\/node\/v22\/bin:\$PATH"/);
  });

  test('omits the PATH export line entirely when no entries are configured', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', []);

    assert.ok(!script.includes('export PATH'));
  });
});

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

  test('getScriptPaths uses a .ps1 extension on win32 and .sh elsewhere', () => {
    assert.match(getScriptPaths('/data', 'job-1', 'win32').runScript, /run\.ps1$/);
    assert.match(getScriptPaths('/data', 'job-1', 'linux').runScript, /run\.sh$/);
    assert.match(getScriptPaths('/data', 'job-1', 'darwin').runScript, /run\.sh$/);
  });

  test('builds a PowerShell script that cds into the working directory and redirects output', () => {
    const job = makeJob({ cwd: 'C:\\Users\\dev\\project', outputPath: 'C:\\Users\\dev\\project\\output.md' });
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], 'win32');

    assert.match(script, /^\$ErrorActionPreference = "Stop"\n/);
    assert.ok(script.includes('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'));
    assert.ok(script.includes("try { Set-Location -LiteralPath 'C:\\Users\\dev\\project' } catch { exit 1 }"));
    assert.ok(
      script.includes(`$prompt = [System.IO.File]::ReadAllText('${paths.promptFile}', [System.Text.Encoding]::UTF8)`),
    );
    assert.ok(
      script.includes(
        `& 'C:\\tools\\claude.exe' -p $prompt 1> 'C:\\Users\\dev\\project\\output.md' 2>> '${paths.errorLog}'`,
      ),
    );
    assert.match(script, /exit \$LASTEXITCODE\n$/);
  });

  test('PowerShell script prepends additional PATH entries with a semicolon join', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', ['C:\\nvm\\v22'], 'win32');

    assert.ok(script.includes("$env:Path = 'C:\\nvm\\v22;' + $env:Path"));
  });

  test('PowerShell script escapes embedded single quotes in paths', () => {
    const job = makeJob({ cwd: "C:\\Users\\O'Brien\\project" });
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], 'win32');

    assert.ok(script.includes("C:\\Users\\O''Brien\\project"));
  });
});

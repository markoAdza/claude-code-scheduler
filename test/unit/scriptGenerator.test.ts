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
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.match(script, /^#!\/bin\/bash\n/);
    assert.match(script, /if cd '\/home\/user\/project'; then/);
    assert.match(
      script,
      /'\/usr\/bin\/claude' -p "\$\(cat '\/data\/scripts\/job-1\/prompt\.txt'\)" > '\/home\/user\/project\/output\.md' 2>> '\/data\/scripts\/job-1\/error\.log'/,
    );
    assert.ok(script.endsWith('\n'));
  });

  test('prepends additional PATH entries when provided', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', ['/home/user/.nvm/versions/node/v22/bin'], '/data');

    assert.match(script, /export PATH='\/home\/user\/\.nvm\/versions\/node\/v22\/bin':"\$PATH"/);
  });

  test('omits the PATH export line entirely when no entries are configured', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.ok(!script.includes('export PATH'));
  });

  test('quotes a working directory and output path containing shell metacharacters', () => {
    const job = makeJob({
      cwd: '/home/user/proj" ; touch /tmp/pwned ; echo "',
      outputPath: '/home/user/out$(whoami).md',
    });
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.ok(script.includes(`cd '/home/user/proj" ; touch /tmp/pwned ; echo "'`));
    assert.ok(script.includes(`> '/home/user/out$(whoami).md'`));
    assert.ok(!script.includes('touch /tmp/pwned ;\n'));
  });

  test('escapes embedded single quotes in a working directory', () => {
    const job = makeJob({ cwd: "/home/user/O'Brien" });
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.ok(script.includes(`cd '/home/user/O'\\''Brien'; then`));
  });

  test('acquires a lock directory before running and releases it via an EXIT trap', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.match(script, /LOCK_DIR='\/data\/scripts\/job-1\/\.lock'/);
    assert.match(script, /if ! mkdir "\$LOCK_DIR" 2>\/dev\/null; then/);
    assert.match(script, /trap 'rmdir "\$LOCK_DIR" 2>\/dev\/null' EXIT/);
  });

  test('wraps the claude invocation with a timeout watchdog derived from timeoutMinutes', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data', 2);

    assert.match(script, /sleep 120; kill -TERM "\$CLAUDE_PID"/);
    assert.ok(script.includes('kill -KILL "$CLAUDE_PID"'));
  });

  test('writes a status.json with the exit code and touches the runs.touch sentinel', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id);
    const script = buildRunScript(job, paths, '/usr/bin/claude', [], '/data');

    assert.match(script, /> '\/data\/scripts\/job-1\/status\.json'/);
    assert.match(script, /touch '\/data\/runs\.touch' 2>\/dev\/null/);
    assert.match(script, /exit "\$EXIT_CODE"\n$/);
  });

  test('getScriptPaths uses a .ps1 extension on win32 and .sh elsewhere', () => {
    assert.match(getScriptPaths('/data', 'job-1', 'win32').runScript, /run\.ps1$/);
    assert.match(getScriptPaths('/data', 'job-1', 'linux').runScript, /run\.sh$/);
    assert.match(getScriptPaths('/data', 'job-1', 'darwin').runScript, /run\.sh$/);
  });

  test('builds a PowerShell script that cds into the working directory and redirects output', () => {
    const job = makeJob({ cwd: 'C:\\Users\\dev\\project', outputPath: 'C:\\Users\\dev\\project\\output.md' });
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], '/data', 30, 'win32');

    assert.match(script, /^\$ErrorActionPreference = "Stop"\n/);
    assert.ok(script.includes('[Console]::OutputEncoding = [System.Text.Encoding]::UTF8'));
    assert.ok(script.includes("Set-Location -LiteralPath 'C:\\Users\\dev\\project'"));
    assert.ok(
      script.includes(`$prompt = [System.IO.File]::ReadAllText('${paths.promptFile}', [System.Text.Encoding]::UTF8)`),
    );
    assert.ok(
      script.includes(
        `& 'C:\\tools\\claude.exe' -p $promptText 1> 'C:\\Users\\dev\\project\\output.md' 2>> '${paths.errorLog}'`,
      ),
    );
    assert.match(script, /exit \$exitCode\n$/);
  });

  test('PowerShell script prepends additional PATH entries with a semicolon join', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', ['C:\\nvm\\v22'], '/data', 30, 'win32');

    assert.ok(script.includes("$env:Path = 'C:\\nvm\\v22;' + $env:Path"));
  });

  test('PowerShell script escapes embedded single quotes in paths', () => {
    const job = makeJob({ cwd: "C:\\Users\\O'Brien\\project" });
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], '/data', 30, 'win32');

    assert.ok(script.includes("C:\\Users\\O''Brien\\project"));
  });

  test('PowerShell script acquires a lock directory and enforces a Wait-Job timeout', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], '/data', 2, 'win32');

    assert.ok(script.includes(`New-Item -ItemType Directory -Path $lockDir -ErrorAction Stop`));
    assert.ok(script.includes('Wait-Job -Job $job -Timeout 120'));
    assert.ok(script.includes('Stop-Job -Job $job'));
  });

  test('PowerShell script writes status.json and the runs.touch sentinel', () => {
    const job = makeJob();
    const paths = getScriptPaths('/data', job.id, 'win32');
    const script = buildRunScript(job, paths, 'C:\\tools\\claude.exe', [], '/data', 30, 'win32');

    assert.ok(script.includes(`[System.IO.File]::WriteAllText('${paths.statusFile}', $status`));
    assert.ok(script.includes(`[System.IO.File]::WriteAllText('/data/runs.touch', ''`));
  });
});

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { getRunsTouchFile, readRunStatus, RUNS_TOUCH_FILENAME } from '../../src/jobs/runStatus';

suite('runStatus', () => {
  test('getRunsTouchFile joins the data directory with the sentinel filename', () => {
    assert.strictEqual(getRunsTouchFile('/data'), path.join('/data', RUNS_TOUCH_FILENAME));
  });

  test('readRunStatus parses a well-formed status file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-'));
    const statusFile = path.join(dir, 'status.json');
    fs.writeFileSync(statusFile, JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', exitCode: 1 }));

    assert.deepStrictEqual(readRunStatus(statusFile), { timestamp: '2026-01-01T00:00:00Z', exitCode: 1 });
  });

  test('readRunStatus returns undefined when the file is missing', () => {
    assert.strictEqual(readRunStatus('/does/not/exist/status.json'), undefined);
  });

  test('readRunStatus returns undefined for malformed JSON', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-'));
    const statusFile = path.join(dir, 'status.json');
    fs.writeFileSync(statusFile, 'not json');

    assert.strictEqual(readRunStatus(statusFile), undefined);
  });

  test('readRunStatus returns undefined when required fields are missing or mistyped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-status-'));
    const statusFile = path.join(dir, 'status.json');
    fs.writeFileSync(statusFile, JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', exitCode: 'oops' }));

    assert.strictEqual(readRunStatus(statusFile), undefined);
  });
});

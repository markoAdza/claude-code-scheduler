import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { readRunHistory } from '../../src/jobs/runHistory';

suite('runHistory', () => {
  test('readRunHistory parses one JSON object per line, oldest first', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-'));
    const historyFile = path.join(dir, 'history.jsonl');
    fs.writeFileSync(
      historyFile,
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', exitCode: 0 }),
        JSON.stringify({ timestamp: '2026-01-01T00:05:00Z', exitCode: 1 }),
      ].join('\n') + '\n',
    );

    assert.deepStrictEqual(readRunHistory(historyFile), [
      { timestamp: '2026-01-01T00:00:00Z', exitCode: 0 },
      { timestamp: '2026-01-01T00:05:00Z', exitCode: 1 },
    ]);
  });

  test('readRunHistory returns an empty array when the file is missing', () => {
    assert.deepStrictEqual(readRunHistory('/does/not/exist/history.jsonl'), []);
  });

  test('readRunHistory skips malformed or incomplete lines without failing the whole read', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-history-'));
    const historyFile = path.join(dir, 'history.jsonl');
    fs.writeFileSync(
      historyFile,
      [
        JSON.stringify({ timestamp: '2026-01-01T00:00:00Z', exitCode: 0 }),
        'not json',
        JSON.stringify({ timestamp: '2026-01-01T00:05:00Z', exitCode: 'oops' }),
        '',
        JSON.stringify({ timestamp: '2026-01-01T00:10:00Z', exitCode: 2 }),
      ].join('\n') + '\n',
    );

    assert.deepStrictEqual(readRunHistory(historyFile), [
      { timestamp: '2026-01-01T00:00:00Z', exitCode: 0 },
      { timestamp: '2026-01-01T00:10:00Z', exitCode: 2 },
    ]);
  });
});

import * as assert from 'assert';
import { getNextRuns, isValidCronExpression } from '../../src/cron/cronExpression';

suite('cronExpression', () => {
  test('accepts a valid 5-field expression', () => {
    assert.strictEqual(isValidCronExpression('0 7 * * *'), true);
  });

  test('rejects a malformed expression', () => {
    assert.strictEqual(isValidCronExpression('not a cron expression'), false);
  });

  test('computes the requested number of upcoming runs in chronological order', () => {
    const runs = getNextRuns('0 * * * *', 3);
    assert.strictEqual(runs.length, 3);
    assert.ok(runs[0].getTime() < runs[1].getTime());
    assert.ok(runs[1].getTime() < runs[2].getTime());
  });
});

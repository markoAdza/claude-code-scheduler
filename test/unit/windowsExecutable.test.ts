import * as assert from 'assert';
import { pickBestWindowsExecutable } from '../../src/util/windowsExecutable';

suite('pickBestWindowsExecutable', () => {
  test('prefers a sibling .ps1 shim over a .cmd match, to avoid cmd.exe re-parsing the prompt', () => {
    const exists = (candidatePath: string) => candidatePath === 'C:\\npm\\claude.ps1';
    const result = pickBestWindowsExecutable(['C:\\npm\\claude.cmd'], exists);
    assert.strictEqual(result, 'C:\\npm\\claude.ps1');
  });

  test('falls back to the .cmd match when no sibling .ps1 exists', () => {
    const result = pickBestWindowsExecutable(['C:\\npm\\claude.cmd'], () => false);
    assert.strictEqual(result, 'C:\\npm\\claude.cmd');
  });

  test('leaves a plain .exe match untouched', () => {
    const result = pickBestWindowsExecutable(['C:\\tools\\claude.exe'], () => false);
    assert.strictEqual(result, 'C:\\tools\\claude.exe');
  });

  test('returns undefined for an empty candidate list', () => {
    assert.strictEqual(pickBestWindowsExecutable([], () => false), undefined);
  });
});

import * as assert from 'assert';
import { getInstallCommand } from '../../src/util/installClaudeCli';

suite('installClaudeCli', () => {
  test('uses the native curl installer on Linux and macOS', () => {
    assert.strictEqual(getInstallCommand('linux'), 'curl -fsSL https://claude.ai/install.sh | bash');
    assert.strictEqual(getInstallCommand('darwin'), 'curl -fsSL https://claude.ai/install.sh | bash');
  });

  test('uses the native PowerShell installer on Windows', () => {
    assert.strictEqual(getInstallCommand('win32'), 'irm https://claude.ai/install.ps1 | iex');
  });
});

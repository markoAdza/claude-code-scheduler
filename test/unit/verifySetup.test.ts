import * as assert from 'assert';
import { buildVerifySetupCommands } from '../../src/util/verifySetup';

suite('verifySetup', () => {
  test('cds into the working directory then runs the same invocation the scheduled job uses', () => {
    const commands = buildVerifySetupCommands('/home/user/project', '/usr/bin/claude');

    assert.deepStrictEqual(commands, ['cd "/home/user/project"', '"/usr/bin/claude" -p "Reply with just: OK"']);
  });

  test('escapes embedded double quotes in the working directory and executable path', () => {
    const commands = buildVerifySetupCommands('/home/user/"weird" project', 'C:\\Program Files\\claude.exe');

    assert.strictEqual(commands[0], 'cd "/home/user/\\"weird\\" project"');
    assert.strictEqual(commands[1], '"C:\\Program Files\\claude.exe" -p "Reply with just: OK"');
  });
});

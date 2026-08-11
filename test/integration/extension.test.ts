import * as assert from 'assert';
import * as vscode from 'vscode';

const EXPECTED_COMMANDS = [
  'claudeCodeScheduler.addJob',
  'claudeCodeScheduler.editJob',
  'claudeCodeScheduler.deleteJob',
  'claudeCodeScheduler.toggleJob',
  'claudeCodeScheduler.runJobNow',
  'claudeCodeScheduler.viewOutput',
  'claudeCodeScheduler.openPromptFile',
  'claudeCodeScheduler.redetectClaudeCli',
  'claudeCodeScheduler.resyncCrontab',
];

suite('Extension activation', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.all.find((ext) =>
      ext.id.endsWith('.claude-code-scheduler'),
    );
    await extension?.activate();
  });

  test('registers all Claude Code Scheduler commands', async () => {
    const commands = await vscode.commands.getCommands(true);
    for (const command of EXPECTED_COMMANDS) {
      assert.ok(commands.includes(command), `Expected command ${command} to be registered`);
    }
  });
});

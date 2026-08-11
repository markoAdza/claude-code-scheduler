import * as vscode from 'vscode';
import { getNextRuns, isValidCronExpression } from '../cron/cronExpression';
import { ClaudeJob, ClaudeJobInput } from '../jobs/job';

interface WebviewMessage {
  type: string;
  [key: string]: unknown;
}

export class JobFormPanel {
  private static currentPanel: JobFormPanel | undefined;

  private readonly panel: vscode.WebviewPanel;
  private readonly disposables: vscode.Disposable[] = [];

  private constructor(
    private readonly existingJob: ClaudeJob | undefined,
    private readonly onSubmit: (input: ClaudeJobInput) => Promise<void>,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'claudeCodeSchedulerJobForm',
      existingJob ? `Edit Job: ${existingJob.name}` : 'New Claude Code Job',
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true },
    );
    this.panel.webview.html = this.getHtml();
    this.panel.webview.onDidReceiveMessage(
      (message: WebviewMessage) => this.handleMessage(message),
      null,
      this.disposables,
    );
    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  static show(
    existingJob: ClaudeJob | undefined,
    onSubmit: (input: ClaudeJobInput) => Promise<void>,
  ): void {
    JobFormPanel.currentPanel?.dispose();
    JobFormPanel.currentPanel = new JobFormPanel(existingJob, onSubmit);
  }

  private async handleMessage(message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'pickFolder':
        await this.handlePickFolder();
        return;
      case 'pickOutputFile':
        await this.handlePickOutputFile(typeof message.currentPath === 'string' ? message.currentPath : '');
        return;
      case 'validateSchedule':
        this.handleValidateSchedule(String(message.expression ?? ''));
        return;
      case 'submit':
        await this.handleSubmit(message.payload as ClaudeJobInput);
        return;
      case 'cancel':
        this.dispose();
        return;
      default:
        return;
    }
  }

  private async handlePickFolder(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: vscode.workspace.workspaceFolders?.[0]?.uri,
      openLabel: 'Select Working Directory',
    });
    if (uris?.[0]) {
      void this.panel.webview.postMessage({ type: 'folderPicked', path: uris[0].fsPath });
    }
  }

  private async handlePickOutputFile(currentPath: string): Promise<void> {
    const uri = await vscode.window.showSaveDialog({
      defaultUri: currentPath ? vscode.Uri.file(currentPath) : undefined,
      filters: { Markdown: ['md'], Text: ['txt'], 'All Files': ['*'] },
      saveLabel: 'Select Output File',
    });
    if (uri) {
      void this.panel.webview.postMessage({ type: 'outputFilePicked', path: uri.fsPath });
    }
  }

  private handleValidateSchedule(expression: string): void {
    const valid = isValidCronExpression(expression);
    const preview = valid ? getNextRuns(expression, 3).map((date) => date.toLocaleString()) : [];
    void this.panel.webview.postMessage({ type: 'scheduleValidated', valid, preview });
  }

  private async handleSubmit(payload: ClaudeJobInput): Promise<void> {
    try {
      await this.onSubmit(payload);
      this.dispose();
    } catch (error) {
      void this.panel.webview.postMessage({
        type: 'submitError',
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private dispose(): void {
    if (JobFormPanel.currentPanel === this) {
      JobFormPanel.currentPanel = undefined;
    }
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }

  private getHtml(): string {
    const nonce = getNonce();
    const job = this.existingJob;
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const initialPreset: string = job ? 'custom' : 'daily';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Claude Code Job</title>
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 16px; }
  label { display: block; margin-top: 12px; font-weight: 600; }
  input[type=text], textarea, select {
    width: 100%; box-sizing: border-box; margin-top: 4px;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border); padding: 6px; border-radius: 2px;
  }
  textarea { min-height: 120px; font-family: var(--vscode-editor-font-family); resize: vertical; }
  .row { display: flex; gap: 8px; align-items: center; }
  .row input[type=text] { flex: 1; }
  .checkbox-row { display: flex; align-items: center; gap: 6px; margin-top: 12px; font-weight: 600; }
  .checkbox-row input { width: auto; margin: 0; }
  #presetFields { margin-top: 8px; }
  #presetFields label { display: inline-block; margin-top: 0; margin-right: 12px; font-weight: normal; }
  #presetFields input { width: 60px; display: inline-block; margin-top: 0; margin-left: 4px; }
  button {
    margin-top: 20px; margin-right: 8px; padding: 6px 14px; border-radius: 2px; border: none;
    cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground);
  }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  #preview, #error { margin-top: 8px; font-size: 12px; }
  #error { color: var(--vscode-errorForeground); }
  #preview { color: var(--vscode-descriptionForeground); }
</style>
</head>
<body>
  <label for="name">Name</label>
  <input type="text" id="name" value="${escapeHtml(job?.name ?? '')}" placeholder="e.g. Daily standup summary" />

  <label for="prompt">Prompt</label>
  <textarea id="prompt" placeholder="The prompt passed to: claude -p &quot;...&quot;">${escapeHtml(job?.prompt ?? '')}</textarea>

  <label for="cwd">Working directory</label>
  <div class="row">
    <input type="text" id="cwd" value="${escapeHtml(job?.cwd ?? '')}" placeholder="/home/you/project" />
    <button type="button" class="secondary" id="pickFolder">Browse…</button>
  </div>

  <label for="schedulePreset">Schedule</label>
  <select id="schedulePreset">
    <option value="daily" ${initialPreset === 'daily' ? 'selected' : ''}>Every day at HH:MM</option>
    <option value="weekdays" ${initialPreset === 'weekdays' ? 'selected' : ''}>Weekdays at HH:MM</option>
    <option value="hourly" ${initialPreset === 'hourly' ? 'selected' : ''}>Every hour</option>
    <option value="every-n-minutes" ${initialPreset === 'every-n-minutes' ? 'selected' : ''}>Every N minutes</option>
    <option value="custom" ${initialPreset === 'custom' ? 'selected' : ''}>Custom cron expression</option>
  </select>
  <div id="presetFields"></div>
  <input type="text" id="schedule" value="${escapeHtml(job?.schedule ?? '0 7 * * *')}" />
  <div id="preview"></div>

  <label for="outputPath">Output file</label>
  <div class="row">
    <input type="text" id="outputPath" value="${escapeHtml(job?.outputPath ?? '')}" placeholder="/home/you/project/output.md" />
    <button type="button" class="secondary" id="pickOutputFile">Browse…</button>
  </div>

  <div class="checkbox-row">
    <input type="checkbox" id="enabled" ${job?.enabled !== false ? 'checked' : ''} />
    <label for="enabled" style="margin:0;font-weight:normal;">Enabled (adds/keeps this job's crontab entry)</label>
  </div>

  <div id="error"></div>
  <button type="button" id="save">Save</button>
  <button type="button" class="secondary" id="cancel">Cancel</button>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const presetSelect = document.getElementById('schedulePreset');
      const presetFields = document.getElementById('presetFields');
      const scheduleInput = document.getElementById('schedule');
      const preview = document.getElementById('preview');
      const errorBox = document.getElementById('error');

      function computeSchedule() {
        const preset = presetSelect.value;
        if (preset === 'hourly') {
          scheduleInput.value = '0 * * * *';
        } else if (preset === 'every-n-minutes') {
          const minutes = document.getElementById('minutesInput')?.value || '15';
          scheduleInput.value = '*/' + minutes + ' * * * *';
        } else if (preset === 'daily' || preset === 'weekdays') {
          const hour = document.getElementById('hourInput')?.value || '0';
          const minute = document.getElementById('minuteInput')?.value || '0';
          scheduleInput.value = minute + ' ' + hour + ' * * ' + (preset === 'weekdays' ? '1-5' : '*');
        }
        validateSchedule();
      }

      function renderPresetFields() {
        const preset = presetSelect.value;
        presetFields.innerHTML = '';
        scheduleInput.readOnly = preset !== 'custom';
        if (preset === 'every-n-minutes') {
          presetFields.innerHTML = '<label>Every <input type="text" id="minutesInput" value="15" /> minutes</label>';
        } else if (preset === 'daily' || preset === 'weekdays') {
          presetFields.innerHTML =
            '<label>Hour (0-23) <input type="text" id="hourInput" value="7" /></label>' +
            '<label>Minute (0-59) <input type="text" id="minuteInput" value="0" /></label>';
        }
        presetFields.querySelectorAll('input').forEach(function (input) {
          input.addEventListener('input', computeSchedule);
        });
        if (preset !== 'custom') {
          computeSchedule();
        } else {
          validateSchedule();
        }
      }

      let validateTimer;
      function validateSchedule() {
        clearTimeout(validateTimer);
        validateTimer = setTimeout(function () {
          vscode.postMessage({ type: 'validateSchedule', expression: scheduleInput.value });
        }, 200);
      }

      presetSelect.addEventListener('change', renderPresetFields);
      scheduleInput.addEventListener('input', function () {
        if (presetSelect.value === 'custom') {
          validateSchedule();
        }
      });

      document.getElementById('pickFolder').addEventListener('click', function () {
        vscode.postMessage({ type: 'pickFolder' });
      });
      document.getElementById('pickOutputFile').addEventListener('click', function () {
        vscode.postMessage({ type: 'pickOutputFile', currentPath: document.getElementById('outputPath').value });
      });

      document.getElementById('save').addEventListener('click', function () {
        errorBox.textContent = '';
        const payload = {
          name: document.getElementById('name').value.trim(),
          prompt: document.getElementById('prompt').value,
          cwd: document.getElementById('cwd').value.trim(),
          schedule: scheduleInput.value.trim(),
          outputPath: document.getElementById('outputPath').value.trim(),
          enabled: document.getElementById('enabled').checked,
        };
        if (!payload.name || !payload.prompt || !payload.cwd || !payload.schedule || !payload.outputPath) {
          errorBox.textContent = 'All fields are required.';
          return;
        }
        vscode.postMessage({ type: 'submit', payload: payload });
      });

      document.getElementById('cancel').addEventListener('click', function () {
        vscode.postMessage({ type: 'cancel' });
      });

      window.addEventListener('message', function (event) {
        const message = event.data;
        if (message.type === 'folderPicked') {
          document.getElementById('cwd').value = message.path;
        } else if (message.type === 'outputFilePicked') {
          document.getElementById('outputPath').value = message.path;
        } else if (message.type === 'scheduleValidated') {
          preview.textContent = message.valid ? ('Next runs: ' + message.preview.join(', ')) : 'Invalid cron expression';
        } else if (message.type === 'submitError') {
          errorBox.textContent = message.message;
        }
      });

      renderPresetFields();
    })();
  </script>
</body>
</html>`;
  }
}

function getNonce(): string {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

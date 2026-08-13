import * as os from 'os';
import * as path from 'path';
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
    private readonly schedulerDisplayName: string,
    private readonly resolveClaudeExecutable: () => Promise<string | undefined>,
    private readonly template: ClaudeJobInput | undefined,
  ) {
    this.panel = vscode.window.createWebviewPanel(
      'claudeCodeSchedulerJobForm',
      existingJob
        ? `Edit Job: ${existingJob.name}`
        : template
          ? `Duplicate Job: ${template.name}`
          : 'New Claude Code Job',
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
    void this.refreshCliStatus();
  }

  /**
   * `template` prefills the form with another job's values (for the "Duplicate" action) while
   * still creating a brand-new job on submit — it's ignored whenever `existingJob` is set, since
   * editing always takes precedence over prefill data.
   */
  static show(
    existingJob: ClaudeJob | undefined,
    onSubmit: (input: ClaudeJobInput) => Promise<void>,
    schedulerDisplayName: string,
    resolveClaudeExecutable: () => Promise<string | undefined>,
    template?: ClaudeJobInput,
  ): void {
    JobFormPanel.currentPanel?.dispose();
    JobFormPanel.currentPanel = new JobFormPanel(existingJob, onSubmit, schedulerDisplayName, resolveClaudeExecutable, template);
  }

  /** Called after the extension re-detects the `claude` CLI (e.g. once an install/re-detect
   * terminal it opened on this panel's behalf closes), so the open form's banner updates without
   * the user having to close and reopen it. A no-op if no form is currently open. */
  static async refreshCurrentCliStatus(): Promise<void> {
    await JobFormPanel.currentPanel?.refreshCliStatus();
  }

  private async refreshCliStatus(): Promise<void> {
    const claudeExecutablePath = await this.resolveClaudeExecutable();
    void this.panel.webview.postMessage({ type: 'claudeCliStatus', available: Boolean(claudeExecutablePath) });
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
      case 'installClaudeCli':
        await vscode.commands.executeCommand('claudeCodeScheduler.installClaudeCli');
        return;
      case 'verifySetup':
        await vscode.commands.executeCommand(
          'claudeCodeScheduler.verifySetup',
          typeof message.cwd === 'string' ? message.cwd : '',
        );
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
    let preview: string[] = [];
    // The gap between the first two upcoming runs, in minutes — used by the webview to flag very
    // frequent schedules (e.g. "every 1 minute") that could rack up costs against a paid API
    // without the user really meaning to. Derived from actual run dates rather than parsing the
    // preset/cron text so it also catches a hand-written custom expression.
    let minIntervalMinutes: number | undefined;
    if (valid) {
      const nextRuns = getNextRuns(expression, 3);
      preview = nextRuns.map((date) => date.toLocaleString());
      if (nextRuns.length >= 2) {
        minIntervalMinutes = (nextRuns[1].getTime() - nextRuns[0].getTime()) / 60000;
      }
    }
    void this.panel.webview.postMessage({ type: 'scheduleValidated', valid, preview, minIntervalMinutes });
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
    // Prefills the form from whichever source applies: the job being edited, the job being
    // duplicated, or (for a brand-new job) nothing.
    const values: ClaudeJob | ClaudeJobInput | undefined = job ?? this.template;
    const csp = [
      "default-src 'none'",
      `style-src ${this.panel.webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const initialPreset: string = values ? 'custom' : 'daily';
    const isWindows = process.platform === 'win32';
    const cwdPlaceholder = path.join(os.homedir(), 'project');
    const outputPlaceholder = path.join(os.homedir(), 'project', 'output.md');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<title>Claude Code Job</title>
<style>
  * { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    color: var(--vscode-foreground);
    padding: 20px 24px 32px;
    max-width: 720px;
  }
  h1 { font-size: 15px; font-weight: 600; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); font-size: 12px; margin: 0 0 20px; }
  .card {
    background: var(--vscode-editorWidget-background);
    border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
    border-radius: 6px;
    padding: 16px 18px;
    margin-top: 14px;
  }
  .card h2 {
    margin: 0 0 14px;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--vscode-descriptionForeground);
  }
  .field { margin-top: 12px; }
  .field:first-child { margin-top: 0; }
  label { display: block; font-weight: 600; font-size: 12px; margin-bottom: 4px; }
  input[type=text], textarea, select {
    width: 100%; box-sizing: border-box;
    background: var(--vscode-input-background); color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, transparent); padding: 6px 8px; border-radius: 3px;
    font-family: inherit; font-size: 13px;
  }
  input[type=text]:focus, textarea:focus, select:focus {
    outline: 1px solid var(--vscode-focusBorder); outline-offset: -1px;
  }
  input[readonly] { opacity: 0.75; cursor: default; }
  textarea { min-height: 110px; font-family: var(--vscode-editor-font-family); resize: vertical; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .callout code { background: var(--vscode-textCodeBlock-background); padding: 1px 4px; border-radius: 3px; }
  .row input[type=text] { flex: 1; }
  .field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; align-items: start; }
  @media (max-width: 560px) { .field-grid { grid-template-columns: 1fr; } }
  .hint { font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 5px; }
  #presetFields { margin-top: 10px; display: flex; gap: 16px; flex-wrap: wrap; }
  #presetFields label { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-weight: normal; font-size: 12px; white-space: nowrap; }
  #presetFields input { width: 64px; margin: 0; }
  .summary { margin-top: 12px; font-size: 12px; padding: 8px 10px; border-radius: 4px; background: var(--vscode-textBlockQuote-background); border-left: 3px solid var(--vscode-textLink-foreground); }
  .summary .runs { color: var(--vscode-descriptionForeground); margin-top: 3px; }
  .callout { margin-top: 12px; font-size: 12px; padding: 8px 10px; border-radius: 4px; border: 1px solid; }
  .callout.warning {
    background: var(--vscode-inputValidation-warningBackground);
    border-color: var(--vscode-inputValidation-warningBorder);
    color: var(--vscode-inputValidation-warningForeground);
  }
  .callout.error {
    background: var(--vscode-inputValidation-errorBackground);
    border-color: var(--vscode-inputValidation-errorBorder);
    color: var(--vscode-inputValidation-errorForeground);
  }
  .checkbox-row { display: flex; align-items: center; gap: 6px; margin-top: 4px; font-weight: 600; }
  .checkbox-row input { width: auto; margin: 0; }
  .footer { display: flex; align-items: center; justify-content: space-between; margin-top: 20px; flex-wrap: wrap; gap: 10px; }
  .backend-badge { font-size: 11px; color: var(--vscode-descriptionForeground); }
  .backend-badge .pill {
    display: inline-block; padding: 1px 8px; border-radius: 999px; margin-right: 6px;
    background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); font-weight: 600;
  }
  .actions { display: flex; gap: 8px; }
  button {
    padding: 6px 16px; border-radius: 3px; border: none;
    cursor: pointer; background: var(--vscode-button-background); color: var(--vscode-button-foreground); font-size: 13px;
  }
  button:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.secondary:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
</style>
</head>
<body>
  <h1>${
    job
      ? `Edit "${escapeHtml(job.name)}"`
      : this.template
        ? `Duplicate "${escapeHtml(this.template.name)}"`
        : 'New Claude Code Job'
  }</h1>
  <p class="subtitle">Schedule a recurring Claude Code CLI prompt.</p>

  <div id="cliWarning" class="callout warning" style="display:none;">
    The <code>claude</code> CLI wasn't found.
    <button type="button" class="secondary" id="installCli">Install Claude CLI</button>
  </div>

  <div class="field">
    <label for="name">Name</label>
    <input type="text" id="name" value="${escapeHtml(values?.name ?? '')}" placeholder="e.g. Daily standup summary" />
  </div>

  <div class="card">
    <h2>Prompt</h2>
    <div class="field">
      <textarea id="prompt" placeholder="The prompt passed to: claude -p &quot;...&quot;">${escapeHtml(values?.prompt ?? '')}</textarea>
    </div>
  </div>

  <div class="card">
    <h2>Working directory &amp; output</h2>
    <div class="field-grid">
      <div class="field">
        <label for="cwd">Working directory</label>
        <div class="row">
          <input type="text" id="cwd" value="${escapeHtml(values?.cwd ?? '')}" placeholder="${escapeHtml(cwdPlaceholder)}" />
          <button type="button" class="secondary" id="pickFolder">Browse…</button>
          <button type="button" class="secondary" id="verifySetup">Verify Setup</button>
        </div>
        <div class="hint">
          Opens a terminal that checks the CLI and, if this folder hasn't been trusted by Claude Code
          before, lets you accept its trust prompt — a scheduled run can't answer that prompt itself.
        </div>
      </div>
      <div class="field">
        <label for="outputPath">Output file</label>
        <div class="row">
          <input type="text" id="outputPath" value="${escapeHtml(values?.outputPath ?? '')}" placeholder="${escapeHtml(outputPlaceholder)}" />
          <button type="button" class="secondary" id="pickOutputFile">Browse…</button>
        </div>
      </div>
    </div>
  </div>

  <div class="card">
    <h2>Schedule</h2>
    <div class="field">
      <label for="schedulePreset">Runs</label>
      <select id="schedulePreset">
        <option value="daily" ${initialPreset === 'daily' ? 'selected' : ''}>Every day at HH:MM</option>
        <option value="weekdays" ${initialPreset === 'weekdays' ? 'selected' : ''}>Weekdays at HH:MM</option>
        <option value="hourly" ${initialPreset === 'hourly' ? 'selected' : ''}>Every hour</option>
        <option value="every-n-minutes" ${initialPreset === 'every-n-minutes' ? 'selected' : ''}>Every N minutes</option>
        <option value="custom" ${initialPreset === 'custom' ? 'selected' : ''}>Custom cron expression</option>
      </select>
      <div id="presetFields"></div>
    </div>
    <div class="field">
      <label for="schedule">Cron expression</label>
      <input type="text" id="schedule" value="${escapeHtml(values?.schedule ?? '0 7 * * *')}" />
    </div>
    <div id="summary" class="summary" style="display:none;">
      <div id="summaryText"></div>
      <div id="summaryRuns" class="runs"></div>
    </div>
    <div id="frequencyWarning" class="callout warning" style="display:none;"></div>
    <div id="scheduleError" class="callout error" style="display:none;"></div>
    <div id="windowsWarning" class="callout warning" style="display:none;">
      Custom cron expressions aren't supported by ${escapeHtml(this.schedulerDisplayName)}. Choose one of the
      presets above, or this job won't run.
    </div>
  </div>

  <div class="checkbox-row">
    <input type="checkbox" id="enabled" ${values?.enabled !== false ? 'checked' : ''} />
    <label for="enabled" style="margin:0;font-weight:normal;">Enabled (keeps this job scheduled)</label>
  </div>

  <div id="error" class="callout error" style="display:none;"></div>

  <div class="footer">
    <div class="backend-badge"><span class="pill">${escapeHtml(this.schedulerDisplayName)}</span>runs this job on schedule, even when VS Code is closed.</div>
    <div class="actions">
      <button type="button" class="secondary" id="cancel">Cancel</button>
      <button type="button" id="save" disabled>Save</button>
    </div>
  </div>

  <script nonce="${nonce}">
    (function () {
      const vscode = acquireVsCodeApi();
      const IS_WINDOWS = ${isWindows ? 'true' : 'false'};
      const presetSelect = document.getElementById('schedulePreset');
      const presetFields = document.getElementById('presetFields');
      const scheduleInput = document.getElementById('schedule');
      const summary = document.getElementById('summary');
      const summaryText = document.getElementById('summaryText');
      const summaryRuns = document.getElementById('summaryRuns');
      const frequencyWarning = document.getElementById('frequencyWarning');
      const scheduleError = document.getElementById('scheduleError');
      const windowsWarning = document.getElementById('windowsWarning');
      const errorBox = document.getElementById('error');
      const saveButton = document.getElementById('save');
      const cliWarning = document.getElementById('cliWarning');

      // Below this, a schedule is flagged as "very frequent" — a soft warning only, since a tight
      // interval is sometimes exactly what's wanted. It never blocks Save.
      const FREQUENT_SCHEDULE_THRESHOLD_MINUTES = 5;

      let scheduleValid = false;

      function pad2(n) { return String(n).padStart(2, '0'); }

      // Reverse-engineers which preset (if any) an existing raw cron expression matches, so
      // editing a job shows its actual preset/values instead of always falling back to "custom"
      // (which, on Windows, would incorrectly flag an already-supported schedule as unsupported).
      function detectPreset(cron) {
        const parts = String(cron).trim().split(/\\s+/);
        if (parts.length !== 5) { return { preset: 'custom' }; }
        const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
        if (dayOfMonth !== '*' || month !== '*') { return { preset: 'custom' }; }
        if (dayOfWeek !== '*') {
          if (/^\\d+$/.test(minute) && /^\\d+$/.test(hour) && dayOfWeek === '1-5') {
            return { preset: 'weekdays', hour: hour, minute: minute };
          }
          return { preset: 'custom' };
        }
        const stepMatch = /^\\*\\/(\\d+)$/.exec(minute);
        if (stepMatch && hour === '*') {
          return { preset: 'every-n-minutes', minutes: stepMatch[1] };
        }
        if (/^\\d+$/.test(minute) && hour === '*') {
          return { preset: 'hourly', minute: minute };
        }
        if (/^\\d+$/.test(minute) && /^\\d+$/.test(hour)) {
          return { preset: 'daily', hour: hour, minute: minute };
        }
        return { preset: 'custom' };
      }

      const detected = detectPreset(scheduleInput.value);
      presetSelect.value = detected.preset;

      function describeSchedule(preset) {
        if (preset === 'daily' || preset === 'weekdays') {
          const hour = document.getElementById('hourInput')?.value || '0';
          const minute = document.getElementById('minuteInput')?.value || '0';
          const time = pad2(hour) + ':' + pad2(minute);
          return preset === 'daily' ? 'Runs every day at ' + time + '.' : 'Runs weekdays (Mon–Fri) at ' + time + '.';
        }
        if (preset === 'hourly') {
          const minute = document.getElementById('hourlyMinuteInput')?.value || '0';
          return minute === '0' ? 'Runs once every hour, on the hour.' : 'Runs once every hour, at :' + pad2(minute) + '.';
        }
        if (preset === 'every-n-minutes') {
          const minutes = document.getElementById('minutesInput')?.value || '15';
          return 'Runs every ' + minutes + ' minute(s).';
        }
        return 'Custom schedule: ' + scheduleInput.value;
      }

      function computeSchedule() {
        const preset = presetSelect.value;
        if (preset === 'hourly') {
          const minute = document.getElementById('hourlyMinuteInput')?.value || '0';
          scheduleInput.value = minute + ' * * * *';
        } else if (preset === 'every-n-minutes') {
          const minutes = document.getElementById('minutesInput')?.value || '15';
          scheduleInput.value = '*/' + minutes + ' * * * *';
        } else if (preset === 'daily' || preset === 'weekdays') {
          const hour = document.getElementById('hourInput')?.value || '0';
          const minute = document.getElementById('minuteInput')?.value || '0';
          scheduleInput.value = minute + ' ' + hour + ' * * ' + (preset === 'weekdays' ? '1-5' : '*');
        }
        updateWindowsWarning();
        validateSchedule();
      }

      function updateWindowsWarning() {
        const unsupported = IS_WINDOWS && presetSelect.value === 'custom';
        windowsWarning.style.display = unsupported ? 'block' : 'none';
        updateSaveState();
      }

      function renderPresetFields() {
        const preset = presetSelect.value;
        presetFields.innerHTML = '';
        scheduleInput.readOnly = preset !== 'custom';
        if (preset === 'every-n-minutes') {
          const minutes = (detected.preset === 'every-n-minutes' && detected.minutes) || '15';
          presetFields.innerHTML = '<label>Every <input type="text" id="minutesInput" value="' + minutes + '" /> minutes</label>';
        } else if (preset === 'hourly') {
          const minute = (detected.preset === 'hourly' && detected.minute) || '0';
          presetFields.innerHTML = '<label>Minute (0–59) <input type="text" id="hourlyMinuteInput" value="' + minute + '" /></label>';
        } else if (preset === 'daily' || preset === 'weekdays') {
          const hour = ((detected.preset === 'daily' || detected.preset === 'weekdays') && detected.hour) || '7';
          const minute = ((detected.preset === 'daily' || detected.preset === 'weekdays') && detected.minute) || '0';
          presetFields.innerHTML =
            '<label>Hour (0–23) <input type="text" id="hourInput" value="' + hour + '" /></label>' +
            '<label>Minute (0–59) <input type="text" id="minuteInput" value="' + minute + '" /></label>';
        }
        presetFields.querySelectorAll('input').forEach(function (input) {
          input.addEventListener('input', computeSchedule);
        });
        if (preset !== 'custom') {
          computeSchedule();
        } else {
          updateWindowsWarning();
          validateSchedule();
        }
      }

      function updateFrequencyWarning(minIntervalMinutes) {
        if (typeof minIntervalMinutes !== 'number' || minIntervalMinutes >= FREQUENT_SCHEDULE_THRESHOLD_MINUTES) {
          frequencyWarning.style.display = 'none';
          return;
        }
        const rounded = Math.max(1, Math.round(minIntervalMinutes));
        const perHour = Math.round(60 / rounded);
        frequencyWarning.style.display = 'block';
        frequencyWarning.textContent =
          'This schedule runs about every ' + rounded + ' minute(s) (~' + perHour + 'x per hour). ' +
          'If this job calls a paid API, frequent runs can get expensive fast — make sure that is intended.';
      }

      let validateTimer;
      function validateSchedule() {
        clearTimeout(validateTimer);
        validateTimer = setTimeout(function () {
          vscode.postMessage({ type: 'validateSchedule', expression: scheduleInput.value });
        }, 150);
      }

      function updateSaveState() {
        const requiredFilled =
          document.getElementById('name').value.trim() &&
          document.getElementById('prompt').value.trim() &&
          document.getElementById('cwd').value.trim() &&
          document.getElementById('outputPath').value.trim();
        const windowsBlocked = IS_WINDOWS && presetSelect.value === 'custom';
        saveButton.disabled = !requiredFilled || !scheduleValid || windowsBlocked;
      }

      presetSelect.addEventListener('change', renderPresetFields);
      scheduleInput.addEventListener('input', function () {
        if (presetSelect.value === 'custom') {
          validateSchedule();
        }
      });

      ['name', 'prompt', 'cwd', 'outputPath'].forEach(function (id) {
        document.getElementById(id).addEventListener('input', updateSaveState);
      });

      document.getElementById('pickFolder').addEventListener('click', function () {
        vscode.postMessage({ type: 'pickFolder' });
      });
      document.getElementById('installCli').addEventListener('click', function () {
        vscode.postMessage({ type: 'installClaudeCli' });
      });
      document.getElementById('verifySetup').addEventListener('click', function () {
        vscode.postMessage({ type: 'verifySetup', cwd: document.getElementById('cwd').value.trim() });
      });
      document.getElementById('pickOutputFile').addEventListener('click', function () {
        vscode.postMessage({ type: 'pickOutputFile', currentPath: document.getElementById('outputPath').value });
      });

      document.getElementById('save').addEventListener('click', function () {
        errorBox.style.display = 'none';
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
          errorBox.style.display = 'block';
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
          updateSaveState();
        } else if (message.type === 'outputFilePicked') {
          document.getElementById('outputPath').value = message.path;
          updateSaveState();
        } else if (message.type === 'scheduleValidated') {
          scheduleValid = message.valid;
          scheduleError.style.display = message.valid ? 'none' : 'block';
          if (!message.valid) {
            scheduleError.textContent = 'Invalid cron expression.';
            summary.style.display = 'none';
            frequencyWarning.style.display = 'none';
          } else {
            summary.style.display = 'block';
            summaryText.textContent = describeSchedule(presetSelect.value);
            summaryRuns.textContent = 'Next runs: ' + message.preview.join(', ');
            updateFrequencyWarning(message.minIntervalMinutes);
          }
          updateSaveState();
        } else if (message.type === 'submitError') {
          errorBox.textContent = message.message;
          errorBox.style.display = 'block';
        } else if (message.type === 'claudeCliStatus') {
          cliWarning.style.display = message.available ? 'none' : 'block';
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

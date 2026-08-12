export interface ClaudeJob {
  id: string;
  name: string;
  prompt: string;
  cwd: string;
  schedule: string;
  outputPath: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ClaudeJobInput = Pick<
  ClaudeJob,
  'name' | 'prompt' | 'cwd' | 'schedule' | 'outputPath' | 'enabled'
>;

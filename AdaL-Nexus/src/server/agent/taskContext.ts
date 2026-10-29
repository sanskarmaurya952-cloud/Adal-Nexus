/**
 * Manages conversational and task execution context across turns,
 * preserving recent research topics, generated output files, and draft states.
 */
export class TaskContextManager {
  private static instance: TaskContextManager;
  private lastTopic: string | null = null;
  private lastDraftId: string | null = null;
  private lastOutputFile: string | null = null;

  static getInstance(): TaskContextManager {
    if (!TaskContextManager.instance) {
      TaskContextManager.instance = new TaskContextManager();
    }
    return TaskContextManager.instance;
  }

  setLastTopic(topic: string): void {
    if (topic && topic.trim()) {
      this.lastTopic = topic.trim();
    }
  }

  getLastTopic(): string | null {
    return this.lastTopic;
  }

  setLastDraftId(draftId: string): void {
    this.lastDraftId = draftId;
  }

  getLastDraftId(): string | null {
    return this.lastDraftId;
  }

  setLastOutputFile(filePath: string): void {
    this.lastOutputFile = filePath;
  }

  getLastOutputFile(): string | null {
    return this.lastOutputFile;
  }

  clear(): void {
    this.lastTopic = null;
    this.lastDraftId = null;
    this.lastOutputFile = null;
  }
}

export const taskContext = TaskContextManager.getInstance();

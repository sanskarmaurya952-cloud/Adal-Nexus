import type { Tool } from "./types.js";

/** Only tools registered here exist. Nothing else may be claimed or executed. */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) throw new Error(`tool "${tool.name}" is already registered`);
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): { name: string; description: string; sensitive: boolean }[] {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      sensitive: !!t.sensitive,
    }));
  }
}

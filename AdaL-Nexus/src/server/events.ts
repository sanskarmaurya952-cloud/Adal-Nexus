import type { Response } from "express";

export interface LogEvent {
  type: string;
  message: string;
  time: string;
}

const clients = new Set<Response>();

export function addClient(res: Response): void {
  clients.add(res);
  res.on("close", () => clients.delete(res));
}

/** Send any JSON-serialisable event to every connected SSE client. */
export function broadcast(event: unknown): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const c of clients) c.write(payload);
}

export function emit(type: string, message: string): void {
  const event: LogEvent = { type, message, time: new Date().toISOString() };
  broadcast(event);
}

export function clientCount(): number {
  return clients.size;
}

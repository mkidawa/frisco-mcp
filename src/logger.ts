import { promises as fs } from "fs";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";

type LogLevel = "info" | "error";

interface LogEntry {
  sessionId: string;
  seq: number;
  timestamp: string;
  level: LogLevel;
  event: string;
  data?: unknown;
}

const DATA_DIR = join(homedir(), ".frisco-mcp");
const LOG_DIR = join(DATA_DIR, "logs");

let initialized = false;
let seq = 0;
let sessionId = "";
let sessionLogPath = "";
let writeQueue: Promise<void> = Promise.resolve();

function buildSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

async function enqueueWrite(line: string): Promise<void> {
  writeQueue = writeQueue
    .catch(() => undefined)
    .then(async () => {
    await fs.mkdir(LOG_DIR, { recursive: true });
    await fs.appendFile(sessionLogPath, line, "utf-8");
    });
  await writeQueue;
}

export async function initLogger(): Promise<void> {
  if (initialized) return;
  sessionId = buildSessionId();
  sessionLogPath = join(LOG_DIR, `${sessionId}.jsonl`);
  await fs.mkdir(LOG_DIR, { recursive: true });
  await fs.writeFile(
    join(DATA_DIR, "current-session.json"),
    JSON.stringify(
      {
        sessionId,
        sessionLogPath,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf-8",
  );
  initialized = true;
  await logEvent("session_started", { sessionLogPath });
}

export function getCurrentSessionId(): string {
  return sessionId;
}

export function getCurrentSessionLogPath(): string {
  return sessionLogPath;
}

async function resolveSessionLogPath(targetSessionId?: string): Promise<string | null> {
  if (targetSessionId) {
    const candidate = join(LOG_DIR, `${targetSessionId}.jsonl`);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      return null;
    }
  }

  if (sessionLogPath) return sessionLogPath;

  try {
    const raw = await fs.readFile(join(DATA_DIR, "current-session.json"), "utf-8");
    const parsed = JSON.parse(raw) as { sessionLogPath?: string };
    if (!parsed.sessionLogPath) return null;
    await fs.access(parsed.sessionLogPath);
    return parsed.sessionLogPath;
  } catch {
    return null;
  }
}

function parseEntries(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const lines = raw.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as LogEntry;
      entries.push(entry);
    } catch {
    }
  }
  return entries;
}

function formatEntry(entry: LogEntry): string {
  const meta = `${entry.timestamp} | ${entry.level.toUpperCase()} | ${entry.event}`;
  if (entry.data === undefined) return meta;
  const serialized =
    typeof entry.data === "string" ? entry.data : JSON.stringify(entry.data);
  return `${meta}\n${serialized}`;
}

export async function getLogs(
  options: { sessionId?: string; limit?: number } = {},
): Promise<string> {
  const limit = Math.max(1, Math.min(options.limit ?? 200, 2000));
  const path = await resolveSessionLogPath(options.sessionId);
  if (!path) {
    return options.sessionId
      ? `❌ Session log not found for "${options.sessionId}".`
      : "❌ No log session found.";
  }

  const raw = await fs.readFile(path, "utf-8");
  const entries = parseEntries(raw);
  if (!entries.length) return `📄 Log file is empty.\n${path}`;

  const selected = entries.slice(-limit);
  return [
    `📄 Log session: ${selected[0].sessionId}`,
    `📍 ${path}`,
    `📊 Showing ${selected.length}/${entries.length} events`,
    "",
    selected.map(formatEntry).join("\n\n"),
  ].join("\n");
}

export async function tailLogs(
  lines: number = 50,
  sessionId?: string,
): Promise<string> {
  const capped = Math.max(1, Math.min(lines, 500));
  return getLogs({ sessionId, limit: capped });
}

export async function logEvent(
  event: string,
  data?: unknown,
  level: LogLevel = "info",
): Promise<void> {
  if (!initialized) await initLogger();
  const entry: LogEntry = {
    sessionId,
    seq: ++seq,
    timestamp: new Date().toISOString(),
    level,
    event,
    data,
  };
  await enqueueWrite(`${JSON.stringify(entry)}\n`);
}

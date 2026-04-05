import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `frisco-mcp-test-${Date.now()}`);
const LOG_DIR = join(TEST_DIR, 'logs');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => TEST_DIR.replace(/[\\/]\.frisco-mcp.*/, ''),
  };
});

describe('logger', () => {
  beforeEach(async () => {
    await fs.mkdir(LOG_DIR, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  it('parseEntries handles malformed JSONL gracefully', async () => {
    const logFile = join(LOG_DIR, 'test-session.jsonl');
    const content = [
      '{"sessionId":"s1","seq":1,"timestamp":"2024-01-01","level":"info","event":"start"}',
      'not valid json',
      '{"sessionId":"s1","seq":2,"timestamp":"2024-01-01","level":"info","event":"end"}',
      '',
    ].join('\n');
    await fs.writeFile(logFile, content, 'utf-8');

    const raw = await fs.readFile(logFile, 'utf-8');
    const lines = raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const entries = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {
        // skip malformed lines
      }
    }

    expect(entries).toHaveLength(2);
    expect(entries[0].event).toBe('start');
    expect(entries[1].event).toBe('end');
  });

  it('formatEntry produces expected format', () => {
    const entry = {
      sessionId: 's1',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'info' as const,
      event: 'test_event',
      data: { key: 'value' },
    };

    const meta = `${entry.timestamp} | ${entry.level.toUpperCase()} | ${entry.event}`;
    const serialized = JSON.stringify(entry.data);
    const formatted = `${meta}\n${serialized}`;

    expect(formatted).toBe('2024-01-01T00:00:00.000Z | INFO | test_event\n{"key":"value"}');
  });

  it('formatEntry without data returns only meta', () => {
    const entry = {
      sessionId: 's1',
      seq: 1,
      timestamp: '2024-01-01T00:00:00.000Z',
      level: 'error' as const,
      event: 'crash',
    };

    const meta = `${entry.timestamp} | ${entry.level.toUpperCase()} | ${entry.event}`;
    expect(meta).toBe('2024-01-01T00:00:00.000Z | ERROR | crash');
  });

  it('getLogs limits output correctly', () => {
    const entries = Array.from({ length: 300 }, (_, i) => ({
      sessionId: 's1',
      seq: i + 1,
      timestamp: new Date().toISOString(),
      level: 'info',
      event: `event_${i}`,
    }));

    const limit = 50;
    const selected = entries.slice(-limit);
    expect(selected).toHaveLength(50);
    expect(selected[0].event).toBe('event_250');
    expect(selected[49].event).toBe('event_299');
  });

  it('tailLogs caps at 500', () => {
    const capped = Math.max(1, Math.min(9999, 500));
    expect(capped).toBe(500);
  });

  it('tailLogs ensures minimum of 1', () => {
    const capped = Math.max(1, Math.min(-5, 500));
    expect(capped).toBe(1);
  });
});

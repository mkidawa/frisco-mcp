import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DIR = join(tmpdir(), `frisco-mcp-auth-${Date.now()}`);
const DATA_DIR = join(TEST_DIR, '.frisco-mcp');
const SESSION_FILE = join(DATA_DIR, 'session.json');

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => TEST_DIR,
  };
});

describe('auth', () => {
  beforeEach(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    vi.resetModules();
  });

  afterEach(async () => {
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {}
  });

  async function importAuth() {
    return await import('../auth.js');
  }

  it('sessionExists returns false when no session file', async () => {
    const { sessionExists } = await importAuth();
    const exists = await sessionExists();
    expect(exists).toBe(false);
  });

  it('sessionExists returns true when session file exists', async () => {
    await fs.writeFile(SESSION_FILE, '[]', 'utf-8');
    const { sessionExists } = await importAuth();
    const exists = await sessionExists();
    expect(exists).toBe(true);
  });

  it('deleteSession removes the session file', async () => {
    await fs.writeFile(SESSION_FILE, '[]', 'utf-8');
    const { deleteSession, sessionExists } = await importAuth();

    await deleteSession();
    const exists = await sessionExists();
    expect(exists).toBe(false);
  });

  it('deleteSession does not throw when file does not exist', async () => {
    const { deleteSession } = await importAuth();
    await expect(deleteSession()).resolves.toBeUndefined();
  });

  it('saveSession writes cookies to file', async () => {
    const { saveSession } = await importAuth();
    const mockCookies = [
      { name: 'sid', value: 'abc123', domain: 'frisco.pl', path: '/' },
    ];
    const mockContext = {
      cookies: vi.fn().mockResolvedValue(mockCookies),
    } as any;

    await saveSession(mockContext);

    const raw = await fs.readFile(SESSION_FILE, 'utf-8');
    const saved = JSON.parse(raw);
    expect(saved).toEqual(mockCookies);
  });

  it('restoreSession loads cookies into context', async () => {
    const cookies = [
      { name: 'sid', value: 'xyz', domain: 'frisco.pl', path: '/' },
    ];
    await fs.writeFile(SESSION_FILE, JSON.stringify(cookies), 'utf-8');

    const { restoreSession } = await importAuth();
    const mockContext = {
      addCookies: vi.fn(),
    } as any;

    const result = await restoreSession(mockContext);
    expect(result).toBe(true);
    expect(mockContext.addCookies).toHaveBeenCalledWith(cookies);
  });

  it('restoreSession returns false when no session file', async () => {
    const { restoreSession } = await importAuth();
    const mockContext = {
      addCookies: vi.fn(),
    } as any;

    const result = await restoreSession(mockContext);
    expect(result).toBe(false);
    expect(mockContext.addCookies).not.toHaveBeenCalled();
  });

  it('ensureLoggedIn throws when no saved session', async () => {
    const { ensureLoggedIn } = await importAuth();
    const mockPage = {} as any;
    const mockContext = {
      addCookies: vi.fn(),
    } as any;

    await expect(ensureLoggedIn(mockPage, mockContext)).rejects.toThrow(
      'No saved session found',
    );
  });

  it('ensureLoggedIn throws when session is invalid', async () => {
    const cookies = [{ name: 'sid', value: 'expired', domain: 'frisco.pl', path: '/' }];
    await fs.writeFile(SESSION_FILE, JSON.stringify(cookies), 'utf-8');

    const { ensureLoggedIn } = await importAuth();
    const mockPage = {} as any;
    const mockContext = {
      addCookies: vi.fn(),
      request: {
        get: vi.fn().mockResolvedValue({
          url: () => 'https://www.frisco.pl/stn,login',
          status: () => 200,
        }),
      },
    } as any;

    await expect(ensureLoggedIn(mockPage, mockContext)).rejects.toThrow(
      'Session expired',
    );
  });

  it('ensureLoggedIn succeeds with valid session', async () => {
    const cookies = [{ name: 'sid', value: 'valid', domain: 'frisco.pl', path: '/' }];
    await fs.writeFile(SESSION_FILE, JSON.stringify(cookies), 'utf-8');

    const { ensureLoggedIn } = await importAuth();
    const mockPage = {} as any;
    const mockContext = {
      addCookies: vi.fn(),
      request: {
        get: vi.fn().mockResolvedValue({
          url: () => 'https://www.frisco.pl/stn,user-account',
          status: () => 200,
        }),
      },
    } as any;

    await expect(ensureLoggedIn(mockPage, mockContext)).resolves.toBeUndefined();
  });
});

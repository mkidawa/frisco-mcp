import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { Page, BrowserContext } from 'playwright';

const DATA_DIR = join(homedir(), '.frisco-mcp');
export const SESSION_PATH = join(DATA_DIR, 'session.json');

export async function saveSession(context: BrowserContext): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const cookies = await context.cookies();
  await fs.writeFile(SESSION_PATH, JSON.stringify(cookies, null, 2), 'utf-8');
}

export async function restoreSession(context: BrowserContext): Promise<boolean> {
  try {
    const raw = await fs.readFile(SESSION_PATH, 'utf-8');
    const cookies = JSON.parse(raw);
    await context.addCookies(cookies);
    return true;
  } catch {
    return false;
  }
}

export async function isLoggedIn(context: BrowserContext): Promise<boolean> {
  try {
    const response = await context.request.get('https://www.frisco.pl/stn,user-account', {
      timeout: 12_000,
      failOnStatusCode: false,
    });
    const finalUrl = response.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/stn,login')) return false;
    return response.status() < 500;
  } catch {
    return true;
  }
}

export async function ensureLoggedIn(page: Page, context: BrowserContext): Promise<void> {
  void page;

  const restored = await restoreSession(context);
  if (!restored) {
    throw new Error(
      'No saved session found. Please run the "login" tool first to log in via the browser.'
    );
  }
  const ok = await isLoggedIn(context);
  if (!ok) {
    throw new Error(
      'Session expired or invalid. Please run the "login" tool again to re-authenticate.'
    );
  }
}

export async function deleteSession(): Promise<void> {
  try {
    await fs.unlink(SESSION_PATH);
  } catch {
  }
}

export async function sessionExists(): Promise<boolean> {
  try {
    await fs.access(SESSION_PATH);
    return true;
  } catch {
    return false;
  }
}

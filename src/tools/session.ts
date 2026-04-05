import { getPage, getContext, closeBrowser, isBrowserOpen } from '../browser.js';
import {
  saveSession,
  deleteSession,
  sessionExists,
  SESSION_PATH,
} from '../auth.js';

async function resetAuthStateForLogin(page: import('playwright').Page): Promise<void> {
  const context = page.context();
  await context.clearCookies();

  try {
    await page.goto('https://www.frisco.pl/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
  } catch {
  }
}

export async function login(): Promise<string> {
  const page = await getPage();
  const context = await getContext();

  await resetAuthStateForLogin(page);

  await page.goto('https://www.frisco.pl/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_000);

  try {
    await page.getByRole('button', { name: 'Akceptuję' }).click({ timeout: 3_000 });
    await page.waitForTimeout(800);
  } catch {}

  try {
    await page.click('button.modal-new_close', { timeout: 2_000 });
    await page.waitForTimeout(500);
  } catch {}

  const POLL_INTERVAL = 2_000;
  const TIMEOUT_MS = 5 * 60 * 1_000;
  const deadline = Date.now() + TIMEOUT_MS;

  while (Date.now() < deadline) {
    const url = page.url();
    if (!url.includes('login')) {
      const hasAccountEl = await page.evaluate(() => {
        return !!(
          document.querySelector('[class*="logout"]') ||
          document.querySelector('[href*="logout"]') ||
          document.querySelector('[href*="wyloguj"]') ||
          document.querySelector('[data-testid="account-menu"]') ||
          document.querySelector('[class*="UserMenu"]') ||
          document.querySelector('[class*="user-menu"]')
        );
      });

      if (hasAccountEl || url === 'https://www.frisco.pl/' || url === 'https://www.frisco.pl/stn,home') {
        await saveSession(context);
        return (
          '✅ Logged in successfully! Session cookies saved to ' +
          SESSION_PATH +
          '\n\nYou can now use cart and product tools. ' +
          'The browser window will stay open — close it manually or use clear_session.'
        );
      }
    }
    await page.waitForTimeout(POLL_INTERVAL);
  }

  return (
    '⚠️ Login timeout (5 minutes). ' +
    'The browser is still open — log in manually and then call login again, ' +
    'or call clear_session to reset.'
  );
}

export async function finishSession(): Promise<string> {
  const CART_URL = 'https://www.frisco.pl/stn,cart';

  if (!(await sessionExists())) {
    return '❌ No saved session. Please run login first.';
  }

  const page = await getPage();
  const context = await getContext();

  const { restoreSession } = await import('../auth.js');
  await restoreSession(context);

  await page.goto(CART_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1_500);

  return (
    '🛒 Browser is now open at your cart:\n' +
    CART_URL +
    '\n\nReview your items, select delivery slot, and complete payment.\n' +
    '⚠️ The agent will NOT make payment on your behalf — this step is yours.'
  );
}

export async function clearSession(): Promise<string> {
  const hadBrowser = isBrowserOpen();
  await closeBrowser();
  await deleteSession();

  const parts: string[] = [];
  if (hadBrowser) parts.push('🔒 Browser closed.');
  parts.push('🗑️ Session file deleted.');
  parts.push('You can run login again to start a new session.');
  return parts.join('\n');
}

import { chromium, Browser, BrowserContext, Page } from 'playwright';
import type { Product } from './types.js';

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

export const productCache = new Map<string, Product>();

export async function getPage(): Promise<Page> {
  if (_page) return _page;

  _browser = await chromium.launch({ headless: false });
  _context = await _browser.newContext({ locale: 'pl-PL' });
  _page = await _context.newPage();
  return _page;
}

export async function getContext(): Promise<BrowserContext> {
  if (_context) return _context;
  await getPage();
  return _context!;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    try {
      await _browser.close();
    } catch {
    }
  }
  _browser = null;
  _context = null;
  _page = null;
  productCache.clear();
}

export function isBrowserOpen(): boolean {
  return _browser !== null;
}

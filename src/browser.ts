import { chromium, Browser, BrowserContext, Page } from "playwright";
import type { Product, SearchContext } from "./types.js";

let _browser: Browser | null = null;
let _context: BrowserContext | null = null;
let _page: Page | null = null;

export const productCache = new Map<string, Product>();
let _lastSearchContext: SearchContext | null = null;

export function setLastSearchContext(context: SearchContext): void {
  _lastSearchContext = context;
}

export function getLastSearchContext(): SearchContext | null {
  return _lastSearchContext;
}

export async function getPage(): Promise<Page> {
  if (_browser !== null && !_browser.isConnected()) {
    await closeBrowser();
  }
  if (_page && _browser?.isConnected()) return _page;

  _browser = await chromium.launch({ headless: false });
  _context = await _browser.newContext({ locale: "pl-PL" });
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
    } catch {}
  }
  _browser = null;
  _context = null;
  _page = null;
  productCache.clear();
  _lastSearchContext = null;
}

export function isBrowserOpen(): boolean {
  return _browser !== null;
}

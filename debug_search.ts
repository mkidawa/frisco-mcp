
import { getPage, getContext } from './src/browser.js';
import { ensureLoggedIn } from './src/auth.js';
import { searchProducts } from './src/tools/products.js';

async function debug() {
  const page = await getPage();
  const context = await getContext();
  
  try {
    console.log('Checking login...');
    await ensureLoggedIn(page, context);
    console.log('Logged in.');

    console.log('Searching for "skyr"...');
    const result = await searchProducts('skyr');
    console.log('Result:', result);
  } catch (err) {
    console.error('Debug error:', err);
    const url = page.url();
    console.log('Current URL:', url);
    const content = await page.content();
    console.log('Page content length:', content.length);
    // Take a screenshot if possible
    await page.screenshot({ path: 'debug_screenshot.png' });
    console.log('Screenshot saved to debug_screenshot.png');
  }
}

debug();

import { getPage, getContext } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { searchNavigateAndCache, dismissPopups } from './helpers.js';
import type { CartItem } from '../types.js';

async function clearCart(page: import('playwright').Page): Promise<void> {
  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  const clearBtn = page.locator(
    '.checkout_products-actions-clear-cart, .cart-side-box_actions_clear-cart'
  ).first();

  if (await clearBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await clearBtn.click();
    const confirmBtn = page.locator('.notification-popup_buttons .button.cta');
    await confirmBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await confirmBtn.click();
    await page.waitForTimeout(2_000);
  }
}

export async function addItemsToCart(
  items: string,
  options: { clearCartFirst?: boolean } = {}
): Promise<string> {
  let products: CartItem[];
  try {
    products = JSON.parse(items) as CartItem[];
  } catch {
    return '❌ Invalid JSON. Expected: \'[{"name":"...","searchQuery":"...","quantity":1}]\'';
  }

  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);
  await dismissPopups(page);

  const shouldClearCart = options.clearCartFirst === true;
  if (shouldClearCart) {
    await clearCart(page);
  }

  const results: string[] = [];

  for (const item of products) {
    const name = item.name ?? '?';
    const query = item.searchQuery ?? name;
    const qty = item.quantity ?? 1;

    try {
      const { foundName, addButton } = await searchNavigateAndCache(page, query);

      if (!addButton) {
        results.push(`⚠️  ${name}: not found on frisco.pl`);
        continue;
      }

      for (let i = 0; i < qty; i++) {
        await addButton.click();
        await page.waitForTimeout(500);
      }

      results.push(`✅ ${foundName} ×${qty}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message.slice(0, 80) : String(err);
      results.push(`❌ ${name}: ${msg}`);
    }
  }

  const added = results.filter(r => r.startsWith('✅')).length;
  return [
    `🛒 Added ${added}/${products.length} items:`,
    '',
    results.join('\n'),
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '⚠️  Payment is YOUR responsibility.',
    '👉 https://www.frisco.pl/stn,cart',
    'The browser is open — go to checkout when ready.',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
  ].join('\n');
}

export async function removeItemFromCart(productName: string): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  const needle = productName.toLowerCase();

  try {
    const removed = await page.evaluate((target: string) => {
      const boxes = Array.from(
        document.querySelectorAll<HTMLElement>('.product-box_holder'),
      ).filter(
        (el) =>
          el.offsetParent !== null &&
          el.querySelector('.horizontal-product-box__delete-button'),
      );

      for (const box of boxes) {
        const nameEl = box.querySelector<HTMLAnchorElement>('a[title]');
        const name = nameEl?.title?.toLowerCase() ?? '';
        if (name.includes(target)) {
          const btn = box.querySelector<HTMLElement>(
            '.horizontal-product-box__delete-button',
          );
          btn?.click();
          return nameEl?.title ?? target;
        }
      }
      return null;
    }, needle);

    if (!removed) {
      return `⚠️ Product "${productName}" not found in cart.`;
    }

    await page.waitForTimeout(1_000);
    return `🗑️ Removed "${removed}" from cart.\n👉 https://www.frisco.pl/stn,cart`;
  } catch (err) {
    return `❌ Failed to remove item: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function viewCart(): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  try {
    const result = (await page.evaluate(() => {
      const boxes = Array.from(document.querySelectorAll<HTMLElement>('.product-box_holder'))
        .filter(el => el.offsetParent !== null &&
          el.querySelector('.horizontal-product-box__delete-button'));

      const byName = new Map();
      boxes.forEach(box => {
        const nameEl = box.querySelector<HTMLAnchorElement>('a[title]');
        const name = nameEl ? nameEl.title : null;
        if (!name) return;
        const priceEl = box.querySelector<HTMLElement>('[class*="price"], [class*="Price"]');
        const price = priceEl ? priceEl.innerText.trim().replace(/\\s+/g, ' ') : '';
        const qtyEl = box.querySelector(
          'input[type="number"], [class*="stepper"], [class*="Quantity"], [class*="quantity"]'
        ) as HTMLInputElement | HTMLElement | null;
        const qty = qtyEl
          ? (qtyEl instanceof HTMLInputElement ? qtyEl.value : qtyEl.innerText || '1').trim()
          : '1';
        if (!byName.has(name) || (!byName.get(name).price && price)) {
          byName.set(name, { name, price, qty });
        }
      });

      const items = Array.from(byName.values());
      const totalEl = document.querySelector<HTMLElement>(
        '[class*="summary"] [class*="price"], [class*="checkout"] [class*="total"], ' +
        '[class*="Summary"] [class*="Price"], [class*="CartSummary"]'
      );
      const total = totalEl ? totalEl.innerText.trim().replace(/\\s+/g, ' ') : null;
      return { items, total };
    })) as { items: { name: string; price: string; qty: string }[]; total: string | null };

    if (!result.items.length) {
      return '🛒 Cart is empty (or contents could not be read).\n👉 https://www.frisco.pl/stn,cart';
    }

    const lines = ['🛒 Cart contents:\n'];
    for (const it of result.items) {
      const pricePart = it.price ? ` — ${it.price}` : '';
      lines.push(`- ${it.name} ×${it.qty}${pricePart}`);
    }
    if (result.total) lines.push(`\n💰 Total: ${result.total}`);
    lines.push('\n👉 https://www.frisco.pl/stn,cart');
    return lines.join('\n');
  } catch (err) {
    return `❌ Failed to read cart: ${err instanceof Error ? err.message : String(err)}`;
  }
}

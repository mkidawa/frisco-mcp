import { getPage, getContext } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import {
  searchNavigateAndCache,
  dismissPopups,
  extractCartIssuesFromHtml,
  formatCartIssues,
  extractPromotionsFromHtml,
  formatPromotions,
} from './helpers.js';
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
      const { foundName, addButton, unavailable, alternatives } = await searchNavigateAndCache(page, query);

      if (!addButton) {
        if (unavailable) {
          let msg = `⚠️  ${name}: produkt "${foundName}" jest chwilowo niedostępny`;
          if (alternatives && alternatives.length > 0) {
            msg += `\n   Dostępne alternatywy:`;
            for (const alt of alternatives) {
              const w = alt.weight ? ` [${alt.weight}]` : '';
              const p = alt.price ? ` | ${alt.price}` : '';
              msg += `\n   - ${alt.name}${w}${p}`;
            }
          }
          results.push(msg);
        } else {
          results.push(`⚠️  ${name}: not found on frisco.pl`);
        }
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
      function cartLineDisplayName(box: HTMLElement): string | null {
        const tImg = box.querySelector<HTMLImageElement>('.horizontal-product-box__product-img img[title]');
        if (tImg?.title) return tImg.title.replace(/\s+/g, ' ').trim();
        const aImg = box.querySelector<HTMLImageElement>('.horizontal-product-box__product-img img[alt]');
        if (aImg?.alt) return aImg.alt.replace(/\s+/g, ' ').trim();
        const brand = box.querySelector<HTMLElement>('.f-hpc__brand');
        const bare = box.querySelector<HTMLElement>('.f-hpc__bare-name');
        if (brand && bare) {
          const bt = (brand.getAttribute('title') || brand.textContent || '').trim();
          const nt = (bare.getAttribute('title') || bare.textContent || '').trim();
          if (bt && nt) return `${bt} ${nt}`.replace(/\s+/g, ' ').trim();
        }
        const titled = box.querySelector<HTMLAnchorElement>('a[title]');
        if (titled?.title) return titled.title.trim();
        return null;
      }

      function cartLineRoots(): HTMLElement[] {
        const horiz = Array.from(
          document.querySelectorAll<HTMLElement>('article.horizontal-product-box__wrapper'),
        ).filter(
          (el) => el.offsetParent !== null && el.querySelector('.horizontal-product-box__delete-button'),
        );
        if (horiz.length > 0) return horiz;
        return Array.from(document.querySelectorAll<HTMLElement>('.product-box_holder')).filter(
          (el) => el.offsetParent !== null && el.querySelector('.horizontal-product-box__delete-button'),
        );
      }

      const t = target.toLowerCase();
      for (const box of cartLineRoots()) {
        const name = cartLineDisplayName(box);
        if (name && name.toLowerCase().includes(t)) {
          box.querySelector<HTMLElement>('.horizontal-product-box__delete-button')?.click();
          return name;
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
      function cartLineDisplayName(box: HTMLElement): string | null {
        const tImg = box.querySelector<HTMLImageElement>('.horizontal-product-box__product-img img[title]');
        if (tImg?.title) return tImg.title.replace(/\s+/g, ' ').trim();
        const aImg = box.querySelector<HTMLImageElement>('.horizontal-product-box__product-img img[alt]');
        if (aImg?.alt) return aImg.alt.replace(/\s+/g, ' ').trim();
        const brand = box.querySelector<HTMLElement>('.f-hpc__brand');
        const bare = box.querySelector<HTMLElement>('.f-hpc__bare-name');
        if (brand && bare) {
          const bt = (brand.getAttribute('title') || brand.textContent || '').trim();
          const nt = (bare.getAttribute('title') || bare.textContent || '').trim();
          if (bt && nt) return `${bt} ${nt}`.replace(/\s+/g, ' ').trim();
        }
        const titled = box.querySelector<HTMLAnchorElement>('a[title]');
        if (titled?.title) return titled.title.trim();
        return null;
      }

      function cartLineRoots(): HTMLElement[] {
        const horiz = Array.from(
          document.querySelectorAll<HTMLElement>('article.horizontal-product-box__wrapper'),
        ).filter(
          (el) => el.offsetParent !== null && el.querySelector('.horizontal-product-box__delete-button'),
        );
        if (horiz.length > 0) return horiz;
        return Array.from(document.querySelectorAll<HTMLElement>('.product-box_holder')).filter(
          (el) => el.offsetParent !== null && el.querySelector('.horizontal-product-box__delete-button'),
        );
      }

      const byName = new Map<string, { name: string; price: string; qty: string }>();
      for (const box of cartLineRoots()) {
        const name = cartLineDisplayName(box);
        if (!name) continue;
        const qtyEl = box.querySelector<HTMLInputElement>(
          'input.cart-button_quantity, input[type="number"], [class*="stepper"], input[class*="Quantity"], input[class*="quantity"]',
        );
        const qty = qtyEl ? (qtyEl.value || '1').trim() : '1';
        const priceEl = box.querySelector<HTMLElement>(
          '.horizontal-product-box__cart-price-value, .horizontal-product-box__cart-price .price, [class*="price"], [class*="Price"]',
        );
        const price = priceEl ? priceEl.innerText.trim().replace(/\s+/g, ' ') : '';
        const prev = byName.get(name);
        if (!prev || (!prev.price && price)) {
          byName.set(name, { name, price, qty });
        }
      }

      const items = Array.from(byName.values());
      const totalRow = document.querySelector<HTMLElement>(
        '.generic-summary-box_frame-section-row.final.cta .generic-summary-box_frame-section-row-value',
      );
      const totalEl =
        totalRow ??
        document.querySelector<HTMLElement>(
          '[class*="summary"] [class*="price"], [class*="checkout"] [class*="total"], ' +
            '[class*="Summary"] [class*="Price"], [class*="CartSummary"]',
        );
      const total = totalEl ? totalEl.innerText.trim().replace(/\s+/g, ' ') : null;
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

export async function checkCartIssues(): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  try {
    const html = await page.content();
    const issues = extractCartIssuesFromHtml(html);
    return formatCartIssues(issues);
  } catch (err) {
    return `❌ Failed to check cart issues: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function viewPromotions(): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  try {
    const html = await page.content();
    const data = extractPromotionsFromHtml(html);
    return formatPromotions(data);
  } catch (err) {
    return `❌ Failed to read promotions: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function updateItemQuantity(productName: string, quantity: number): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.goto('https://www.frisco.pl/stn,cart', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2_000);

  const needle = productName.toLowerCase();

  try {
    const found = await page.evaluate((target: string) => {
      const boxes = Array.from(
        document.querySelectorAll<HTMLElement>('.mini-product-box_wrapper.in-cart'),
      );

      for (const box of boxes) {
        const nameEl = box.querySelector<HTMLAnchorElement>('a[title]');
        const name = nameEl?.title?.toLowerCase() ?? '';
        if (name.includes(target)) {
          return nameEl?.title ?? target;
        }
      }
      return null;
    }, needle);

    if (!found) {
      return `⚠️ Produkt "${productName}" nie znaleziony w koszyku.`;
    }

    const qtyInput = page.locator(`.mini-product-box_wrapper.in-cart:has(a[title*="${found}" i]) .cart-button_quantity`).first();

    if (!(await qtyInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
      return `⚠️ Nie można zmienić ilości "${found}" — nie znaleziono pola ilości.`;
    }

    await qtyInput.fill(String(quantity));
    await qtyInput.press('Enter');
    await page.waitForTimeout(1_500);

    return `✅ Zmieniono ilość "${found}" na ${quantity}.\n👉 https://www.frisco.pl/stn,cart`;
  } catch (err) {
    return `❌ Błąd zmiany ilości: ${err instanceof Error ? err.message : String(err)}`;
  }
}

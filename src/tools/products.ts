import { getPage, getContext, productCache } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { formatProductInfo, extractProductPageInfoFromHtml } from './helpers.js';
import type { Product } from '../types.js';

export async function searchProducts(query: string, topN: number = 5): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  await page.getByRole('textbox', { name: 'Wyszukaj' }).click();
  const searchInput = page.getByRole('textbox', { name: 'Jakiego produktu szukasz?' });
  await searchInput.fill(query);
  await searchInput.press('Enter');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2_000);

  try {
    const products = (await page.evaluate((limit: number) => {
      function notInSidebar(el: HTMLElement) {
        let node = el.parentElement;
        while (node) {
          const cls = (node.className || '').toString().toLowerCase();
          if (cls.includes('cart') || cls.includes('basket') || cls.includes('mini-cart')) return false;
          node = node.parentElement;
        }
        const rect = el.getBoundingClientRect();
        return rect.left <= window.innerWidth * 0.65;
      }

      const boxes = Array.from(document.querySelectorAll<HTMLElement>('.product-box_holder'))
        .filter(el => el.offsetParent !== null && notInSidebar(el))
        .slice(0, limit);

      return boxes.map(box => {
        const nameEl = box.querySelector<HTMLAnchorElement>('a[title]');
        const name = nameEl ? nameEl.title : '?';
        const priceEl = box.querySelector<HTMLElement>('[class*="price"], [class*="Price"]');
        const price = priceEl ? priceEl.innerText.trim().replace(/\\s+/g, ' ') : '';

        let weight = '';
        const weightEl = box.querySelector<HTMLElement>('.f-pc-weight__text');
        if (weightEl) {
          const raw = weightEl.innerText.trim().replace(/\\s+/g, ' ');
          const wm = raw.match(/^~?([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs)\b)/i);
          if (wm) weight = wm[1];
        }
        if (!weight) {
          const imgEl = box.querySelector<HTMLImageElement>('img[alt]');
          if (imgEl?.alt) {
            const am = imgEl.alt.match(/([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs))\s*$/i);
            if (am) weight = am[1].replace(/\u00a0/g, ' ');
          }
        }

        return { name, price, weight };
      });
    }, topN)) as { name: string; price: string; weight: string }[];

    if (!products.length) return `❌ No products found for: "${query}"`;

    const lines = [`🔍 Search results for "${query}":\n`];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const weightPart = p.weight ? ` [${p.weight}]` : '';
      const pricePart = p.price ? ` | ${p.price}` : '';
      lines.push(`${i + 1}. ${p.name}${weightPart}${pricePart}`);
    }
    return lines.join('\n');
  } catch (err) {
    return `❌ Search error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

export async function getProductInfo(query: string): Promise<string> {
  const cached = productCache.get(query)
    ?? Array.from(productCache.values()).find(
      p => p.name.toLowerCase() === query.toLowerCase()
    );
  if (cached?.macros && Object.keys(cached.macros).length > 0) {
    return formatProductInfo(cached);
  }

  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  let productUrl: string | null = null;
  try {
    await page.getByRole('textbox', { name: 'Wyszukaj' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Jakiego produktu szukasz?' });
    await searchInput.fill(query);
    await searchInput.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);

    productUrl = (await page.evaluate(() => {
      function notInSidebar(el: HTMLElement) {
        let node = el.parentElement;
        while (node) {
          const cls = (node.className || '').toString().toLowerCase();
          if (cls.includes('cart') || cls.includes('basket') || cls.includes('mini-cart')) return false;
          node = node.parentElement;
        }
        return el.getBoundingClientRect().left <= window.innerWidth * 0.65;
      }
      const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/pid,"][title]'))
        .find(el => el.offsetParent !== null && notInSidebar(el));
      return link ? link.href : null;
    })) as string | null;
  } catch (err) {
    return `❌ Search failed: ${err instanceof Error ? err.message : String(err)}`;
  }

  if (!productUrl) return `❌ No product found for: "${query}"`;

  const fullUrl = productUrl.startsWith('http')
    ? productUrl
    : 'https://www.frisco.pl' + productUrl;

  try {
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    for (const label of ['Wartości odżywcze', 'Skład i alergeny']) {
      try {
        await page.getByText(label, { exact: true }).first().click({ timeout: 2_000 });
        await page.waitForTimeout(800);
      } catch {}
    }
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_000);

    const html = await page.content();
    const info = extractProductPageInfoFromHtml(html);
    const product: Product = {
      name: info.name || query,
      url: fullUrl,
      price: info.price,
      weight: info.weight,
      macros: info.macros,
      ingredients: info.ingredients,
    };
    productCache.set(query, product);
    return formatProductInfo(product);
  } catch (err) {
    return `❌ Failed to extract product info: ${err instanceof Error ? err.message : String(err)}`;
  }
}

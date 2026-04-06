import { getPage, getContext, productCache, setLastSearchContext } from '../browser.js';
import { ensureLoggedIn } from '../auth.js';
import { formatProductInfo, extractProductPageInfoFromHtml, extractReviewsFromHtml, formatReviews } from './helpers.js';
import type { Product, SearchResultItem } from '../types.js';

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
        const productLink = box.querySelector<HTMLAnchorElement>('a[href*="/pid,"][title]');
        const href = productLink ? productLink.getAttribute('href') || productLink.href : null;
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

        const unavailable = !!box.querySelector('.unavailable-info') ||
          !!box.querySelector('article.unavailable');

        return { name, href, price, weight, available: !unavailable };
      });
    }, topN)) as Array<{
      name: string;
      href: string | null;
      price: string;
      weight: string;
      available: boolean;
    }>;

    if (!products.length) return `❌ No products found for: "${query}"`;

    const searchResults: SearchResultItem[] = [];
    const searchUrl = page.url();

    const lines = [`🔍 Search results for "${query}" (saved context):\n`];
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      const href = p.href;
      const fullUrl = typeof href === 'string'
        ? (href.startsWith('http') ? href : `https://www.frisco.pl${href}`)
        : null;
      if (p.available && typeof href === 'string') {
        const cachedProduct: Product = {
          name: p.name,
          url: fullUrl!,
          price: p.price || '',
          weight: p.weight || null,
          macros: {},
          ingredients: null,
        };
        productCache.set(p.name, cachedProduct);
      }
      searchResults.push({
        name: p.name,
        url: fullUrl,
        price: p.price || '',
        weight: p.weight || '',
        available: p.available,
      });
      const weightPart = p.weight ? ` [${p.weight}]` : '';
      const pricePart = p.price ? ` | ${p.price}` : '';
      const availPart = p.available ? '' : ' ⚠️ NIEDOSTĘPNY';
      lines.push(`${i + 1}. ${p.name}${weightPart}${pricePart}${availPart}`);
    }
    setLastSearchContext({
      query,
      searchUrl,
      results: searchResults,
      updatedAt: Date.now(),
    });
    lines.push('');
    lines.push(`🔗 Search URL: ${searchUrl}`);
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

export async function getProductReviews(query: string, limit: number = 5): Promise<string> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);

  try {
    await page.getByRole('textbox', { name: 'Wyszukaj' }).click();
    const searchInput = page.getByRole('textbox', { name: 'Jakiego produktu szukasz?' });
    await searchInput.fill(query);
    await searchInput.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2_000);

    const productUrl: string | null = await page.evaluate(() => {
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
    });

    if (!productUrl) return `❌ Nie znaleziono produktu: "${query}"`;

    const fullUrl = productUrl.startsWith('http')
      ? productUrl
      : 'https://www.frisco.pl' + productUrl;

    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2_000);

    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1_000);

    const html = await page.content();
    const data = extractReviewsFromHtml(html);
    return formatReviews(data, limit);
  } catch (err) {
    return `❌ Błąd pobierania opinii: ${err instanceof Error ? err.message : String(err)}`;
  }
}

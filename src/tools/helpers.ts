import type { Page } from 'playwright';
import { load } from 'cheerio';
import type { Product, ProductPageInfo, CartIssue, ProductReviews, Review, CartPromotion } from '../types.js';
import { productCache } from '../browser.js';

export async function dismissPopups(page: Page): Promise<void> {
  try {
    await page.getByRole('button', { name: 'Akceptuję' }).click({ timeout: 3_000 });
    await page.waitForTimeout(500);
  } catch {}
  try {
    await page.click('button.modal-new_close', { timeout: 2_000 });
    await page.waitForTimeout(400);
  } catch {}
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

const MACRO_KEY_MAP: Array<[string, string]> = [
  ['kcal', 'kcal'],
  ['energia', 'kcal'],
  ['białko', 'protein'],
  ['bialko', 'protein'],
  ['tłuszcz', 'fat'],
  ['tluszcz', 'fat'],
  ['węglowodan', 'carbohydrates'],
  ['weglowodan', 'carbohydrates'],
  ['cukr', 'sugars'],
  ['błonnik', 'fiber'],
  ['blonnik', 'fiber'],
  ['sól', 'salt'],
  ['sol', 'salt'],
];

function findExpandableBlockText($: ReturnType<typeof load>, sectionTitle: string): string {
  let result = '';
  $('.expandable-block').each((_, block) => {
    const title = normalizeWhitespace($(block).find('.expandable-block_copy-title').first().text());
    if (title === sectionTitle) {
      result = normalizeWhitespace($(block).find('.expandable-block_content').first().text());
    }
  });
  return result;
}

function extractMacrosFromText(text: string): ProductPageInfo['macros'] {
  const macros: ProductPageInfo['macros'] = {};
  const patterns: Array<[RegExp, string]> = [
    [/Warto[śs][ćc]\s+energetyczna\s*\(kcal\)\s*([\d.,]+\s*kcal)/i, 'kcal'],
    [/Bia[łl]ko\s*\(g\)\s*([\d.,]+\s*g)/i, 'protein'],
    [/T[łl]uszcz\s*\(g\)\s*([\d.,]+\s*g)/i, 'fat'],
    [/W[ęe]glowodany\s*\(g\)\s*([\d.,]+\s*g)/i, 'carbohydrates'],
    [/w tym cukry\s*\(g\)\s*([\d.,]+\s*g)/i, 'sugars'],
    [/B[łl]onnik\s*\(g\)\s*([\d.,]+\s*g)/i, 'fiber'],
    [/S[óo]l\s*\(g\)\s*([\d.,]+\s*g)/i, 'salt'],
  ];
  for (const [re, key] of patterns) {
    const m = text.match(re);
    if (m) macros[key] = m[1].trim();
  }
  return macros;
}

export function extractProductPageInfoFromHtml(html: string): ProductPageInfo {
  const $ = load(html);
  const name = normalizeWhitespace($('h1').first().text()) || '?';
  const price = normalizeWhitespace($('[class*="price"], [class*="Price"]').first().text());
  const bodyText = normalizeWhitespace($('body').text());

  let weight: string | null = null;
  const weightEl = $('.new-product-page__grammage-gross-parameter strong').first();
  if (weightEl.length) {
    weight = normalizeWhitespace(weightEl.text());
  }
  if (!weight) {
    const titleText = $('title').text();
    const titleMatch = titleText.match(/(\d+(?:[.,]\d+)?\s*(?:g|ml|kg|l|szt\.?|pcs))\b/i);
    if (titleMatch) weight = titleMatch[1].trim();
  }

  let ingredients: string | null = null;
  const skladBlockText = findExpandableBlockText($, 'Skład i alergeny');
  if (skladBlockText.length > 5) {
    ingredients = skladBlockText;
  } else {
    const skladColon = bodyText.match(/Sk[łl]ad\s*[:：]\s*([^\n]{5,})/i);
    if (skladColon) {
      ingredients = normalizeWhitespace(skladColon[1]);
    } else {
      const skladSection = bodyText.match(/Sk[łl]ad i alergeny[\s\S]{0,60}\s+([^\n]{5,})/i);
      if (skladSection) ingredients = normalizeWhitespace(skladSection[1]);
    }
  }

  const nutritionText = findExpandableBlockText($, 'Wartości odżywcze');
  let macros = extractMacrosFromText(nutritionText);

  if (Object.keys(macros).length === 0) {
    const extractMacro = (labelRaw: string, valueRaw: string): void => {
      const label = normalizeWhitespace(labelRaw).toLowerCase();
      const value = normalizeWhitespace(valueRaw);
      if (!label || !value) return;
      for (const [key, canonical] of MACRO_KEY_MAP) {
        if (label.includes(key) && !macros[canonical]) {
          macros[canonical] = value;
          break;
        }
      }
    };

    $('tr').each((_, tr) => {
      const cells = $(tr).find('td, th');
      if (cells.length >= 2) {
        extractMacro($(cells[0]).text(), $(cells[1]).text());
      }
    });

    $('dt').each((_, dt) => {
      const dd = $(dt).next('dd');
      if (dd.length) extractMacro($(dt).text(), dd.text());
    });

    $('div, span, p, li').each((_, el) => {
      const current = $(el);
      if (current.children().length > 2) return;
      const text = normalizeWhitespace(current.text());
      if (!text || text.length > 60) return;
      const next = current.next();
      if (!next.length || next.children().length > 2) return;
      extractMacro(text, next.text());
    });
  }

  if (!macros.kcal) {
    const kcalMatch = bodyText.match(/(\d+(?:[.,]\d+)?)\s*kcal/i);
    if (kcalMatch) macros.kcal = `${kcalMatch[1]} kcal`;
  }

  return { name, price, weight, ingredients, macros };
}

export interface SearchNavigateResult {
  foundName: string;
  foundPrice?: string;
  foundWeight?: string;
  addButton: import('playwright').Locator | null;
  unavailable?: boolean;
  alternatives?: Array<{ name: string; price: string; weight: string }>;
}

export async function searchNavigateAndCache(
  page: Page,
  query: string
): Promise<SearchNavigateResult> {
  await page.getByRole('textbox', { name: 'Wyszukaj' }).click();
  const searchInput = page.getByRole('textbox', { name: 'Jakiego produktu szukasz?' });
  await searchInput.fill(query);
  await searchInput.press('Enter');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2_000);

  const searchPageInfo = await page.evaluate(() => {
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
      .slice(0, 10);

    return boxes.map(box => {
      const nameEl = box.querySelector<HTMLAnchorElement>('a[title]');
      const name = nameEl ? nameEl.title : '?';
      const link = box.querySelector<HTMLAnchorElement>('a[href*="/pid,"][title]');
      const href = link ? link.href : null;

      const priceEl = box.querySelector<HTMLElement>('[class*="price"], [class*="Price"]');
      const price = priceEl ? priceEl.innerText.trim().replace(/\s+/g, ' ') : '';

      let weight = '';
      const weightEl = box.querySelector<HTMLElement>('.f-pc-weight__text');
      if (weightEl) {
        const raw = weightEl.innerText.trim().replace(/\s+/g, ' ');
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

      return { name, href, price, weight, unavailable };
    });
  }) as Array<{ name: string; href: string | null; price: string; weight: string; unavailable: boolean }>;

  if (!searchPageInfo.length) {
    return { foundName: query, addButton: null };
  }

  const first = searchPageInfo[0];

  if (first.unavailable) {
    const alternatives = searchPageInfo
      .filter(p => !p.unavailable && p.href)
      .slice(0, 5)
      .map(p => ({ name: p.name, price: p.price, weight: p.weight }));

    return {
      foundName: first.name,
      foundPrice: first.price,
      foundWeight: first.weight || undefined,
      addButton: null,
      unavailable: true,
      alternatives,
    };
  }

  const productUrl = first.href;
  if (!productUrl) {
    return {
      foundName: query,
      foundPrice: first.price,
      foundWeight: first.weight || undefined,
      addButton: null,
    };
  }

  const fullUrl = productUrl.startsWith('http')
    ? productUrl
    : 'https://www.frisco.pl' + productUrl;

  const productLinkCandidates = [
    page.locator(`#products-list .product-box_holder a[href="${productUrl}"][title]`).first(),
    page.locator(`#products-list .product-box_holder a[href*="/pid,"][title="${first.name}"]`).first(),
    page.locator('#products-list .product-box_holder a[href*="/pid,"][title]').first(),
  ];

  let openedViaResultClick = false;
  for (const link of productLinkCandidates) {
    const visible = await link.isVisible({ timeout: 1_000 }).catch(() => false);
    if (!visible) continue;
    try {
      await Promise.all([
        page.waitForLoadState('domcontentloaded'),
        link.click({ timeout: 2_000 }),
      ]);
      openedViaResultClick = true;
      break;
    } catch {
      // Try next link variant.
    }
  }

  if (!openedViaResultClick) {
    await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
  }
  await page.waitForTimeout(2_000);

  for (const label of ['Wartości odżywcze', 'Skład i alergeny']) {
    try {
      await page.getByText(label, { exact: true }).first().click({ timeout: 2_000 });
      await page.waitForTimeout(800);
    } catch {}
  }

  await page.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight);
  });
  await page.waitForTimeout(1_000);

  let foundName = query;
  let foundPrice = first.price;
  let foundWeight = first.weight || undefined;
  try {
    const html = await page.content();
    const info = extractProductPageInfoFromHtml(html);
    foundName = info.name || query;
    if (info.price) foundPrice = info.price;
    if (info.weight) foundWeight = info.weight;
    const entry: Product = {
      name: foundName,
      url: fullUrl,
      price: info.price,
      weight: info.weight,
      macros: info.macros,
      ingredients: info.ingredients,
    };
    productCache.set(query, entry);
    productCache.set(foundName, entry);
  } catch {}

  const doKoszykaButtons = page.getByText('Do koszyka');
  const count = await doKoszykaButtons.count();
  for (let i = 0; i < count; i++) {
    const btn = doKoszykaButtons.nth(i);
    if (await btn.isVisible()) {
      return { foundName, foundPrice, foundWeight, addButton: btn };
    }
  }

  return { foundName, foundPrice, foundWeight, addButton: null };
}

export function extractCartIssuesFromHtml(html: string): CartIssue[] {
  const $ = load(html);
  const issues: CartIssue[] = [];

  $('.unallowed-products .mini-product-box_wrapper').each((_, wrapper) => {
    const box = $(wrapper);
    const nameEl = box.find('a[title]').first();
    const name = nameEl.attr('title') || '?';

    const weightEl = box.find('.f-pc-weight__text').first();
    const weight = normalizeWhitespace(weightEl.text()) || '';

    const reasonEl = box.find('.unavailable-info').first();
    const reason = normalizeWhitespace(reasonEl.text()) || 'Wyprzedany';

    issues.push({ name, weight, reason, substitutes: [] });
  });

  $('.substitute-item').each((_, item) => {
    const el = $(item);
    const nameEl = el.find('.substitute-item__content-description [title]').first();
    const unavailName = nameEl.attr('title') || '?';
    const reasonEl = el.find('.horizontal-product-box__unavailable-variant').first();
    const reason = normalizeWhitespace(reasonEl.text()) || 'Niedostępny';

    const weightEl = el.find('.weight').first();
    const weight = normalizeWhitespace(weightEl.text()) || '';

    const substitutes: CartIssue['substitutes'] = [];
    el.find('.substitute-item__collapse .product-box_holder').each((_, sub) => {
      const subBox = $(sub);
      const subNameEl = subBox.find('a[title]').first();
      const subName = subNameEl.attr('title') || '?';
      const subPriceEl = subBox.find('[class*="price"]').first();
      const subPrice = normalizeWhitespace(subPriceEl.text());

      let subWeight = '';
      const subWeightEl = subBox.find('.f-pc-weight__text').first();
      if (subWeightEl.length) {
        const raw = normalizeWhitespace(subWeightEl.text());
        const wm = raw.match(/^~?([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs)\b)/i);
        if (wm) subWeight = wm[1];
      }
      if (!subWeight) {
        const imgEl = subBox.find('img[alt]').first();
        const alt = imgEl.attr('alt') || '';
        const am = alt.match(/([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs))\s*$/i);
        if (am) subWeight = am[1].replace(/\u00a0/g, ' ');
      }

      substitutes.push({ name: subName, price: subPrice, weight: subWeight });
    });

    const existing = issues.find(i => i.name === unavailName);
    if (existing) {
      existing.substitutes = substitutes;
    } else {
      issues.push({ name: unavailName, weight, reason, substitutes });
    }
  });

  return issues;
}

export function extractReviewsFromHtml(html: string): ProductReviews {
  const $ = load(html);
  const productName = normalizeWhitespace($('h1').first().text()) || '?';

  let averageGrade = 0;
  const gradeEl = $('[data-tm-review-grade]').first();
  if (gradeEl.length) {
    averageGrade = parseFloat(gradeEl.attr('data-tm-review-grade') || '0');
  }

  let totalReviews = 0;
  const reviewCountText = normalizeWhitespace($('.hydra-grade__reviews-count, .tm-hydra__r0').first().text());
  const countMatch = reviewCountText.match(/(\d+)/);
  if (countMatch) totalReviews = parseInt(countMatch[1], 10);

  const reviews: Review[] = [];
  const tmReviewsEl = $('[data-tm-reviews]').first();
  if (tmReviewsEl.length) {
    try {
      const rawJson = tmReviewsEl.attr('data-tm-reviews') || '[]';
      const parsed = JSON.parse(rawJson) as Array<{
        grade?: number;
        body?: string;
        author?: { name?: string };
        createdAt?: string;
        verified?: boolean;
      }>;
      for (const r of parsed) {
        reviews.push({
          grade: r.grade ?? 0,
          body: r.body ?? '',
          author: r.author?.name ?? 'Anonim',
          date: r.createdAt ?? '',
          verified: r.verified ?? false,
        });
      }
    } catch {}
  }

  if (!totalReviews && reviews.length) totalReviews = reviews.length;

  return { productName, averageGrade, totalReviews, reviews };
}

export function extractPromotionsFromHtml(html: string): {
  totalSavings: string;
  promotions: CartPromotion[];
} {
  const $ = load(html);

  const savingsEl = $('.saving-counter_summary').first();
  const totalSavings = normalizeWhitespace(savingsEl.text()) || '0 zł';

  const promotions: CartPromotion[] = [];

  $('.mini-product-box_wrapper.in-cart').each((_, wrapper) => {
    const box = $(wrapper);
    const hasPromo = box.find('.with-cart-promo').length > 0 ||
      box.find('[class*="favored-price"]').length > 0;
    if (!hasPromo) return;

    const nameEl = box.find('a[title]').first();
    const productName = nameEl.attr('title') || '?';

    const promoTextEl = box.find('.product-box_badge-slider_item').first();
    const promoText = normalizeWhitespace(promoTextEl.text()) || '';

    const promoPriceEl = box.find('[id*="favored-price"] ~ span[aria-label]').first();
    const promoPrice = promoPriceEl.attr('aria-label') || '';

    const regularPriceEl = box.find('[id*="regular-price"] ~ span[aria-label]').first();
    const regularPrice = regularPriceEl.attr('aria-label') || '';

    promotions.push({ productName, promoText, promoPrice, regularPrice });
  });

  return { totalSavings, promotions };
}

export function formatCartIssues(issues: CartIssue[]): string {
  if (!issues.length) return '✅ Brak problemów w koszyku — wszystkie produkty są dostępne.';

  const lines = [`⚠️ Znaleziono ${issues.length} niedostępny(ch) produkt(ów):\n`];
  for (const issue of issues) {
    const w = issue.weight ? ` [${issue.weight}]` : '';
    lines.push(`❌ ${issue.name}${w} — ${issue.reason}`);
    if (issue.substitutes.length > 0) {
      lines.push(`   Dostępne zamienniki:`);
      for (const sub of issue.substitutes.slice(0, 5)) {
        const sw = sub.weight ? ` [${sub.weight}]` : '';
        const sp = sub.price ? ` | ${sub.price}` : '';
        lines.push(`   - ${sub.name}${sw}${sp}`);
      }
      if (issue.substitutes.length > 5) {
        lines.push(`   ... i ${issue.substitutes.length - 5} więcej`);
      }
    }
  }
  return lines.join('\n');
}

export function formatReviews(data: ProductReviews, limit: number = 5): string {
  const lines = [`⭐ ${data.productName} — ${data.averageGrade}/5 (${data.totalReviews} opinii)\n`];

  if (!data.reviews.length) {
    lines.push('Brak szczegółowych opinii.');
    return lines.join('\n');
  }

  const shown = data.reviews.slice(0, limit);
  for (const r of shown) {
    const stars = '★'.repeat(r.grade) + '☆'.repeat(5 - r.grade);
    const verified = r.verified ? ' ✓' : '';
    const date = r.date ? ` (${r.date.split('T')[0]})` : '';
    lines.push(`${stars}${verified}${date} — ${r.author}`);
    if (r.body) lines.push(`  "${r.body}"`);
  }

  if (data.reviews.length > limit) {
    lines.push(`\n... i ${data.reviews.length - limit} więcej opinii`);
  }

  return lines.join('\n');
}

export function formatPromotions(data: { totalSavings: string; promotions: CartPromotion[] }): string {
  const lines = [`💰 Oszczędności za promocje: ${data.totalSavings}\n`];

  if (!data.promotions.length) {
    lines.push('Brak aktywnych promocji w koszyku.');
    return lines.join('\n');
  }

  lines.push(`🏷️ Produkty z promocją (${data.promotions.length}):\n`);
  for (const p of data.promotions) {
    lines.push(`- ${p.productName}`);
    if (p.promoText) lines.push(`  📌 ${p.promoText}`);
    if (p.promoPrice && p.regularPrice) {
      lines.push(`  💵 ${p.promoPrice} (zamiast ${p.regularPrice})`);
    } else if (p.promoPrice) {
      lines.push(`  💵 ${p.promoPrice}`);
    }
  }

  return lines.join('\n');
}

export function formatProductInfo(product: Product): string {
  const lines: string[] = [`🛍️ ${product.name}`];
  if (product.url) lines.push(`🔗 URL: ${product.url}`);
  if (product.price) lines.push(`💰 Price: ${product.price}`);
  if (product.weight) lines.push(`📦 Weight: ${product.weight}`);
  lines.push('');

  const macroOrder = ['kcal', 'protein', 'fat', 'carbohydrates', 'sugars', 'fiber', 'salt'];
  if (Object.keys(product.macros).length > 0) {
    lines.push('📊 Nutritional values (per 100g):');
    for (const key of macroOrder) {
      if (product.macros[key]) lines.push(`  ${key}: ${product.macros[key]}`);
    }
    for (const [key, val] of Object.entries(product.macros)) {
      if (!macroOrder.includes(key) && val) lines.push(`  ${key}: ${val}`);
    }
  } else {
    lines.push('📊 No nutritional data available.');
  }

  lines.push('');
  if (product.ingredients) {
    lines.push(`🧪 Ingredients: ${product.ingredients}`);
  } else {
    lines.push('🧪 No ingredient information available.');
  }

  return lines.join('\n');
}

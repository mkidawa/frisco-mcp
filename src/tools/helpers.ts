import type { Page } from 'playwright';
import { load } from 'cheerio';
import type { Product, ProductPageInfo } from '../types.js';
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

export async function searchNavigateAndCache(
  page: Page,
  query: string
): Promise<{ foundName: string; addButton: import('playwright').Locator | null }> {
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
      const rect = el.getBoundingClientRect();
      return rect.left <= window.innerWidth * 0.65;
    }

    const link = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href*="/pid,"][title]'))
      .find(el => el.offsetParent !== null && notInSidebar(el));
    return link ? link.href : null;
  });

  if (!productUrl) return { foundName: query, addButton: null };

  const fullUrl = productUrl.startsWith('http')
    ? productUrl
    : 'https://www.frisco.pl' + productUrl;

  await page.goto(fullUrl, { waitUntil: 'domcontentloaded' });
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
  try {
    const html = await page.content();
    const info = extractProductPageInfoFromHtml(html);
    foundName = info.name || query;
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
      return { foundName, addButton: btn };
    }
  }

  return { foundName, addButton: null };
}

export function formatProductInfo(product: Product): string {
  const lines: string[] = [`🛍️ ${product.name}`];
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

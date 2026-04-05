import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const LIST_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'products_list.html');

function extractProductsFromListHtml(html: string, limit: number = 5) {
  const $ = load(html);
  const results: { name: string; price: string; weight: string }[] = [];

  $('.product-box_holder').each((i, el) => {
    if (results.length >= limit) return false;

    const box = $(el);
    const nameEl = box.find('a[title]').first();
    const name = nameEl.attr('title') || '?';

    const priceEl = box.find('[class*="price"]').first();
    const price = priceEl.text().trim().replace(/\s+/g, ' ');

    let weight = '';
    const weightEl = box.find('.f-pc-weight__text').first();
    if (weightEl.length) {
      const raw = weightEl.text().trim().replace(/\s+/g, ' ');
      const wm = raw.match(/^~?([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs)\b)/i);
      if (wm) weight = wm[1];
    }
    if (!weight) {
      const imgEl = box.find('img[alt]').first();
      const alt = imgEl.attr('alt') || '';
      const am = alt.match(/([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs))\s*$/i);
      if (am) weight = am[1].replace(/\u00a0/g, ' ');
    }

    results.push({ name, price, weight });
  });

  return results;
}

describe('searchProducts weight extraction from products_list.html', () => {
  const html = readFileSync(LIST_HTML_PATH, 'utf-8');
  const products = extractProductsFromListHtml(html, 20);

  it('extracts multiple products', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('most products have weight', () => {
    const withWeight = products.filter(p => p.weight.length > 0);
    expect(withWeight.length).toBeGreaterThan(products.length * 0.5);
  });

  it('weight is in expected format (number + unit)', () => {
    const withWeight = products.filter(p => p.weight.length > 0);
    for (const p of withWeight) {
      expect(p.weight).toMatch(/^~?\d+(?:[.,]\d+)?\s*(?:g|ml|kg|l|szt\.?|pcs)$/i);
    }
  });

  it('extracts pieces (szt) for products sold by count', () => {
    const pieceProducts = products.filter(p => /szt/i.test(p.weight));
    expect(pieceProducts.length).toBeGreaterThan(0);
    for (const p of pieceProducts) {
      expect(p.weight).toMatch(/\d+\s*szt\.?$/i);
    }
  });

  it('each product has a name', () => {
    for (const p of products) {
      expect(p.name).not.toBe('?');
      expect(p.name.length).toBeGreaterThan(0);
    }
  });

  it('logs extracted products for inspection', () => {
    for (const p of products.slice(0, 10)) {
      const w = p.weight ? ` [${p.weight}]` : '';
      console.log(`  ${p.name}${w}`);
    }
  });
});

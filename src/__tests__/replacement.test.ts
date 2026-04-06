import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { load } from 'cheerio';

const REPLACEMENT_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'replacement.html');

interface ProductBoxResult {
  name: string;
  price: string;
  weight: string;
  available: boolean;
}

function extractProductsWithAvailability(html: string, limit: number = 10): ProductBoxResult[] {
  const $ = load(html);
  const results: ProductBoxResult[] = [];

  $('.product-box_holder').each((_, el) => {
    if (results.length >= limit) return false;

    const box = $(el);

    const isMiniCart = box.parents('[class*="cart"], [class*="basket"], [class*="mini-cart"]').length > 0
      || box.hasClass('mini-product-box');
    if (isMiniCart) return;

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

    const unavailable = box.find('.unavailable-info').length > 0 ||
      box.find('article.unavailable').length > 0;

    results.push({ name, price, weight, available: !unavailable });
  });

  return results;
}

describe('replacement.html — product availability detection', () => {
  const html = readFileSync(REPLACEMENT_HTML_PATH, 'utf-8');
  const products = extractProductsWithAvailability(html, 20);

  it('extracts products from the page', () => {
    expect(products.length).toBeGreaterThan(0);
  });

  it('detects at least one unavailable product', () => {
    const unavailable = products.filter(p => !p.available);
    expect(unavailable.length).toBeGreaterThan(0);
  });

  it('detects at least one available product', () => {
    const available = products.filter(p => p.available);
    expect(available.length).toBeGreaterThan(0);
  });

  it('the unavailable product is "FRISCO FRESH Ogórek długi import 1 szt."', () => {
    const unavailable = products.filter(p => !p.available);
    expect(unavailable.some(p => p.name.includes('Ogórek długi import'))).toBe(true);
  });

  it('available alternatives exist alongside unavailable products', () => {
    const unavailable = products.filter(p => !p.available);
    const available = products.filter(p => p.available);
    expect(unavailable.length).toBeGreaterThan(0);
    expect(available.length).toBeGreaterThan(0);
  });

  it('logs products for inspection', () => {
    for (const p of products) {
      const w = p.weight ? ` [${p.weight}]` : '';
      const a = p.available ? '' : ' ⚠️ NIEDOSTĘPNY';
      console.log(`  ${p.name}${w}${a}`);
    }
  });
});

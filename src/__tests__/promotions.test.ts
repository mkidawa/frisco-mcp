import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPromotionsFromHtml, formatPromotions } from '../tools/helpers.js';

const CART_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'cart.html');

describe('extractPromotionsFromHtml from cart.html', () => {
  const html = readFileSync(CART_HTML_PATH, 'utf-8');
  const data = extractPromotionsFromHtml(html);

  it('extracts total savings', () => {
    expect(data.totalSavings).toMatch(/\d/);
  });

  it('the total savings reflect the value in HTML', () => {
    expect(data.totalSavings).toContain('18,68');
  });

  it('extracts promotions', () => {
    expect(data.promotions.length).toBeGreaterThan(0);
  });

  it('each promotion has a product name', () => {
    for (const p of data.promotions) {
      expect(p.productName).not.toBe('?');
      expect(p.productName.length).toBeGreaterThan(0);
    }
  });

  it('formatPromotions produces readable output', () => {
    const output = formatPromotions(data);
    expect(output).toContain('💰');
    expect(output).toContain('18,68');
    console.log(output);
  });
});

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

  it('returns promotion entries in valid shape', () => {
    for (const p of data.promotions) {
      expect(p.productName).not.toBe('?');
      expect(p.productName.length).toBeGreaterThan(0);
    }
  });

  it('formatPromotions produces readable output', () => {
    const output = formatPromotions(data);
    expect(output).toContain('💰');
    if (data.promotions.length > 0) {
      expect(output).toContain('🏷️');
    } else {
      expect(output).toContain('Brak aktywnych promocji');
    }
    console.log(output);
  });
});

describe('extractPromotionsFromHtml with controlled fixture', () => {
  const controlledHtml = `
    <div class="saving-counter_summary">Oszczędzasz 18,68 zł</div>
    <div class="mini-product-box_wrapper in-cart">
      <div class="mini-product-box with-cart-promo">
        <a title="Jogurt naturalny"></a>
        <div class="product-box_badge-slider_item">2+1 gratis</div>
        <span id="favored-price-1"></span><span aria-label="4,99 zł"></span>
        <span id="regular-price-1"></span><span aria-label="6,99 zł"></span>
      </div>
    </div>
  `;
  const data = extractPromotionsFromHtml(controlledHtml);

  it('extracts total savings from summary', () => {
    expect(data.totalSavings).toContain('18,68');
  });

  it('extracts promoted products', () => {
    expect(data.promotions.length).toBeGreaterThan(0);
    expect(data.promotions[0].productName).toContain('Jogurt');
  });

  it('formats promotions with prices', () => {
    const output = formatPromotions(data);
    expect(output).toContain('Jogurt');
    expect(output).toContain('4,99 zł');
    expect(output).toContain('6,99 zł');
  });
});

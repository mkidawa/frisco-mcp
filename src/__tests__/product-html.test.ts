import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractProductPageInfoFromHtml } from '../tools/helpers.js';

const PRODUCT_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'product.html');

describe('extractProductPageInfoFromHtml with real frisco.pl HTML', () => {
  const html = readFileSync(PRODUCT_HTML_PATH, 'utf-8');
  const info = extractProductPageInfoFromHtml(html);

  it('extracts product name', () => {
    expect(info.name).toContain('Skyr');
    expect(info.name).toContain('PIĄTNICA');
  });

  it('extracts weight/grammage', () => {
    expect(info.weight).not.toBeNull();
    expect(info.weight).toMatch(/\d/);
    expect(info.weight).toMatch(/(g|ml|kg|l|szt\.?)/i);
  });

  it('extracts kcal', () => {
    expect(info.macros.kcal).toBeDefined();
    expect(info.macros.kcal).toMatch(/\d/);
    expect(info.macros.kcal).toMatch(/kcal/i);
  });

  it('extracts protein', () => {
    expect(info.macros.protein).toBeDefined();
    expect(info.macros.protein).toMatch(/\d/);
    expect(info.macros.protein).toMatch(/g/i);
  });

  it('extracts fat', () => {
    expect(info.macros.fat).toBeDefined();
    expect(info.macros.fat).toContain('0');
  });

  it('extracts carbohydrates', () => {
    expect(info.macros.carbohydrates).toBeDefined();
    expect(info.macros.carbohydrates).toMatch(/\d/);
    expect(info.macros.carbohydrates).toMatch(/g/i);
  });

  it('extracts sugars', () => {
    expect(info.macros.sugars).toBeDefined();
    expect(info.macros.sugars).toMatch(/\d/);
    expect(info.macros.sugars).toMatch(/g/i);
  });

  it('extracts salt', () => {
    expect(info.macros.salt).toBeDefined();
    expect(info.macros.salt).toContain('0');
  });

  it('extracts price', () => {
    expect(info.price).toBeDefined();
    expect(info.price.length).toBeGreaterThan(0);
  });
});

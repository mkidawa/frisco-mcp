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
    expect(info.weight).toContain('150');
    expect(info.weight).toContain('g');
  });

  it('extracts kcal', () => {
    expect(info.macros.kcal).toBeDefined();
    expect(info.macros.kcal).toContain('64');
    expect(info.macros.kcal).toContain('kcal');
  });

  it('extracts protein', () => {
    expect(info.macros.protein).toBeDefined();
    expect(info.macros.protein).toContain('12');
  });

  it('extracts fat', () => {
    expect(info.macros.fat).toBeDefined();
    expect(info.macros.fat).toContain('0');
  });

  it('extracts carbohydrates', () => {
    expect(info.macros.carbohydrates).toBeDefined();
    expect(info.macros.carbohydrates).toContain('4');
  });

  it('extracts sugars', () => {
    expect(info.macros.sugars).toBeDefined();
    expect(info.macros.sugars).toContain('4');
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

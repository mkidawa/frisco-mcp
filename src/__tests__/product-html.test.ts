import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractProductPageInfoFromHtml } from '../tools/helpers.js';

const productsDir = join(__dirname, '..', '..', 'test_data', 'products');

function loadProduct(filename: string) {
  const html = readFileSync(join(productsDir, filename), 'utf-8');
  return extractProductPageInfoFromHtml(html);
}

describe('extractProductPageInfoFromHtml', () => {
  describe('skyr.html — dairy with full nutrition (gauge format)', () => {
    const info = loadProduct('skyr.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Skyr');
      expect(info.name).toContain('PIĄTNICA');
    });

    it('extracts price from schema.org meta', () => {
      expect(info.price).toBe('5,95 zł');
    });

    it('extracts weight in ml', () => {
      expect(info.weight).toBe('330 ml');
    });

    it('extracts kcal from gauge', () => {
      expect(info.macros.kcal).toBe('64.00 kcal');
    });

    it('extracts protein', () => {
      expect(info.macros.protein).toBe('7.60 g');
    });

    it('extracts fat', () => {
      expect(info.macros.fat).toBe('1.80 g');
    });

    it('extracts carbohydrates', () => {
      expect(info.macros.carbohydrates).toBe('4.30 g');
    });

    it('extracts sugars', () => {
      expect(info.macros.sugars).toBe('3.90 g');
    });

    it('extracts salt', () => {
      expect(info.macros.salt).toBe('0.10 g');
    });

    it('has no fiber (not listed on page)', () => {
      expect(info.macros.fiber).toBeUndefined();
    });

    it('has no ingredients (collapsed section with no content in DOM)', () => {
      expect(info.ingredients).toBeNull();
    });
  });

  describe('chicken.html — meat with empty nutrition table and brandbank ingredients', () => {
    const info = loadProduct('chicken.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Filet z piersi z kurczaka');
      expect(info.name).toContain('FRISCO FRESH');
    });

    it('extracts price', () => {
      expect(info.price).toBe('16,29 zł');
    });

    it('extracts approximate weight', () => {
      expect(info.weight).toBe('500 g');
    });

    it('has no macros (table cells are empty)', () => {
      expect(Object.keys(info.macros).length).toBe(0);
    });

    it('extracts ingredients from brandbank', () => {
      expect(info.ingredients).not.toBeNull();
      expect(info.ingredients).toContain('Mięso z kurczaka 100%');
    });
  });

  describe('bananas.html — fruit with partial nutrition gauges', () => {
    const info = loadProduct('bananas.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Banany');
      expect(info.name).toContain('FRISCO FRESH');
    });

    it('extracts price', () => {
      expect(info.price).toBe('6,59 zł');
    });

    it('extracts approximate weight in kg', () => {
      expect(info.weight).toBe('1 kg');
    });

    it('extracts kcal', () => {
      expect(info.macros.kcal).toBe('90.00 kcal');
    });

    it('extracts protein', () => {
      expect(info.macros.protein).toBe('1.00 g');
    });

    it('extracts fat', () => {
      expect(info.macros.fat).toBe('0.30 g');
    });

    it('extracts carbohydrates', () => {
      expect(info.macros.carbohydrates).toBe('23.50 g');
    });

    it('has no sugars (not listed)', () => {
      expect(info.macros.sugars).toBeUndefined();
    });

    it('has no ingredients (no section)', () => {
      expect(info.ingredients).toBeNull();
    });
  });

  describe('eggs.html — sold by piece, no nutrition, no ingredients', () => {
    const info = loadProduct('eggs.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Jaja kurze');
      expect(info.name).toContain('WYBIEGANE KURY');
    });

    it('extracts price', () => {
      expect(info.price).toBe('13,49 zł');
    });

    it('extracts weight as pieces', () => {
      expect(info.weight).toBe('1 szt');
    });

    it('has no macros', () => {
      expect(Object.keys(info.macros).length).toBe(0);
    });

    it('has no ingredients', () => {
      expect(info.ingredients).toBeNull();
    });
  });

  describe('bag.html — non-food item, zero nutrition values', () => {
    const info = loadProduct('bag.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Worki na śmieci');
      expect(info.name).toContain('JAN NIEZBĘDNY');
    });

    it('extracts price', () => {
      expect(info.price).toBe('10,99 zł');
    });

    it('extracts weight as pieces', () => {
      expect(info.weight).toBe('1 szt');
    });

    it('has no macros (all values are 0.00)', () => {
      expect(Object.keys(info.macros).length).toBe(0);
    });

    it('has no ingredients', () => {
      expect(info.ingredients).toBeNull();
    });
  });

  describe('promotion.html — cheese with full nutrition gauges', () => {
    const info = loadProduct('promotion.html');

    it('extracts product name', () => {
      expect(info.name).toContain('Mascarpone');
      expect(info.name).toContain('GALBANI');
    });

    it('extracts price', () => {
      expect(info.price).toBe('7,49 zł');
    });

    it('extracts weight in grams', () => {
      expect(info.weight).toBe('250 g');
    });

    it('extracts kcal', () => {
      expect(info.macros.kcal).toBe('392.00 kcal');
    });

    it('extracts fat', () => {
      expect(info.macros.fat).toBe('40.00 g');
    });

    it('extracts carbohydrates', () => {
      expect(info.macros.carbohydrates).toBe('4.90 g');
    });

    it('extracts sugars', () => {
      expect(info.macros.sugars).toBe('4.90 g');
    });

    it('extracts protein', () => {
      expect(info.macros.protein).toBe('3.40 g');
    });

    it('extracts salt', () => {
      expect(info.macros.salt).toBe('0.13 g');
    });

    it('has no ingredients (collapsed section, no content in DOM)', () => {
      expect(info.ingredients).toBeNull();
    });
  });
});

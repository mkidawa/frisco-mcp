import { describe, it, expect } from 'vitest';
import type { Macros, CartItem, Product, ProductPageInfo } from '../types.js';

describe('type interfaces', () => {
  it('Macros uses English field names', () => {
    const macros: Macros = {
      kcal: '100 kcal',
      protein: '10 g',
      fat: '5 g',
      carbohydrates: '20 g',
      sugars: '8 g',
      fiber: '3 g',
      salt: '0.5 g',
    };
    expect(macros.protein).toBe('10 g');
    expect(macros.fat).toBe('5 g');
    expect(macros.carbohydrates).toBe('20 g');
    expect(macros.sugars).toBe('8 g');
    expect(macros.fiber).toBe('3 g');
    expect(macros.salt).toBe('0.5 g');
  });

  it('Macros supports index signature for extra fields', () => {
    const macros: Macros = { 'vitamin-c': '50 mg' };
    expect(macros['vitamin-c']).toBe('50 mg');
  });

  it('CartItem structure is correct', () => {
    const item: CartItem = { name: 'Milk', searchQuery: 'mleko 2%', quantity: 2 };
    expect(item.name).toBe('Milk');
    expect(item.searchQuery).toBe('mleko 2%');
    expect(item.quantity).toBe(2);
  });

  it('CartItem has optional fields', () => {
    const item: CartItem = { name: 'Bread' };
    expect(item.searchQuery).toBeUndefined();
    expect(item.quantity).toBeUndefined();
  });

  it('Product structure includes all fields', () => {
    const product: Product = {
      name: 'Milk',
      url: 'https://frisco.pl/pid,1',
      price: '5,99 zł',
      macros: { kcal: '64 kcal' },
      ingredients: 'pasteurized milk',
    };
    expect(product.url).toContain('frisco.pl');
  });

  it('ProductPageInfo matches expected shape', () => {
    const info: ProductPageInfo = {
      name: 'Butter',
      price: '8,99 zł',
      ingredients: 'cream, salt',
      macros: { fat: '82 g' },
      weight: null,
    };
    expect(info.macros.fat).toBe('82 g');
  });
});

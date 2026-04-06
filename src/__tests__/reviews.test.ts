import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractReviewsFromHtml, formatReviews } from '../tools/helpers.js';

const PRODUCT_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'products', 'skyr.html');

describe('extractReviewsFromHtml from product.html', () => {
  const html = readFileSync(PRODUCT_HTML_PATH, 'utf-8');
  const data = extractReviewsFromHtml(html);

  it('extracts product name', () => {
    expect(data.productName).not.toBe('?');
    expect(data.productName.length).toBeGreaterThan(0);
  });

  it('extracts average grade', () => {
    expect(data.averageGrade).toBeGreaterThan(0);
    expect(data.averageGrade).toBeLessThanOrEqual(5);
  });

  it('extracts reviews from data-tm-reviews JSON', () => {
    expect(data.reviews.length).toBeGreaterThan(0);
  });

  it('each review has grade, body, and author', () => {
    for (const r of data.reviews) {
      expect(r.grade).toBeGreaterThanOrEqual(1);
      expect(r.grade).toBeLessThanOrEqual(5);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.author.length).toBeGreaterThan(0);
    }
  });

  it('reviews have dates', () => {
    const withDates = data.reviews.filter(r => r.date.length > 0);
    expect(withDates.length).toBeGreaterThan(0);
  });

  it('formatReviews produces readable output', () => {
    const output = formatReviews(data, 3);
    expect(output).toContain('⭐');
    expect(output).toContain('/5');
    expect(output).toContain('★');
    console.log(output);
  });
});

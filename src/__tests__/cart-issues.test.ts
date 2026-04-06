import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCartIssuesFromHtml, formatCartIssues } from '../tools/helpers.js';

const CART_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'cart.html');

describe('extractCartIssuesFromHtml from cart.html', () => {
  const html = readFileSync(CART_HTML_PATH, 'utf-8');
  const issues = extractCartIssuesFromHtml(html);

  it('detects unavailable products', () => {
    expect(issues.length).toBeGreaterThan(0);
  });

  it('extracts the sold-out product name', () => {
    expect(issues.some(i => i.name.includes('Ogórek'))).toBe(true);
  });

  it('extracts the unavailability reason', () => {
    for (const issue of issues) {
      expect(issue.reason.length).toBeGreaterThan(0);
    }
  });

  it('finds substitutes for unavailable products', () => {
    const withSubs = issues.filter(i => i.substitutes.length > 0);
    expect(withSubs.length).toBeGreaterThan(0);
  });

  it('substitute has name', () => {
    const withSubs = issues.filter(i => i.substitutes.length > 0);
    for (const issue of withSubs) {
      for (const sub of issue.substitutes) {
        expect(sub.name).not.toBe('?');
        expect(sub.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('formatCartIssues produces readable output', () => {
    const output = formatCartIssues(issues);
    expect(output).toContain('⚠️');
    expect(output).toContain('Ogórek');
    console.log(output);
  });

  it('formatCartIssues returns OK message when no issues', () => {
    const output = formatCartIssues([]);
    expect(output).toContain('✅');
  });
});

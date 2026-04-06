import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { extractCartIssuesFromHtml, formatCartIssues } from '../tools/helpers.js';

const CART_HTML_PATH = join(__dirname, '..', '..', 'test_data', 'cart.html');

describe('extractCartIssuesFromHtml from cart.html', () => {
  const html = readFileSync(CART_HTML_PATH, 'utf-8');
  const issues = extractCartIssuesFromHtml(html);

  it('returns a valid issues array shape', () => {
    expect(Array.isArray(issues)).toBe(true);
    for (const issue of issues) {
      expect(issue.name.length).toBeGreaterThan(0);
      expect(issue.reason.length).toBeGreaterThan(0);
      expect(Array.isArray(issue.substitutes)).toBe(true);
    }
  });

  it('substitutes in parsed issues have valid names', () => {
    for (const issue of issues) {
      for (const sub of issue.substitutes) {
        expect(sub.name).not.toBe('?');
        expect(sub.name.length).toBeGreaterThan(0);
      }
    }
  });

  it('formatCartIssues produces readable output for real fixture', () => {
    const output = formatCartIssues(issues);
    if (issues.length > 0) {
      expect(output).toContain('⚠️');
    } else {
      expect(output).toContain('✅');
    }
    console.log(output);
  });

  it('formatCartIssues returns OK message when no issues', () => {
    const output = formatCartIssues([]);
    expect(output).toContain('✅');
  });
});

describe('extractCartIssuesFromHtml with controlled fixture', () => {
  const controlledHtml = `
    <div class="unallowed-products">
      <div class="mini-product-box_wrapper">
        <a title="Ogórek świeży"></a>
        <div class="f-pc-weight__text">500 g</div>
        <div class="unavailable-info">Wyprzedany</div>
      </div>
    </div>
    <div class="substitute-item">
      <div class="substitute-item__content-description">
        <a title="Ogórek świeży"></a>
      </div>
      <div class="horizontal-product-box__unavailable-variant">Niedostępny</div>
      <div class="weight">500 g</div>
      <div class="substitute-item__collapse">
        <div class="product-box_holder">
          <a title="Ogórek szklarniowy"></a>
          <div class="f-pc-weight__text">500 g</div>
          <div class="price">6,99 zł</div>
        </div>
      </div>
    </div>
  `;
  const issues = extractCartIssuesFromHtml(controlledHtml);

  it('extracts unavailable product with reason', () => {
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.name.includes('Ogórek'))).toBe(true);
    expect(issues.some((i) => i.reason.length > 0)).toBe(true);
  });

  it('extracts substitutes for unavailable product', () => {
    const withSubs = issues.filter((i) => i.substitutes.length > 0);
    expect(withSubs.length).toBeGreaterThan(0);
    expect(withSubs[0].substitutes[0].name).toContain('Ogórek');
  });

  it('formatCartIssues includes warning section for unavailable products', () => {
    const output = formatCartIssues(issues);
    expect(output).toContain('⚠️');
    expect(output).toContain('Ogórek');
  });
});

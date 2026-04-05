import { describe, it, expect } from "vitest";
import {
  extractProductPageInfoFromHtml,
  formatProductInfo,
} from "../tools/helpers.js";
import type { Product } from "../types.js";

describe("extractProductPageInfoFromHtml", () => {
  it("extracts product name from h1", () => {
    const html = "<html><body><h1>Mleko UHT 2%</h1></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(info.name).toBe("Mleko UHT 2%");
  });

  it('returns "?" when no h1 is present', () => {
    const html = "<html><body><p>No heading</p></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(info.name).toBe("?");
  });

  it("extracts price from element with price class", () => {
    const html = `
      <html><body>
        <h1>Test Product</h1>
        <span class="product-price">12,99 zł</span>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.price).toBe("12,99 zł");
  });

  it('extracts ingredients from "Skład:" pattern', () => {
    const html = `
      <html><body>
        <h1>Chocolate</h1>
        <p>Skład: mleko, cukier, kakao, lecytyna</p>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).toContain("mleko");
    expect(info.ingredients).toContain("cukier");
  });

  it('extracts ingredients from "Skład i alergeny" pattern', () => {
    const html = `
      <html><body>
        <h1>Yogurt</h1>
        <div>Skład i alergeny</div>
        <p>mleko pasteryzowane, kultury bakterii</p>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).not.toBeNull();
  });

  it("returns null ingredients when not found", () => {
    const html = "<html><body><h1>Mystery Product</h1></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).toBeNull();
  });

  it("extracts macros from table rows", () => {
    const html = `
      <html><body>
        <h1>Butter</h1>
        <table>
          <tr><td>Energia</td><td>740 kcal</td></tr>
          <tr><td>Białko</td><td>0,8 g</td></tr>
          <tr><td>Tłuszcz</td><td>82 g</td></tr>
          <tr><td>Węglowodany</td><td>0,7 g</td></tr>
          <tr><td>Cukry</td><td>0,7 g</td></tr>
          <tr><td>Błonnik</td><td>0 g</td></tr>
          <tr><td>Sól</td><td>0,02 g</td></tr>
        </table>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.kcal).toBe("740 kcal");
    expect(info.macros.protein).toBe("0,8 g");
    expect(info.macros.fat).toBe("82 g");
    expect(info.macros.carbohydrates).toBe("0,7 g");
    expect(info.macros.sugars).toBe("0,7 g");
    expect(info.macros.fiber).toBe("0 g");
    expect(info.macros.salt).toBe("0,02 g");
  });

  it("extracts macros from dt/dd pairs", () => {
    const html = `
      <html><body>
        <h1>Milk</h1>
        <dl>
          <dt>Białko</dt><dd>3,2 g</dd>
          <dt>Tłuszcz</dt><dd>2,0 g</dd>
        </dl>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.protein).toBe("3,2 g");
    expect(info.macros.fat).toBe("2,0 g");
  });

  it("extracts kcal from body text as fallback", () => {
    const html = `
      <html><body>
        <h1>Energy Drink</h1>
        <p>Contains 45 kcal per serving</p>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.kcal).toBe("45 kcal");
  });

  it("handles ASCII-only Polish variants in macros", () => {
    const html = `
      <html><body>
        <h1>Test</h1>
        <table>
          <tr><td>Bialko</td><td>10 g</td></tr>
          <tr><td>Tluszcz</td><td>5 g</td></tr>
          <tr><td>Wegglowodany</td><td>20 g</td></tr>
          <tr><td>Blonnik</td><td>3 g</td></tr>
        </table>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.protein).toBe("10 g");
    expect(info.macros.fat).toBe("5 g");
    expect(info.macros.fiber).toBe("3 g");
  });

  it("normalizes whitespace in extracted values", () => {
    const html = `
      <html><body>
        <h1>  Spaced   Product   Name  </h1>
        <span class="price">  12,99   zł  </span>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.name).toBe("Spaced Product Name");
    expect(info.price).toBe("12,99 zł");
  });

  it("returns empty macros when no nutritional data", () => {
    const html = "<html><body><h1>Plain Product</h1></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(Object.keys(info.macros)).toHaveLength(0);
  });

  it("returns null weight when not available", () => {
    const html = "<html><body><h1>Product</h1></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBeNull();
  });

  it("extracts weight from grammage-gross-parameter", () => {
    const html = `
      <html><body>
        <h1>Skyr</h1>
        <div class="new-product-page__grammage-gross-parameter">
          <div>Waga:</div><strong>150&nbsp;g</strong>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("150 g");
  });

  it("extracts weight from title as fallback", () => {
    const html = `
      <html>
        <head><title>Mleko UHT 2% 1l - Frisco.pl</title></head>
        <body><h1>Mleko UHT 2%</h1></body>
      </html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("1l");
  });

  it("extracts macros from expandable-block nutritional text", () => {
    const html = `
      <html><body>
        <h1>Skyr</h1>
        <section class="expandable-block">
          <header><div class="expandable-block_info"><div class="expandable-block_copy">
            <h5 class="expandable-block_copy-title">Wartości odżywcze</h5>
          </div></div></header>
          <div class="expandable-block_content">
            Wartość energetyczna (kJ)274.00 kJ3.3%
            Wartość energetyczna (kcal)64.00 kcal3.2%
            Tłuszcz (g)0.00 g0.0%
            w tym kwasy tłuszczowe nasycone (g)0.00 g0.0%
            Węglowodany (g)4.10 g1.6%
            w tym cukry (g)4.10 g4.6%
            Białko (g)12.00 g24.0%
            Sól (g)0.10 g1.7%
          </div>
        </section>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.kcal).toBe("64.00 kcal");
    expect(info.macros.fat).toBe("0.00 g");
    expect(info.macros.carbohydrates).toBe("4.10 g");
    expect(info.macros.sugars).toBe("4.10 g");
    expect(info.macros.protein).toBe("12.00 g");
    expect(info.macros.salt).toBe("0.10 g");
  });

  it("extracts ingredients from expandable-block section", () => {
    const html = `
      <html><body>
        <h1>Yogurt</h1>
        <section class="expandable-block">
          <header><div class="expandable-block_info"><div class="expandable-block_copy">
            <h5 class="expandable-block_copy-title">Skład i alergeny</h5>
          </div></div></header>
          <div class="expandable-block_content">
            mleko pasteryzowane odtłuszczone, kultury bakterii fermentacji mlekowej
          </div>
        </section>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).toContain("mleko pasteryzowane");
    expect(info.ingredients).toContain("kultury bakterii");
  });
});

describe("formatProductInfo", () => {
  it("formats product with all fields", () => {
    const product: Product = {
      name: "Test Milk",
      url: "https://frisco.pl/test",
      price: "5,99 zł",
      weight: "500 ml",
      macros: { kcal: "64 kcal", protein: "3,2 g", fat: "2,0 g" },
      ingredients: "milk, vitamins",
    };
    const result = formatProductInfo(product);
    expect(result).toContain("Test Milk");
    expect(result).toContain("5,99 zł");
    expect(result).toContain("500 ml");
    expect(result).toContain("kcal: 64 kcal");
    expect(result).toContain("protein: 3,2 g");
    expect(result).toContain("fat: 2,0 g");
    expect(result).toContain("milk, vitamins");
  });

  it("shows no nutritional data message when macros empty", () => {
    const product: Product = {
      name: "Unknown",
      url: "https://frisco.pl/x",
      price: "",
      macros: {},
    };
    const result = formatProductInfo(product);
    expect(result).toContain("No nutritional data available");
  });

  it("shows no ingredients message when null", () => {
    const product: Product = {
      name: "No Ingredients",
      url: "https://frisco.pl/x",
      price: "1,00 zł",
      macros: {},
      ingredients: null,
    };
    const result = formatProductInfo(product);
    expect(result).toContain("No ingredient information available");
  });

  it("displays non-standard macro keys", () => {
    const product: Product = {
      name: "Special",
      url: "https://frisco.pl/x",
      price: "",
      macros: { kcal: "100 kcal", "vitamin-d": "5 µg" },
    };
    const result = formatProductInfo(product);
    expect(result).toContain("vitamin-d: 5 µg");
  });
});

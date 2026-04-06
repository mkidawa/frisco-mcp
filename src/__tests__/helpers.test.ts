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

  it("prefers itemprop name over h1", () => {
    const html = `
      <html><body>
        <div itemprop="name" content="Exact Product Name" class="new-product-page__product-details"></div>
        <h1 class="title product large-title">Slightly Different Name</h1>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.name).toBe("Exact Product Name");
  });

  it("extracts price from schema.org meta tag", () => {
    const html = `
      <html><body>
        <h1>Test Product</h1>
        <meta itemprop="price" content="12.99" />
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.price).toBe("12,99 zł");
  });

  it("extracts price from UI element when meta tag missing", () => {
    const html = `
      <html><body>
        <h1>Test Product</h1>
        <span class="f-pdp__price-amount--emphasized">8,49</span>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.price).toBe("8,49 zł");
  });

  it("extracts ingredients from brandbank-ingredients", () => {
    const html = `
      <html><body>
        <h1>Chocolate</h1>
        <div class="brandbank-ingredients__content">
          <h3>Składniki</h3>
          <p>mleko, cukier, kakao, lecytyna</p>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).toContain("mleko");
    expect(info.ingredients).toContain("cukier");
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

  it("returns null ingredients when not found", () => {
    const html = "<html><body><h1>Mystery Product</h1></body></html>";
    const info = extractProductPageInfoFromHtml(html);
    expect(info.ingredients).toBeNull();
  });

  it("extracts macros from nutrient gauges", () => {
    const html = `
      <html><body>
        <h1>Butter</h1>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Wartość energetyczna (kcal)</div>
          <div class="new-product-page__nutrient-gauge-text">740.00 kcal</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Białko (g)</div>
          <div class="new-product-page__nutrient-gauge-text">0.80 g</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Tłuszcz (g)</div>
          <div class="new-product-page__nutrient-gauge-text">82.00 g</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Węglowodany (g)</div>
          <div class="new-product-page__nutrient-gauge-text">0.70 g</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">w tym cukry (g)</div>
          <div class="new-product-page__nutrient-gauge-text">0.70 g</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Sól (g)</div>
          <div class="new-product-page__nutrient-gauge-text">0.02 g</div>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.kcal).toBe("740.00 kcal");
    expect(info.macros.protein).toBe("0.80 g");
    expect(info.macros.fat).toBe("82.00 g");
    expect(info.macros.carbohydrates).toBe("0.70 g");
    expect(info.macros.sugars).toBe("0.70 g");
    expect(info.macros.salt).toBe("0.02 g");
  });

  it("extracts macros from fpp table rows", () => {
    const html = `
      <html><body>
        <h1>Chicken</h1>
        <div class="fpp">
          <table><tbody>
            <tr><td>Wartość energetyczna (kcal)</td><td>110.00 kcal</td><td></td></tr>
            <tr><td>Białko (g)</td><td>23.00 g</td><td></td></tr>
            <tr><td>Tłuszcz (g)</td><td>1.30 g</td><td></td></tr>
            <tr><td>Węglowodany (g)</td><td>0.00 g</td><td></td></tr>
            <tr><td>Sól (g)</td><td>0.50 g</td><td></td></tr>
          </tbody></table>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.macros.kcal).toBe("110.00 kcal");
    expect(info.macros.protein).toBe("23.00 g");
    expect(info.macros.fat).toBe("1.30 g");
    expect(info.macros.carbohydrates).toBe("0.00 g");
    expect(info.macros.salt).toBe("0.50 g");
  });

  it("skips zero-valued gauges for non-food products", () => {
    const html = `
      <html><body>
        <h1>Worki na śmieci</h1>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Wartość energetyczna (kJ)</div>
          <div class="new-product-page__nutrient-gauge-text">0.00 kJ</div>
        </div>
        <div class="new-product-page__nutrient-gauge">
          <div class="new-product-page__nutrient-gauge-title">Wartość energetyczna (kcal)</div>
          <div class="new-product-page__nutrient-gauge-text">0.00 kcal</div>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(Object.keys(info.macros).length).toBe(0);
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

  it("extracts weight from product-grammage div", () => {
    const html = `
      <html><body>
        <h1>Skyr</h1>
        <div class="product-grammage tw-whitespace-nowrap">
          <div>330&nbsp;ml</div>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("330 ml");
  });

  it("extracts approximate weight with ~ prefix", () => {
    const html = `
      <html><body>
        <h1>Chicken</h1>
        <div class="product-grammage tw-whitespace-nowrap">
          <div class="icon-comp Scale"></div>
          <div>~500&nbsp;g</div>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("500 g");
  });

  it("extracts weight in szt (pieces)", () => {
    const html = `
      <html><body>
        <h1>Eggs</h1>
        <div class="product-grammage tw-whitespace-nowrap">
          <div>1&nbsp;szt</div>
        </div>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("1 szt");
  });

  it("extracts weight from grammage-gross-parameter as fallback", () => {
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

  it("extracts weight from title as last fallback", () => {
    const html = `
      <html>
        <head><title>Mleko UHT 2% 1l - Frisco.pl</title></head>
        <body><h1>Mleko UHT 2%</h1></body>
      </html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.weight).toBe("1l");
  });

  it("normalizes whitespace in name", () => {
    const html = `
      <html><body>
        <h1>  Spaced   Product   Name  </h1>
      </body></html>`;
    const info = extractProductPageInfoFromHtml(html);
    expect(info.name).toBe("Spaced Product Name");
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

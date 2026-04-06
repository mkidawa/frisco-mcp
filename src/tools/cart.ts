import { getPage, getContext, getLastSearchContext } from "../browser.js";
import { ensureLoggedIn } from "../auth.js";
import {
  dismissPopups,
  extractCartIssuesFromHtml,
  formatCartIssues,
  extractPromotionsFromHtml,
  formatPromotions,
} from "./helpers.js";
import type { CartItem, SearchResultItem } from "../types.js";

const CART_URL = "https://www.frisco.pl/stn,cart";
const CART_READY_WAIT_MS = 2_000;
const ITEM_ADD_WAIT_MS = 500;

type CartSummaryItem = {
  name: string;
  price: string;
  qty: string;
};

type CartSnapshot = {
  items: CartSummaryItem[];
  total: string | null;
};

function normalizeLookup(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeFriscoUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return url.trim();
  }
}

function isSameSearchUrl(currentUrl: string, expectedUrl: string): boolean {
  return normalizeFriscoUrl(currentUrl) === normalizeFriscoUrl(expectedUrl);
}

type SearchPageResult = {
  name: string;
  url: string | null;
  productPid: string | null;
  price: string;
  weight: string;
  available: boolean;
  hasAddButton: boolean;
  domIndex: number;
};

async function readVisibleSearchResultsFromPage(
  page: import("playwright").Page,
): Promise<SearchPageResult[]> {
  return (await page.evaluate(() => {
    function notInSidebar(el: HTMLElement) {
      let node = el.parentElement;
      while (node) {
        const cls = (node.className || "").toString().toLowerCase();
        if (
          cls.includes("cart") ||
          cls.includes("basket") ||
          cls.includes("mini-cart")
        ) {
          return false;
        }
        node = node.parentElement;
      }
      const rect = el.getBoundingClientRect();
      return rect.left <= window.innerWidth * 0.65;
    }

    const allBoxes = Array.from(
      document.querySelectorAll<HTMLElement>(".product-box_holder"),
    );
    const boxes = allBoxes.filter(
      (el) => el.offsetParent !== null && notInSidebar(el),
    );

    return boxes.map((box) => {
      const domIndex = allBoxes.indexOf(box);
      const nameEl = box.querySelector<HTMLAnchorElement>("a[title]");
      const name = (nameEl?.title || "?").trim();
      const productLink = box.querySelector<HTMLAnchorElement>(
        'a[href*="/pid,"][title]',
      );
      const href = productLink?.getAttribute("href") || productLink?.href || "";
      const url = href
        ? href.startsWith("http")
          ? href
          : `https://www.frisco.pl${href}`
        : null;
      const productPidMatch = (url || "").match(/\/pid,([^/?#]+)/i);
      const productPid = productPidMatch?.[1] ?? null;
      const priceEl = box.querySelector<HTMLElement>(
        '[class*="price"], [class*="Price"]',
      );
      const price = priceEl ? priceEl.innerText.trim().replace(/\s+/g, " ") : "";

      let weight = "";
      const weightEl = box.querySelector<HTMLElement>(".f-pc-weight__text");
      if (weightEl) {
        const raw = weightEl.innerText.trim().replace(/\s+/g, " ");
        const wm = raw.match(/^~?([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs)\b)/i);
        if (wm) weight = wm[1];
      }
      if (!weight) {
        const imgEl = box.querySelector<HTMLImageElement>("img[alt]");
        if (imgEl?.alt) {
          const am = imgEl.alt.match(
            /([\d.,]+\s*(?:g|ml|kg|l|szt\.?|pcs))\s*$/i,
          );
          if (am) weight = am[1].replace(/\u00a0/g, " ");
        }
      }

      const unavailable =
        !!box.querySelector(".unavailable-info") ||
        !!box.querySelector("article.unavailable");
      const addButton = box.querySelector<HTMLElement>(
        ".cart-button_add, button.cart-button_add",
      );
      const hasAddButton = Boolean(addButton);

      return {
        name,
        url,
        productPid,
        price,
        weight,
        available: !unavailable,
        hasAddButton,
        domIndex,
      };
    });
  })) as SearchPageResult[];
}

function isSameSearchResult(
  left: SearchPageResult,
  right: SearchPageResult,
): boolean {
  if (left.productPid && right.productPid) {
    return left.productPid === right.productPid;
  }
  if (left.url && right.url) {
    return normalizeFriscoUrl(left.url) === normalizeFriscoUrl(right.url);
  }
  return normalizeLookup(left.name) === normalizeLookup(right.name);
}

async function resolveAddButtonForResult(
  page: import("playwright").Page,
  selected: SearchPageResult,
): Promise<import("playwright").Locator | null> {
  const candidateButtons: import("playwright").Locator[] = [];

  if (selected.productPid) {
    candidateButtons.push(
      page
        .locator(".product-box_holder")
        .filter({
          has: page.locator(`a[href*="/pid,${selected.productPid}"]`),
        })
        .first()
        .locator(".cart-button_add")
        .first(),
    );
  }

  candidateButtons.push(
    page
      .getByTitle(selected.name, { exact: true })
      .first()
      .locator("xpath=ancestor::*[contains(@class,'product-box_holder')][1]")
      .locator(".cart-button_add")
      .first(),
  );

  candidateButtons.push(
    page
      .locator(".product-box_holder")
      .filter({ hasText: selected.name })
      .first()
      .locator(".cart-button_add")
      .first(),
  );

  for (const button of candidateButtons) {
    const visible = await button.isVisible({ timeout: 1_000 }).catch(() => false);
    if (visible) return button;
  }

  return null;
}

async function ensureSearchResultsPage(
  page: import("playwright").Page,
  searchUrl: string,
): Promise<void> {
  if (!isSameSearchUrl(page.url(), searchUrl)) {
    await page.goto(searchUrl, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1_500);
    await dismissPopups(page);
  }
}

function pickResultForCartItem(
  item: CartItem,
  searchContextResults: SearchResultItem[],
  pageResults: SearchPageResult[],
): SearchPageResult | null {
  const explicitName = item.name?.trim();
  if (explicitName) {
    const explicitNeedle = normalizeLookup(explicitName);
    const exactContext = searchContextResults.find(
      (result) => normalizeLookup(result.name) === explicitNeedle,
    );
    if (exactContext?.url) {
      const exactContextUrl = normalizeFriscoUrl(exactContext.url);
      const byExactUrl = pageResults.find(
        (result) =>
          result.url && normalizeFriscoUrl(result.url) === exactContextUrl,
      );
      if (byExactUrl) return byExactUrl;
    }

    const byExactName = pageResults.find(
      (result) => normalizeLookup(result.name) === explicitNeedle,
    );
    if (byExactName) return byExactName;
  }

  const candidates = [item.name, item.searchQuery]
    .filter((value): value is string => Boolean(value && value.trim()))
    .map(normalizeLookup);
  if (candidates.length === 0) return null;

  function score(name: string): number {
    const normalizedName = normalizeLookup(name);
    for (const candidate of candidates) {
      if (normalizedName === candidate) return 300;
    }
    for (const candidate of candidates) {
      if (normalizedName.includes(candidate)) return 200;
      if (candidate.includes(normalizedName)) return 150;
    }
    return 0;
  }

  const contextMatch = searchContextResults
    .map((result) => ({ result, score: score(result.name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.result;
  if (!contextMatch) return null;

  if (contextMatch.url) {
    const contextUrl = normalizeFriscoUrl(contextMatch.url);
    const byUrl = pageResults.find(
      (result) => result.url && normalizeFriscoUrl(result.url) === contextUrl,
    );
    if (byUrl) return byUrl;
  }

  const byName = pageResults
    .map((result) => ({ result, score: score(result.name) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.result;

  return byName ?? null;
}

async function openCartPage(page: import("playwright").Page): Promise<void> {
  await page.goto(CART_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(CART_READY_WAIT_MS);
}

async function getReadyCartPage(): Promise<import("playwright").Page> {
  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);
  await dismissPopups(page);
  await openCartPage(page);
  return page;
}

async function clearCartViaUi(
  page: import("playwright").Page,
): Promise<boolean> {
  await openCartPage(page);

  const clearButtonCandidates = [
    page.locator(".checkout_products-actions-clear-cart").first(),
    page.locator(".cart-side-box_actions_clear-cart").first(),
    page.getByRole("link", { name: /wyczyść koszyk/i }).first(),
    page.getByRole("button", { name: /wyczyść koszyk/i }).first(),
    page
      .locator("a,button")
      .filter({ hasText: /wyczyść koszyk/i })
      .first(),
  ];

  let clickedClearButton = false;
  for (const candidate of clearButtonCandidates) {
    const visible = await candidate
      .isVisible({ timeout: 1_000 })
      .catch(() => false);
    if (!visible) continue;

    try {
      await candidate.scrollIntoViewIfNeeded();
      await candidate.click({ timeout: 2_000 });
      clickedClearButton = true;
      break;
    } catch {
      try {
        await candidate.click({ timeout: 2_000, force: true });
        clickedClearButton = true;
        break;
      } catch {
        // Try the next selector variant.
      }
    }
  }

  if (!clickedClearButton) return false;

  // Fallback: force a DOM click for non-standard anchor/button implementations.
  if (!clickedClearButton) {
    clickedClearButton = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".checkout_products-actions-clear-cart, .cart-side-box_actions_clear-cart, a, button",
        ),
      );
      const trigger = candidates.find((element) => {
        const className = (element.className || "").toString();
        const text = (element.textContent || "").replace(/\s+/g, " ").trim();
        return (
          className.includes("checkout_products-actions-clear-cart") ||
          className.includes("cart-side-box_actions_clear-cart") ||
          /wyczyść koszyk/i.test(text)
        );
      });
      if (!trigger) return false;
      trigger.click();
      return true;
    });
  }

  if (!clickedClearButton) return false;

  const confirmCandidates = [
    page
      .locator(".notification-popup_buttons a.button.cta")
      .filter({ hasText: /wyczyść koszyk/i })
      .first(),
    page.getByRole("button", { name: /wyczyść koszyk/i }).first(),
    page.getByRole("link", { name: /wyczyść koszyk/i }).first(),
    page.locator(".notification-popup_buttons .button.cta").first(),
  ];

  for (const confirm of confirmCandidates) {
    const visible = await confirm
      .isVisible({ timeout: 2_500 })
      .catch(() => false);
    if (!visible) continue;
    try {
      await confirm.click({ timeout: 2_000 });
      await page.waitForTimeout(CART_READY_WAIT_MS);
      return true;
    } catch {
      // Try next confirm button candidate.
    }
  }

  // Last-chance fallback for popup implemented outside standard roles.
  const confirmedViaDom = await page.evaluate(() => {
    const popupButtons = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".notification-popup_buttons a.button.cta, .notification-popup_buttons .button.cta",
      ),
    );
    const confirm = popupButtons.find((element) =>
      /wyczyść koszyk/i.test(
        (element.textContent || "").replace(/\s+/g, " ").trim(),
      ),
    );
    if (!confirm) return false;
    confirm.click();
    return true;
  });
  if (confirmedViaDom) {
    await page.waitForTimeout(CART_READY_WAIT_MS);
    return true;
  }

  return false;
}

async function getCartSnapshot(
  page: import("playwright").Page,
): Promise<CartSnapshot> {
  return page.evaluate(() => {
    function normalizeText(value: string): string {
      return value.replace(/\s+/g, " ").trim();
    }

    function getCartLineDisplayName(box: HTMLElement): string | null {
      const titledImage = box.querySelector<HTMLImageElement>(
        ".horizontal-product-box__product-img img[title]",
      );
      if (titledImage?.title) return normalizeText(titledImage.title);

      const altImage = box.querySelector<HTMLImageElement>(
        ".horizontal-product-box__product-img img[alt]",
      );
      if (altImage?.alt) return normalizeText(altImage.alt);

      const brand = box.querySelector<HTMLElement>(".f-hpc__brand");
      const bareName = box.querySelector<HTMLElement>(".f-hpc__bare-name");
      if (brand && bareName) {
        const brandText = (
          brand.getAttribute("title") ||
          brand.textContent ||
          ""
        ).trim();
        const nameText = (
          bareName.getAttribute("title") ||
          bareName.textContent ||
          ""
        ).trim();
        if (brandText && nameText) {
          return normalizeText(`${brandText} ${nameText}`);
        }
      }

      const titledLink = box.querySelector<HTMLAnchorElement>("a[title]");
      if (titledLink?.title) return titledLink.title.trim();

      return null;
    }

    function getCartLineRoots(): HTMLElement[] {
      const horizontal = Array.from(
        document.querySelectorAll<HTMLElement>(
          "article.horizontal-product-box__wrapper",
        ),
      ).filter(
        (element) =>
          element.offsetParent !== null &&
          element.querySelector(".horizontal-product-box__delete-button"),
      );
      if (horizontal.length > 0) return horizontal;

      return Array.from(
        document.querySelectorAll<HTMLElement>(".product-box_holder"),
      ).filter(
        (element) =>
          element.offsetParent !== null &&
          element.querySelector(".horizontal-product-box__delete-button"),
      );
    }

    const byName = new Map<string, CartSummaryItem>();
    for (const box of getCartLineRoots()) {
      const name = getCartLineDisplayName(box);
      if (!name) continue;

      const quantityInput = box.querySelector<HTMLInputElement>(
        'input.cart-button_quantity, input[type="number"], [class*="stepper"], input[class*="Quantity"], input[class*="quantity"]',
      );
      const qty = quantityInput ? (quantityInput.value || "1").trim() : "1";

      const priceElement = box.querySelector<HTMLElement>(
        '.horizontal-product-box__cart-price-value, .horizontal-product-box__cart-price .price, [class*="price"], [class*="Price"]',
      );
      const price = priceElement ? normalizeText(priceElement.innerText) : "";

      const previous = byName.get(name);
      if (!previous || (!previous.price && price)) {
        byName.set(name, { name, price, qty });
      }
    }

    const totalRow = document.querySelector<HTMLElement>(
      ".generic-summary-box_frame-section-row.final.cta .generic-summary-box_frame-section-row-value",
    );
    const totalElement =
      totalRow ??
      document.querySelector<HTMLElement>(
        '[class*="summary"] [class*="price"], [class*="checkout"] [class*="total"], ' +
          '[class*="Summary"] [class*="Price"], [class*="CartSummary"]',
      );

    return {
      items: Array.from(byName.values()),
      total: totalElement ? normalizeText(totalElement.innerText) : null,
    };
  });
}

function formatCartSnapshot(snapshot: CartSnapshot): string {
  if (!snapshot.items.length) {
    return `🛒 Cart is empty (or contents could not be read).\n👉 ${CART_URL}`;
  }

  const lines = ["🛒 Cart contents:\n"];
  for (const item of snapshot.items) {
    const pricePart = item.price ? ` — ${item.price}` : "";
    lines.push(`- ${item.name} ×${item.qty}${pricePart}`);
  }
  if (snapshot.total) {
    lines.push(`\n💰 Total: ${snapshot.total}`);
  }
  lines.push(`\n👉 ${CART_URL}`);
  return lines.join("\n");
}

export async function clearCart(): Promise<string> {
  try {
    const page = await getReadyCartPage();
    const wasClicked = await clearCartViaUi(page);
    const snapshot = await getCartSnapshot(page);
    const summary = formatCartSnapshot(snapshot);

    if (!wasClicked) {
      return [
        "⚠️ Could not find the clear-cart button (the layout may have changed).",
        "The cart might remain unchanged.",
        "",
        summary,
      ].join("\n");
    }

    return [
      "🛒 Clear-cart action was triggered in Frisco UI.",
      "",
      summary,
    ].join("\n");
  } catch (error) {
    return `❌ Failed to clear cart: ${getErrorMessage(error)}`;
  }
}

export async function addItemsToCart(
  items: string,
  options: { clearCartFirst?: boolean } = {},
): Promise<string> {
  let products: CartItem[];
  try {
    products = JSON.parse(items) as CartItem[];
  } catch {
    return '❌ Invalid JSON. Expected: \'[{"name":"...","searchQuery":"...","quantity":1}]\'';
  }

  if (!Array.isArray(products)) {
    return "❌ Invalid input. Expected a JSON array of products.";
  }

  const searchContext = getLastSearchContext();
  if (!searchContext || searchContext.results.length === 0) {
    return [
      "❌ No saved search context found.",
      "Run search_products first, then call add_items_to_cart with item names from that result list.",
    ].join("\n");
  }

  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);
  await dismissPopups(page);

  await ensureSearchResultsPage(page, searchContext.searchUrl);

  if (options.clearCartFirst === true) {
    await clearCartViaUi(page);
    await ensureSearchResultsPage(page, searchContext.searchUrl);
  }

  const pageResults = await readVisibleSearchResultsFromPage(page);
  if (pageResults.length === 0) {
    return [
      "❌ Saved search page does not contain visible product results.",
      `Expected results URL: ${searchContext.searchUrl}`,
      "Run search_products again to refresh context.",
    ].join("\n");
  }

  const results: string[] = [];

  for (const item of products) {
    const displayName = item.name ?? "?";
    const quantityRaw = item.quantity ?? 1;
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0
      ? Math.floor(quantityRaw)
      : 1;

    try {
      const selected = pickResultForCartItem(item, searchContext.results, pageResults);
      if (!selected) {
        results.push(
          `⚠️ ${displayName}: not found in the latest search results (query: "${searchContext.query}")`,
        );
        continue;
      }

      if (!selected.available || !selected.hasAddButton) {
        const alternatives = pageResults
          .filter(
            (result) =>
              result.available &&
              result.hasAddButton &&
              !isSameSearchResult(result, selected),
          )
          .slice(0, 5);
        let message = `⚠️ ${displayName}: product "${selected.name}" is currently unavailable`;
        if (alternatives.length > 0) {
          message += "\n   Available alternatives:";
          for (const alternative of alternatives) {
            const weightPart = alternative.weight ? ` [${alternative.weight}]` : "";
            const pricePart = alternative.price ? ` | ${alternative.price}` : "";
            message += `\n   - ${alternative.name}${weightPart}${pricePart}`;
          }
        }
        results.push(message);
        continue;
      }

      const addButton = await resolveAddButtonForResult(page, selected);
      if (!addButton) {
        results.push(`⚠️ ${displayName}: add button not available for "${selected.name}"`);
        continue;
      }

      for (let index = 0; index < quantity; index++) {
        await addButton.click();
        await page.waitForTimeout(ITEM_ADD_WAIT_MS);
      }
      const weightPart = selected.weight ? ` [${selected.weight}]` : "";
      const pricePart = selected.price ? ` — ${selected.price}` : "";
      results.push(`✅ ${selected.name}${weightPart} ×${quantity}${pricePart}`);
    } catch (error) {
      const message = getErrorMessage(error).slice(0, 120);
      results.push(`❌ ${displayName}: ${message}`);
    }
  }

  const addedCount = results.filter((line) => line.startsWith("✅")).length;
  return [
    `🛒 Added ${addedCount}/${products.length} items:`,
    "",
    results.join("\n"),
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "⚠️ Payment is YOUR responsibility.",
    `👉 ${CART_URL}`,
    `🔎 Source search: ${searchContext.searchUrl}`,
    "The browser is open — go to checkout when ready.",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}

export async function removeItemFromCart(productName: string): Promise<string> {
  const needle = productName.toLowerCase();

  try {
    const page = await getReadyCartPage();
    const removedName = await page.evaluate((target: string) => {
      function normalizeText(value: string): string {
        return value.replace(/\s+/g, " ").trim();
      }

      function getCartLineDisplayName(box: HTMLElement): string | null {
        const titledImage = box.querySelector<HTMLImageElement>(
          ".horizontal-product-box__product-img img[title]",
        );
        if (titledImage?.title) return normalizeText(titledImage.title);

        const altImage = box.querySelector<HTMLImageElement>(
          ".horizontal-product-box__product-img img[alt]",
        );
        if (altImage?.alt) return normalizeText(altImage.alt);

        const brand = box.querySelector<HTMLElement>(".f-hpc__brand");
        const bareName = box.querySelector<HTMLElement>(".f-hpc__bare-name");
        if (brand && bareName) {
          const brandText = (
            brand.getAttribute("title") ||
            brand.textContent ||
            ""
          ).trim();
          const nameText = (
            bareName.getAttribute("title") ||
            bareName.textContent ||
            ""
          ).trim();
          if (brandText && nameText) {
            return normalizeText(`${brandText} ${nameText}`);
          }
        }

        const titledLink = box.querySelector<HTMLAnchorElement>("a[title]");
        if (titledLink?.title) return titledLink.title.trim();
        return null;
      }

      function getCartLineRoots(): HTMLElement[] {
        const horizontal = Array.from(
          document.querySelectorAll<HTMLElement>(
            "article.horizontal-product-box__wrapper",
          ),
        ).filter(
          (element) =>
            element.offsetParent !== null &&
            element.querySelector(".horizontal-product-box__delete-button"),
        );
        if (horizontal.length > 0) return horizontal;

        return Array.from(
          document.querySelectorAll<HTMLElement>(".product-box_holder"),
        ).filter(
          (element) =>
            element.offsetParent !== null &&
            element.querySelector(".horizontal-product-box__delete-button"),
        );
      }

      for (const box of getCartLineRoots()) {
        const lineName = getCartLineDisplayName(box);
        if (lineName && lineName.toLowerCase().includes(target)) {
          box
            .querySelector<HTMLElement>(
              ".horizontal-product-box__delete-button",
            )
            ?.click();
          return lineName;
        }
      }

      return null;
    }, needle);

    if (!removedName) {
      return `⚠️ Product "${productName}" was not found in the cart.`;
    }

    await page.waitForTimeout(1_000);
    return `🗑️ Removed "${removedName}" from cart.\n👉 ${CART_URL}`;
  } catch (error) {
    return `❌ Failed to remove item: ${getErrorMessage(error)}`;
  }
}

export async function viewCart(): Promise<string> {
  try {
    const page = await getReadyCartPage();
    const snapshot = await getCartSnapshot(page);
    return formatCartSnapshot(snapshot);
  } catch (error) {
    return `❌ Failed to read cart: ${getErrorMessage(error)}`;
  }
}

export async function checkCartIssues(): Promise<string> {
  try {
    const page = await getReadyCartPage();
    const html = await page.content();
    const issues = extractCartIssuesFromHtml(html);
    return formatCartIssues(issues);
  } catch (error) {
    return `❌ Failed to check cart issues: ${getErrorMessage(error)}`;
  }
}

export async function viewPromotions(): Promise<string> {
  try {
    const page = await getReadyCartPage();
    const html = await page.content();
    const promotions = extractPromotionsFromHtml(html);
    return formatPromotions(promotions);
  } catch (error) {
    return `❌ Failed to read promotions: ${getErrorMessage(error)}`;
  }
}

export async function updateItemQuantity(
  productName: string,
  quantity: number,
): Promise<string> {
  if (!Number.isFinite(quantity) || quantity < 1) {
    return "❌ Quantity must be a positive number (e.g. 1, 2, 3).";
  }

  const needle = productName.toLowerCase();

  try {
    const page = await getReadyCartPage();
    const foundName = await page.evaluate((target: string) => {
      const boxes = Array.from(
        document.querySelectorAll<HTMLElement>(
          ".mini-product-box_wrapper.in-cart",
        ),
      );

      for (const box of boxes) {
        const nameLink = box.querySelector<HTMLAnchorElement>("a[title]");
        const name = nameLink?.title?.toLowerCase() ?? "";
        if (name.includes(target)) {
          return nameLink?.title ?? target;
        }
      }
      return null;
    }, needle);

    if (!foundName) {
      return `⚠️ Product "${productName}" was not found in the cart.`;
    }

    const quantityInput = page
      .locator(
        `.mini-product-box_wrapper.in-cart:has(a[title*="${foundName}" i]) .cart-button_quantity`,
      )
      .first();

    if (
      !(await quantityInput.isVisible({ timeout: 3_000 }).catch(() => false))
    ) {
      return `⚠️ Cannot change quantity for "${foundName}" — quantity input was not found.`;
    }

    await quantityInput.fill(String(quantity));
    await quantityInput.press("Enter");
    await page.waitForTimeout(1_500);

    return `✅ Quantity for "${foundName}" changed to ${quantity}.\n👉 ${CART_URL}`;
  } catch (error) {
    return `❌ Failed to update quantity: ${getErrorMessage(error)}`;
  }
}

import { getPage, getContext } from "../browser.js";
import { ensureLoggedIn } from "../auth.js";
import {
  searchNavigateAndCache,
  dismissPopups,
  extractCartIssuesFromHtml,
  formatCartIssues,
  extractPromotionsFromHtml,
  formatPromotions,
} from "./helpers.js";
import type { CartItem } from "../types.js";

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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

  const clearButton = page
    .locator(
      ".checkout_products-actions-clear-cart, .cart-side-box_actions_clear-cart",
    )
    .first();

  if (!(await clearButton.isVisible({ timeout: 3_000 }).catch(() => false))) {
    return false;
  }

  await clearButton.click();
  const confirmButton = page.locator(".notification-popup_buttons .button.cta");
  await confirmButton.waitFor({ state: "visible", timeout: 5_000 });
  await confirmButton.click();
  await page.waitForTimeout(CART_READY_WAIT_MS);
  return true;
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

    return ["🛒 Clear-cart action was triggered in Frisco UI.", "", summary].join(
      "\n",
    );
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

  const page = await getPage();
  const context = await getContext();
  await ensureLoggedIn(page, context);
  await dismissPopups(page);

  if (options.clearCartFirst === true) {
    await clearCartViaUi(page);
  }

  const results: string[] = [];

  for (const item of products) {
    const displayName = item.name ?? "?";
    const query = item.searchQuery ?? displayName;
    const quantity = item.quantity ?? 1;

    try {
      const { foundName, addButton, unavailable, alternatives } =
        await searchNavigateAndCache(page, query);

      if (!addButton) {
        if (unavailable) {
          let message = `⚠️ ${displayName}: product "${foundName}" is currently unavailable`;
          if (alternatives && alternatives.length > 0) {
            message += "\n   Available alternatives:";
            for (const alternative of alternatives) {
              const weightPart = alternative.weight
                ? ` [${alternative.weight}]`
                : "";
              const pricePart = alternative.price ? ` | ${alternative.price}` : "";
              message += `\n   - ${alternative.name}${weightPart}${pricePart}`;
            }
          }
          results.push(message);
        } else {
          results.push(`⚠️ ${displayName}: not found on frisco.pl`);
        }
        continue;
      }

      for (let index = 0; index < quantity; index++) {
        await addButton.click();
        await page.waitForTimeout(ITEM_ADD_WAIT_MS);
      }
      results.push(`✅ ${foundName} ×${quantity}`);
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
    return '❌ Quantity must be a positive number (e.g. 1, 2, 3).';
  }

  const needle = productName.toLowerCase();

  try {
    const page = await getReadyCartPage();
    const foundName = await page.evaluate((target: string) => {
      const boxes = Array.from(
        document.querySelectorAll<HTMLElement>(".mini-product-box_wrapper.in-cart"),
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

    if (!(await quantityInput.isVisible({ timeout: 3_000 }).catch(() => false))) {
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

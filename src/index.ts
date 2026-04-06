import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { login, finishSession, clearSession } from "./tools/session.js";
import {
  addItemsToCart,
  clearCart,
  viewCart,
  removeItemFromCart,
  checkCartIssues,
  viewPromotions,
  updateItemQuantity,
} from "./tools/cart.js";
import {
  searchProducts,
  getProductInfo,
  getProductReviews,
} from "./tools/products.js";
import {
  initLogger,
  logEvent,
  getCurrentSessionId,
  getCurrentSessionLogPath,
  getLogs,
  tailLogs,
} from "./logger.js";

const server = new McpServer({
  name: "frisco-mcp-ts",
  version: "1.0.0",
});

type ToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
};

async function executeTool(
  toolName: string,
  input: Record<string, unknown>,
  run: () => Promise<string>,
): Promise<ToolResult> {
  const startedAt = Date.now();
  await logEvent("tool_started", { toolName, input });
  try {
    const text = await run();
    await logEvent("tool_succeeded", {
      toolName,
      durationMs: Date.now() - startedAt,
      outputPreview: text.slice(0, 300),
    });
    return { content: [{ type: "text", text }] };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await logEvent(
      "tool_failed",
      {
        toolName,
        durationMs: Date.now() - startedAt,
        error: message,
      },
      "error",
    );
    return {
      content: [{ type: "text", text: `❌ Error: ${message}` }],
      isError: true,
    };
  }
}

server.registerTool(
  "get_logs",
  {
    description:
      "Returns persisted JSONL log events for the current or selected session.",
    inputSchema: {
      sessionId: z
        .string()
        .optional()
        .describe("Optional session ID, defaults to current session"),
      limit: z
        .number()
        .optional()
        .describe("Max number of events to return (default 200, max 2000)"),
    },
  },
  async ({ sessionId, limit }) => {
    return executeTool("get_logs", { sessionId, limit }, () =>
      getLogs({ sessionId, limit }),
    );
  },
);

server.registerTool(
  "tail_logs",
  {
    description: "Returns the most recent events from persisted session logs.",
    inputSchema: {
      sessionId: z
        .string()
        .optional()
        .describe("Optional session ID, defaults to current session"),
      lines: z
        .number()
        .default(50)
        .describe("How many latest events to return (default 50, max 500)"),
    },
  },
  async ({ sessionId, lines }) => {
    return executeTool("tail_logs", { sessionId, lines }, () =>
      tailLogs(lines, sessionId),
    );
  },
);

server.registerTool(
  "login",
  {
    description:
      "Opens a visible Chromium browser to log in to Frisco manually. Run this first to establish a session.",
  },
  async () => {
    return executeTool("login", {}, () => login());
  },
);

server.registerTool(
  "finish_session",
  {
    description:
      "Opens the browser at the checkout page so you can select a delivery time and pay.",
  },
  async () => {
    return executeTool("finish_session", {}, () => finishSession());
  },
);

server.registerTool(
  "clear_session",
  {
    description: "Clears the saved session and closes the browser.",
  },
  async () => {
    return executeTool("clear_session", {}, () => clearSession());
  },
);

server.registerTool(
  "view_cart",
  {
    description: "Returns the current contents and total of the Frisco cart.",
  },
  async () => {
    return executeTool("view_cart", {}, () => viewCart());
  },
);

server.registerTool(
  "clear_cart",
  {
    description:
      "Empties the Frisco cart using the site's clear-cart button and confirmation dialog. Run view_cart if you need to verify.",
  },
  async () => {
    return executeTool("clear_cart", {}, () => clearCart());
  },
);

server.registerTool(
  "add_items_to_cart",
  {
    description:
      "Adds products to cart by selecting from the most recent search_products result page. No additional search is performed.",
    inputSchema: {
      items: z
        .string()
        .describe(
          'JSON array of items, e.g. [{"name":"PIĄTNICA Skyr naturalny","quantity":2}]',
        ),
      clearCartFirst: z
        .boolean()
        .default(false)
        .describe("If true, clears cart before adding items"),
    },
  },
  async ({ items, clearCartFirst }) => {
    return executeTool("add_items_to_cart", { items, clearCartFirst }, () =>
      addItemsToCart(items, { clearCartFirst }),
    );
  },
);

server.registerTool(
  "search_products",
  {
    description:
      "Searches frisco.pl for products, returns top matches with prices, and saves the search URL/context for add_items_to_cart.",
    inputSchema: {
      query: z.string().describe("Product name to search for"),
      topN: z
        .number()
        .default(5)
        .describe("Number of results to return (default 5)"),
    },
  },
  async ({ query, topN }) => {
    return executeTool("search_products", { query, topN }, () =>
      searchProducts(query, topN),
    );
  },
);

server.registerTool(
  "get_product_info",
  {
    description:
      "Gets detailed info for a product: nutritional values (macros per 100g), weight/grammage, ingredients, and price.",
    inputSchema: {
      query: z.string().describe("Product name or search query"),
    },
  },
  async ({ query }) => {
    return executeTool("get_product_info", { query }, () =>
      getProductInfo(query),
    );
  },
);

server.registerTool(
  "remove_item_from_cart",
  {
    description:
      "Removes a specific product from the Frisco cart by name (partial match supported).",
    inputSchema: {
      productName: z
        .string()
        .describe("Full or partial name of the product to remove"),
    },
  },
  async ({ productName }) => {
    return executeTool("remove_item_from_cart", { productName }, () =>
      removeItemFromCart(productName),
    );
  },
);

server.registerTool(
  "check_cart_issues",
  {
    description:
      "Checks the cart for sold-out or unavailable products and lists available substitutes for each.",
  },
  async () => {
    return executeTool("check_cart_issues", {}, () => checkCartIssues());
  },
);

server.registerTool(
  "get_product_reviews",
  {
    description:
      "Gets customer reviews and ratings for a product from Trustmate.",
    inputSchema: {
      query: z.string().describe("Product name or search query"),
      limit: z
        .number()
        .default(5)
        .describe("Max number of reviews to return (default 5)"),
    },
  },
  async ({ query, limit }) => {
    return executeTool("get_product_reviews", { query, limit }, () =>
      getProductReviews(query, limit),
    );
  },
);

server.registerTool(
  "view_promotions",
  {
    description:
      "Shows active promotions, discounts, and total savings in the current cart.",
  },
  async () => {
    return executeTool("view_promotions", {}, () => viewPromotions());
  },
);

server.registerTool(
  "update_item_quantity",
  {
    description:
      "Changes the quantity of a product already in the cart (partial name match supported).",
    inputSchema: {
      productName: z.string().describe("Full or partial name of the product"),
      quantity: z.number().describe("New quantity to set"),
    },
  },
  async ({ productName, quantity }) => {
    return executeTool("update_item_quantity", { productName, quantity }, () =>
      updateItemQuantity(productName, quantity),
    );
  },
);

async function run() {
  await initLogger();
  await logEvent("server_starting", {
    sessionId: getCurrentSessionId(),
    sessionLogPath: getCurrentSessionLogPath(),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  await logEvent("server_started");
}

run().catch((error) => {
  void logEvent(
    "server_fatal_error",
    {
      message: error instanceof Error ? error.message : String(error),
    },
    "error",
  );
  console.error("Fatal error starting server:", error);
  process.exit(1);
});

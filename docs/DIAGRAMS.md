# Frisco MCP Solution Diagrams

Below are diagrams of the key project components: architecture, session/login flow, and the flow for adding products to the cart.

## 1) High-Level Architecture

```mermaid
flowchart LR
    A[MCP Client / AI Assistant] --> B[src/index.ts<br/>McpServer]
    B --> C[Session Tools<br/>src/tools/session.ts]
    B --> D[Cart Tools<br/>src/tools/cart.ts]
    B --> E[Product Tools<br/>src/tools/products.ts]

    C --> G[src/browser.ts<br/>singleton Browser/Context/Page]
    D --> G
    E --> G

    C --> H[src/auth.ts<br/>session cookies]
    D --> H
    E --> H

    D --> I[src/tools/helpers.ts<br/>navigation & parsing]
    E --> I

    H --> J[(~/.frisco-mcp/session.json)]
    G --> N[(in-memory lastSearchContext)]
    G --> K[frisco.pl]
    I --> K
```

### Registered Tools

| Tool | Module | Description |
|------|--------|-------------|
| `login` | session.ts | Open browser for manual login |
| `finish_session` | session.ts | Open checkout page |
| `clear_session` | session.ts | Clear session and close browser |
| `search_products` | products.ts | Search products + save search URL/context |
| `get_product_info` | products.ts | Detailed product info (macros, ingredients) |
| `get_product_reviews` | products.ts | Customer reviews and ratings (Trustmate) |
| `add_items_to_cart` | cart.ts | Add products from latest saved search result page |
| `view_cart` | cart.ts | View current cart contents |
| `remove_item_from_cart` | cart.ts | Remove a product from cart |
| `update_item_quantity` | cart.ts | Change quantity of a product in cart |
| `check_cart_issues` | cart.ts | Detect sold-out items and list substitutes |
| `view_promotions` | cart.ts | Show active promotions and savings |
| `get_logs` | logger.ts | Read session log events |
| `tail_logs` | logger.ts | Read recent log events |

## 2) Login and Session Flow

```mermaid
sequenceDiagram
    participant U as User
    participant MCP as Tool: login
    participant S as session.ts
    participant B as browser.ts
    participant A as auth.ts
    participant F as frisco.pl
    participant FS as session.json

    U->>MCP: Run login
    MCP->>S: login()
    S->>B: getPage(), getContext()
    S->>F: Open /login (Playwright)
    U->>F: Manual login in browser window
    S->>S: Poll URL + account markers
    alt Login successful
        S->>A: saveSession(context)
        A->>FS: Save cookies
        S-->>MCP: Session saved
    else Timeout / no success
        S-->>MCP: Timeout message
    end
```

## 3) Add Products to Cart Flow

```mermaid
flowchart TD
    A[add_items_to_cart] --> B[Parse input JSON]
    B --> C[getPage + getContext]
    C --> D[ensureLoggedIn]
    D --> E[dismissPopups]
    E --> F[Read lastSearchContext]
    F --> G{Context exists?}
    G -- No --> H[Return error: run search_products first]
    G -- Yes --> I[Ensure current page URL matches saved search URL]
    I --> J[Read visible product tiles from search result page]
    J --> K{For each requested item}
    K --> L[Match item by exact/partial name against saved results]
    L --> M{Matched and available?}
    M -- No --> N[Report unavailable/not found + alternatives]
    M -- Yes --> O[Click tile 'Do koszyka' x quantity]
    O --> P[Add success result]
    N --> Q{Next item?}
    P --> Q
    Q -- Yes --> K
    Q -- No --> R[Return summary + source search URL]
```

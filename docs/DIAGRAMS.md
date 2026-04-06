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

    D --> I[src/tools/helpers.ts<br/>navigation, HTML parsing & formatters]
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
| `add_items_to_cart` | cart.ts | Add products via productUrl (preferred) or from search results |
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
    E --> F{Item has productUrl?}
    F -- Yes --> G[Navigate to product page]
    G --> H[Click 'Do koszyka' on product page]
    H --> I[Set quantity if > 1]
    I --> P[Add success result]
    F -- No --> J[Read lastSearchContext]
    J --> K{Context exists?}
    K -- No --> L[Return error: run search_products first]
    K -- Yes --> M[Ensure current page URL matches saved search URL]
    M --> N[Read visible product tiles from search result page]
    N --> O{Match item by name against saved results}
    O -- Not found / unavailable --> Q[Report unavailable + alternatives]
    O -- Matched --> R[Click tile 'Do koszyka' x quantity]
    R --> P
    P --> S{Next item?}
    Q --> S
    S -- Yes --> F
    S -- No --> T[Return summary]
```

## 4) Product Page HTML Parsing

`extractProductPageInfoFromHtml` in `helpers.ts` extracts structured data from frisco.pl product pages. The parser handles different product types: food with full nutrition, food with partial/no nutrition, non-food items, and promotional products.

```mermaid
flowchart TD
    HTML[Product Page HTML] --> N[Name]
    HTML --> PR[Price]
    HTML --> W[Weight]
    HTML --> I[Ingredients]
    HTML --> M[Macros / Nutrition]

    N --> N1{div.new-product-page__product-details\nitemprop=name content=...}
    N1 -- found --> N2[Use content attr]
    N1 -- not found --> N3{h1.title.product}
    N3 -- not found --> N4[Generic h1]

    PR --> PR1{meta itemprop=price}
    PR1 -- found --> PR2[Format as 'X,XX zł']
    PR1 -- not found --> PR3{.f-pdp__price-amount--emphasized\nor --highlighted}

    PR --> PR4{.f-pdp__price-amount--plain}
    PR4 -- found --> PR5[originalPrice]
    PR --> PR6{div.f-pdp__unit-price}
    PR6 -- found --> PR7[unitPrice]

    W --> W1{div.product-grammage}
    W1 -- found --> W2[Parse: 330 ml, ~500 g, 1 kg, 1 szt]
    W1 -- not found --> W3{grammage-gross-parameter strong}
    W3 -- not found --> W4[Fallback: title tag]

    I --> I1{brandbank-ingredients p}
    I1 -- found --> I2[Join paragraph texts]
    I1 -- not found --> I3{expandable-block\n'Skład i alergeny'}

    M --> M1{nutrient-gauge divs exist?}
    M1 -- Yes --> M2[Extract title+value from each gauge\nSkip zero values]
    M1 -- No --> M3{div.fpp table?}
    M3 -- Yes --> M4[Extract from table rows\nlabel in td:first, value in td:second]
    M3 -- No --> M5{expandable-block\n'Wartości odżywcze' text?}
    M5 -- Yes --> M6[Regex extraction from text]
    M5 -- No --> M7[Empty macros]
```

### Product types vs. extracted data

| Product type | Example | Weight | Macros | Ingredients | Original price |
|---|---|---|---|---|---|
| Dairy (full nutrition) | Skyr, Mascarpone | ml / g | Full (gauge) | Sometimes | If on promotion |
| Meat (table format) | Chicken filet | ~g (approx) | Table (may be empty) | brandbank | No |
| Fruit | Bananas | ~kg (approx) | Partial (gauge) | No | No |
| Eggs (by piece) | Free-range eggs | szt | No | No | No |
| Non-food | Trash bags | szt | Zeroes → empty | No | No |

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
    G --> K[frisco.pl]
    I --> K
```

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
    E --> F[clearCart]
    F --> G{For each product}

    G --> H[searchNavigateAndCache(query)]
    H --> I{Found 'Add to cart'<br/>button?}
    I -- No --> J[Add warning result]
    I -- Yes --> K[Click 'Add to cart' x quantity]
    K --> L[Add success result]
    J --> M{Next product?}
    L --> M
    M -- Yes --> G
    M -- No --> N[Return summary]
```

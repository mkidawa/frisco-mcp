export interface CartItem {
  name: string;
  searchQuery?: string;
  quantity?: number;
}

export interface Macros {
  kcal?: string;
  protein?: string;
  fat?: string;
  carbohydrates?: string;
  sugars?: string;
  fiber?: string;
  salt?: string;
  [key: string]: string | undefined;
}

export interface Product {
  name: string;
  url: string;
  price: string;
  weight?: string | null;
  macros: Macros;
  ingredients?: string | null;
}

export interface ProductPageInfo {
  name: string;
  price: string;
  weight: string | null;
  ingredients: string | null;
  macros: Macros;
}

export interface CartItem {
  name: string;
  searchQuery?: string;
  productUrl?: string;
  quantity?: number;
}

export interface SearchResultItem {
  name: string;
  url: string | null;
  price: string;
  weight: string;
  available: boolean;
}

export interface SearchContext {
  query: string;
  searchUrl: string;
  results: SearchResultItem[];
  updatedAt: number;
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

export interface CartIssue {
  name: string;
  weight: string;
  reason: string;
  substitutes: Array<{ name: string; price: string; weight: string }>;
}

export interface Review {
  grade: number;
  body: string;
  author: string;
  date: string;
  verified: boolean;
}

export interface ProductReviews {
  productName: string;
  averageGrade: number;
  totalReviews: number;
  reviews: Review[];
}

export interface CartPromotion {
  productName: string;
  promoText: string;
  promoPrice: string;
  regularPrice: string;
}

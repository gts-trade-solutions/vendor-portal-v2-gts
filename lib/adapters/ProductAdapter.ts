import type { Product, FilterOptions, PaginationMeta, ApiResponse } from '@/types';

export interface ProductAdapter {
  getProducts(params?: {
    search?: string;
    category?: string;
    brand?: string;
    filters?: FilterOptions;
    sort?: string;
    page?: number;
    per_page?: number;
  }): Promise<ApiResponse<Product[]>>;

  getProduct(id: string): Promise<ApiResponse<Product>>;

  getProductByHandle(handle: string): Promise<ApiResponse<Product>>;

  createProduct(product: Partial<Product>): Promise<ApiResponse<Product>>;

  updateProduct(id: string, updates: Partial<Product>): Promise<ApiResponse<Product>>;

  deleteProduct(id: string): Promise<ApiResponse<void>>;

  bulkUpdateProducts(updates: Array<{ id: string; data: Partial<Product> }>): Promise<ApiResponse<Product[]>>;
}

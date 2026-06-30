import type { ProductAdapter } from '../adapters/ProductAdapter';
import type { Product, FilterOptions, ApiResponse } from '@/types';
import { mockProducts } from '../mock-data';

export class MockProductApi implements ProductAdapter {
  private async delay(ms: number = 300): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async getProducts(params?: {
    search?: string;
    category?: string;
    brand?: string;
    filters?: FilterOptions;
    sort?: string;
    page?: number;
    per_page?: number;
  }): Promise<ApiResponse<Product[]>> {
    await this.delay();

    let filtered = [...mockProducts];

    if (params?.search) {
      const search = params.search.toLowerCase();
      filtered = filtered.filter(p =>
        p.title.toLowerCase().includes(search) ||
        p.description.toLowerCase().includes(search) ||
        p.brand_name?.toLowerCase().includes(search)
      );
    }

    if (params?.category) {
      filtered = filtered.filter(p =>
        p.category_ids.includes(params.category!)
      );
    }

    if (params?.brand) {
      filtered = filtered.filter(p => p.brand_id === params.brand);
    }

    if (params?.filters) {
      const { price_min, price_max, rating, editorial_flags, in_stock } = params.filters;

      if (price_min !== undefined) {
        filtered = filtered.filter(p => p.price >= price_min);
      }

      if (price_max !== undefined) {
        filtered = filtered.filter(p => p.price <= price_max);
      }

      if (rating !== undefined) {
        filtered = filtered.filter(p => (p.rating_avg || 0) >= rating);
      }

      if (in_stock) {
        filtered = filtered.filter(p => p.inventory.qty > 0);
      }

      if (editorial_flags) {
        if (editorial_flags.trending) {
          filtered = filtered.filter(p => p.editorial_flags.trending);
        }
        if (editorial_flags.bestseller) {
          filtered = filtered.filter(p => p.editorial_flags.bestseller);
        }
        if (editorial_flags.new_arrival) {
          filtered = filtered.filter(p => p.editorial_flags.new_arrival);
        }
        if (editorial_flags.featured) {
          filtered = filtered.filter(p => p.editorial_flags.featured);
        }
      }
    }

    if (params?.sort) {
      switch (params.sort) {
        case 'price_asc':
          filtered.sort((a, b) => a.price - b.price);
          break;
        case 'price_desc':
          filtered.sort((a, b) => b.price - a.price);
          break;
        case 'rating':
          filtered.sort((a, b) => (b.rating_avg || 0) - (a.rating_avg || 0));
          break;
        case 'newest':
          filtered.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          break;
      }
    }

    const page = params?.page || 1;
    const per_page = params?.per_page || 12;
    const total = filtered.length;
    const total_pages = Math.ceil(total / per_page);
    const start = (page - 1) * per_page;
    const end = start + per_page;
    const data = filtered.slice(start, end);

    return {
      data,
      meta: {
        page,
        per_page,
        total,
        total_pages,
      },
    };
  }

  async getProduct(id: string): Promise<ApiResponse<Product>> {
    await this.delay();

    const product = mockProducts.find(p => p.id === id);

    if (!product) {
      return { data: null as any, error: 'Product not found' };
    }

    return { data: product };
  }

  async getProductByHandle(handle: string): Promise<ApiResponse<Product>> {
    await this.delay();

    const product = mockProducts.find(p => p.handle === handle);

    if (!product) {
      return { data: null as any, error: 'Product not found' };
    }

    return { data: product };
  }

  async createProduct(product: Partial<Product>): Promise<ApiResponse<Product>> {
    await this.delay();

    const newProduct: Product = {
      id: `prod_${Date.now()}`,
      title: product.title || '',
      handle: product.handle || '',
      description: product.description || '',
      brand_id: product.brand_id || '',
      category_ids: product.category_ids || [],
      price: product.price || 0,
      currency: 'INR',
      sku: product.sku || '',
      variants: product.variants || [],
      images: product.images || [],
      thumbnail: product.thumbnail || '',
      inventory: product.inventory || { qty: 0, track_inventory: true, low_stock_threshold: 5 },
      vendor_id: product.vendor_id || '',
      seo: product.seo || { meta_title: '', meta_description: '', keywords: [] },
      editorial_flags: product.editorial_flags || { trending: false, bestseller: false, new_arrival: false, featured: false },
      status: product.status || 'draft',
      visibility: product.visibility || 'site',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return { data: newProduct };
  }

  async updateProduct(id: string, updates: Partial<Product>): Promise<ApiResponse<Product>> {
    await this.delay();

    const product = mockProducts.find(p => p.id === id);

    if (!product) {
      return { data: null as any, error: 'Product not found' };
    }

    const updatedProduct = { ...product, ...updates, updated_at: new Date().toISOString() };
    return { data: updatedProduct };
  }

  async deleteProduct(id: string): Promise<ApiResponse<void>> {
    await this.delay();

    const index = mockProducts.findIndex(p => p.id === id);

    if (index === -1) {
      return { data: undefined as any, error: 'Product not found' };
    }

    return { data: undefined as any };
  }

  async bulkUpdateProducts(updates: Array<{ id: string; data: Partial<Product> }>): Promise<ApiResponse<Product[]>> {
    await this.delay();

    const updatedProducts = updates.map(update => {
      const product = mockProducts.find(p => p.id === update.id);
      if (!product) return null;
      return { ...product, ...update.data, updated_at: new Date().toISOString() };
    }).filter(Boolean) as Product[];

    return { data: updatedProducts };
  }
}

export const mockProductApi = new MockProductApi();

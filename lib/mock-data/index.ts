import productsData from './products.json';
import categoriesData from './categories.json';
import brandsData from './brands.json';
import vendorsData from './vendors.json';
import bannersData from './banners.json';
import couponsData from './coupons.json';
import productVideosData from './product-videos.json';
import influencerVideosData from './influencer-videos.json';

import type { Product, Category, Brand, Vendor, Banner, Coupon, ProductVideo, InfluencerVideo } from '@/types';

export const mockProducts = productsData as Product[];
export const mockCategories = categoriesData as Category[];
export const mockBrands = brandsData as Brand[];
export const mockVendors = vendorsData as Vendor[];
export const mockBanners = bannersData as Banner[];
export const mockCoupons = couponsData as Coupon[];
export const mockProductVideos = productVideosData as ProductVideo[];
export const mockInfluencerVideos = influencerVideosData as InfluencerVideo[];

export {
  productsData,
  categoriesData,
  brandsData,
  vendorsData,
  bannersData,
  couponsData,
  productVideosData,
  influencerVideosData
};

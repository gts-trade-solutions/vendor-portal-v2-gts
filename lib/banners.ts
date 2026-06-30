// lib/banners.ts
import { supabaseBrowser } from '@/lib/supabase-browser';
import type { Banner } from '@/types/banner';

export type BannerRow = {
  id: string;
  alt: string;
  image_path: string | null;
  video_url: string | null;
  link_url: string | null;
  position: number;
  page_scope: string;
  active: boolean;
};

export function toPublicUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  const sb = supabaseBrowser();
  return sb.storage.from('site-assets').getPublicUrl(path).data.publicUrl;
}

export function rowToBanner(row: BannerRow): Banner {
  return {
    id: row.id,
    alt: row.alt,
    image: toPublicUrl(row.image_path),
    video_url: row.video_url ?? undefined,
    link_url: row.link_url ?? undefined,
    position: row.position,
    page_scope: row.page_scope,
    active: row.active,
  };
}

/** @type {import('next').NextConfig} */
// next.config.js
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
let supabaseHost = "";
try {
  supabaseHost = new URL(supabaseUrl).hostname; // e.g. bjudxntmpfpbyloibloc.supabase.co
} catch {}

const nextConfig = {
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: supabaseHost,
        pathname: "/storage/v1/object/public/**",
      },
    ],
  },
  typescript: {
    // ❗️Allows production builds to successfully complete even if your project has type errors.
    ignoreBuildErrors: true,
  },
  eslint: {
    // (Optional) ignore ESLint errors during build too
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;

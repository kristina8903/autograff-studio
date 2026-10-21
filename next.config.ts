import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cache Components stays off (docs/DECISIONS.md D-22): every page is private
  // and per-user, so each request re-verifies the session and role rather than
  // serving a cached authorization result. partialPrefetching requires it.
  cacheComponents: false,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;

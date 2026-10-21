import type { MetadataRoute } from "next";

// Private application: nothing here should ever be indexed.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}

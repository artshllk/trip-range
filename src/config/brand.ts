import type { Metadata } from "next";

/** Presentation only. Canonical origin remains owned by the SEO registry. */
export const brand = {
  name: "Trip Range",
  logo: "/branding/trip-range/trip-range-icon-light.svg",
  socialImage: "/branding/trip-range/social-1200x630.png",
} as const;

export const brandOpenGraph = {
  siteName: brand.name,
  locale: "en_GB",
  type: "website",
  images: [
    {
      url: brand.socialImage,
      width: 1200,
      height: 630,
      alt: "Trip Range — travel within your budget",
    },
  ],
} satisfies NonNullable<Metadata["openGraph"]>;

export const brandTwitter = {
  card: "summary_large_image",
  images: [
    { url: brand.socialImage, alt: "Trip Range — travel within your budget" },
  ],
} satisfies NonNullable<Metadata["twitter"]>;

import { jsonLd } from "@/seo/publication";
export function JsonLd({ value }: { value: unknown }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLd(value) }}
    />
  );
}

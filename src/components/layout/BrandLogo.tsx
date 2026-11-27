import { brand } from "@/config/brand";

/** CSS chooses the approved surface variant without routing state or extra JS. */
export function BrandLogo() {
  return (
    <span className="brand-mark" role="img" aria-label={brand.name}>
      <span className="brand-fallback" aria-hidden="true">
        {brand.name}
      </span>
    </span>
  );
}

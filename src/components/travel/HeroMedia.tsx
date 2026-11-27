"use client";
import { getImageProps } from "next/image";
import { useEffect, useRef } from "react";
/** Below this width the hero is a tall box: a portrait crop covers it at screen width. */
const MOBILE_HERO = "(max-width: 899px)";
/**
 * Poster always exists in SSR. No video URL is attached until all load gates pass.
 * Phones get `mobilePoster` (art direction), so they download an image about as
 * wide as the screen instead of a landscape one scaled to cover a portrait box.
 */
export function HeroMedia({
  poster,
  mobilePoster,
  video,
}: {
  poster: string;
  mobilePoster?: string;
  video?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!video) return;
    const desktop = matchMedia("(min-width: 720px)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const connection = (
      navigator as Navigator & {
        connection?: {
          saveData?: boolean;
          addEventListener?: EventTarget["addEventListener"];
          removeEventListener?: EventTarget["removeEventListener"];
        };
      }
    ).connection;
    let media: HTMLVideoElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const remove = () => {
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
        media.remove();
        media = null;
      }
    };
    const update = () => {
      if (!desktop.matches || reduced.matches || connection?.saveData) {
        remove();
        return;
      }
      if (document.readyState !== "complete" || media) return;
      media = document.createElement("video");
      media.muted = true;
      media.loop = true;
      media.playsInline = true;
      media.autoplay = true;
      media.preload = "none";
      media.setAttribute("aria-hidden", "true");
      media.addEventListener("playing", () => media?.classList.add("playing"));
      media.addEventListener("error", remove, { once: true });
      media.src = video;
      host.current?.appendChild(media);
      void media.play().catch(remove);
    };
    const loaded = () => {
      timer = setTimeout(update, 600);
    };
    if (document.readyState === "complete") loaded();
    else window.addEventListener("load", loaded, { once: true });
    desktop.addEventListener("change", update);
    reduced.addEventListener("change", update);
    connection?.addEventListener?.("change", update);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("load", loaded);
      desktop.removeEventListener("change", update);
      reduced.removeEventListener("change", update);
      connection?.removeEventListener?.("change", update);
      remove();
    };
  }, [video]);
  // The photo sits under a dark shade, so quality 50 is visually the same as 75
  // at about two-thirds of the bytes; it is the page's LCP element.
  const common = { alt: "", fill: true, sizes: "100vw", quality: 50 } as const;
  const { props: desktop } = getImageProps({ ...common, src: poster });
  const mobile = mobilePoster
    ? getImageProps({ ...common, src: mobilePoster }).props
    : undefined;
  return (
    <div className="hero-media" ref={host}>
      <picture>
        {mobile ? (
          <source
            media={MOBILE_HERO}
            srcSet={mobile.srcSet}
            sizes={mobile.sizes}
          />
        ) : null}
        {/* The LCP element: fetched early without a viewport-blind preload. */}
        <img {...desktop} alt="" fetchPriority="high" loading="eager" />
      </picture>
    </div>
  );
}

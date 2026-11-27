"use client";
import Image, { type ImageProps } from "next/image";
import { createContext, useContext, useState, type ReactNode } from "react";
import type { Destination, ImageAsset } from "../../domain/types";
import { displayedDestinationImage } from "../../domain/destination-images";
import { destinationImageCopy } from "../../i18n/destination-images";
import type { Locale } from "../../i18n/config";

const ImageContext = createContext<{
  image: ImageAsset | undefined;
  destinationName: string;
  locale: Locale;
  fail: () => void;
} | null>(null);

/** One fail-closed boundary for photo rendering and attribution, including cached old candidates. */
export function ImageAssetBoundary({
  image,
  fallback,
  destination,
  locale,
  children,
}: {
  image: ImageAsset | null | undefined;
  fallback?: ImageAsset;
  destination: Pick<Destination, "id" | "name">;
  locale: Locale;
  children: ReactNode;
}) {
  const [failed, setFailed] = useState<string[]>([]);
  const displayed = displayedDestinationImage(
    image,
    fallback,
    destination.id,
    failed,
  );
  return (
    <ImageContext.Provider
      value={{
        image: displayed,
        destinationName: destination.name[locale],
        locale,
        fail: () => {
          if (displayed) setFailed((previous) => [...previous, displayed.src]);
        },
      }}
    >
      {children}
    </ImageContext.Provider>
  );
}

/** No context or rejected/failed image means no credit, never the supplied untrusted asset. */
export function useDisplayedImage() {
  return useContext(ImageContext)?.image;
}

/** Removes attribution wrappers and controls as well as text when there is no photograph. */
export function WhenDestinationPhoto({ children }: { children: ReactNode }) {
  return useDisplayedImage() ? children : null;
}

export function NoDestinationImage({
  destinationName,
  locale,
}: {
  destinationName: string;
  locale: Locale;
}) {
  const message = destinationImageCopy[locale].unavailable;
  return (
    <div
      className="destination-no-image"
      role="img"
      aria-label={`${destinationName}: ${message}`}
    >
      <span className="destination-no-image-mark" aria-hidden="true" />
      <span className="destination-no-image-label" aria-hidden="true">
        {message}
      </span>
    </div>
  );
}

export function DestinationImage({
  fallbackAlt,
  ...props
}: Omit<ImageProps, "src" | "alt" | "onError"> & { fallbackAlt: string }) {
  const context = useContext(ImageContext);
  if (!context) throw new Error("DestinationImage requires ImageAssetBoundary");
  if (!context.image)
    return (
      <NoDestinationImage
        destinationName={context.destinationName}
        locale={context.locale}
      />
    );
  const image = context.image;
  const alt = image.localizedAlt?.[context.locale] ?? image.alt ?? fallbackAlt;
  const style = {
    ...props.style,
    ...(image.focalPoint
      ? {
          objectPosition: `${image.focalPoint.x * 100}% ${image.focalPoint.y * 100}%`,
        }
      : {}),
  };
  if (image.localVariants) {
    const intrinsic = image.localVariants.find(
      (variant) => variant.src === image.src,
    )!;
    // The approved files are already optimized. Native width descriptors retain
    // their real dimensions; no loader, remote service or duplicate fixed preload.
    return (
      // eslint-disable-next-line @next/next/no-img-element -- pre-optimized local srcset
      <img
        src={image.src}
        srcSet={image.localVariants
          .map((variant) => `${variant.src} ${variant.width}w`)
          .join(", ")}
        sizes={props.sizes ?? (props.width ? `${props.width}px` : "100vw")}
        alt={alt}
        width={props.width ?? intrinsic.width}
        height={props.height ?? intrinsic.height}
        className={props.className}
        id={props.id}
        title={props.title}
        loading={props.preload ? "eager" : (props.loading ?? "lazy")}
        fetchPriority={props.preload ? "high" : props.fetchPriority}
        decoding={props.decoding ?? "async"}
        style={{
          ...(props.fill
            ? ({
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
              } as const)
            : {}),
          ...style,
        }}
        onLoad={props.onLoad}
        onError={context.fail}
      />
    );
  }
  return (
    <Image
      {...props}
      src={image.src}
      alt={alt}
      style={style}
      onError={context.fail}
    />
  );
}

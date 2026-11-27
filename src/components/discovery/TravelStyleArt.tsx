import type { TripStyle } from "@/domain/types";
/** Decorative, photo-free artwork: no unapproved destination or stock imagery. */
export function TravelStyleArt({ style }: { style: TripStyle }) {
  return (
    <svg
      className="home-style-art"
      viewBox="0 0 280 240"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="205" cy="56" r="27" fill="currentColor" opacity=".22" />
      {style === "city" ? (
        <g stroke="currentColor" strokeWidth="2">
          <path d="M25 210V102h52v108M85 210V63h60v147M154 210V118h44v92M208 210V85h45v125M18 210h244M115 63V36" />
          <path
            d="M39 120h24m-24 20h24m-24 20h24m36-77h32m-32 22h32m-32 22h32m-32 22h32m-32 22h32m37-34h16m-16 23h16m36-55h18m-18 23h18m-18 23h18"
            opacity=".6"
          />
        </g>
      ) : style === "nature" ? (
        <g stroke="currentColor" strokeWidth="2">
          <path d="m10 210 90-144 75 144M126 210l65-108 80 108M75 107l25 17 19-13M21 210h248M35 151V98m-19 31 19-32 19 32m-43 23 24-37 24 37" />
          <path d="m100 66 12 63 63 81M191 102l-10 58 90 50" opacity=".5" />
        </g>
      ) : style === "quiet" ? (
        <g stroke="currentColor" strokeWidth="2">
          <path d="M70 108h109v40a43 43 0 0 1-43 43h-23a43 43 0 0 1-43-43v-40ZM179 114h16a22 22 0 0 1 0 44h-17M47 202h166M101 88c-16-19 17-25 0-44m33 44c-16-19 17-25 0-44" />
          <path
            d="M34 215h218M218 190v-53m0 21c-29-3-26-24-26-24 28 0 26 24 26 24Zm1-9c25-4 24-23 24-23-24 0-24 23-24 23Z"
            opacity=".6"
          />
        </g>
      ) : (
        <g stroke="currentColor" strokeWidth="2">
          <path d="M15 165q31-20 62 0t62 0 62 0 62 0M15 188q31-20 62 0t62 0 62 0 62 0M15 211q31-20 62 0t62 0 62 0 62 0M102 150V58M97 61 44 139h53M110 79l37 60h-37" />
          <path d="M37 147h121l-15 15H51Z" fill="currentColor" opacity=".2" />
        </g>
      )}
    </svg>
  );
}

/** Incremental policy: Next's inline hydration requires unsafe-inline until a nonce migration. */
export function securityHeaders(production: boolean) {
  const policy = [
    "default-src 'self'",
    // No third-party scripts: analytics stay off (launch decision), so the Vercel
    // Analytics allowances were removed on 25 November 2026.
    `script-src 'self' 'unsafe-inline'${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://upload.wikimedia.org https://images.pexels.com",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=()",
    },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: policy },
  ];
}

/** Preview response policy supplements deployment protection; canonicals remain the public host. */
export function deploymentIndexingHeaders(
  mode: import("./deployment").DeploymentMode,
) {
  return mode === "preview" || mode === "invalid"
    ? [{ key: "X-Robots-Tag", value: "noindex, nofollow" }]
    : [];
}

/** The one public host. Every other host serving production is an alias. */
export const canonicalHost = "www.trip-range.com";

/**
 * Production only: any host other than the canonical one (the netlify.app
 * alias, per-deploy permalinks) answers noindex, so the alias cannot be indexed
 * as a duplicate. Deliberately not a redirect: per-deploy permalinks must stay
 * reachable to verify a deploy or a rollback. Previews are already noindex.
 */
export function aliasIndexingRules(
  mode: import("./deployment").DeploymentMode,
) {
  return mode === "production"
    ? [
        {
          source: "/:path*",
          missing: [
            {
              type: "host" as const,
              value: canonicalHost.replace(/\./g, "\\."),
            },
          ],
          headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
        },
      ]
    : [];
}

/** Incremental policy: Next's inline hydration requires unsafe-inline until a nonce migration. */
export function securityHeaders(production: boolean) {
  const policy = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${production ? "" : "'unsafe-eval' "}https://va.vercel-scripts.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://upload.wikimedia.org https://images.pexels.com",
    "font-src 'self'",
    "connect-src 'self' https://vitals.vercel-insights.com",
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

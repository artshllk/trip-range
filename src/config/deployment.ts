/** Server environment inputs only, never request headers. Local production builds are still local. */
export type DeploymentMode =
  | "local"
  | "test"
  | "preview"
  | "production"
  | "invalid";
const netlifySignals = [
  "NETLIFY",
  "NETLIFY_DEV",
  "CONTEXT",
  "SITE_ID",
  "GOEKSPLO_NETLIFY_CONTEXT",
];
export function deploymentMode(
  env: Record<string, string | undefined>,
  buildContext?: string,
): DeploymentMode {
  const netlify =
    !!buildContext || netlifySignals.some((key) => env[key] !== undefined);
  if (netlify) {
    // CONTEXT is a build signal. Netlify does not expose it to Functions.
    // The explicit project variable must also be configured for Functions.
    const context = env.GOEKSPLO_NETLIFY_CONTEXT;
    const nativeContext = env.CONTEXT;
    if (
      env.VERCEL?.trim() ||
      env.VERCEL_ENV?.trim() ||
      (env.NETLIFY !== undefined && env.NETLIFY !== "true") ||
      (env.NETLIFY_DEV !== undefined && env.NETLIFY_DEV !== "true") ||
      (env.SITE_ID !== undefined &&
        !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(env.SITE_ID)) ||
      !["production", "deploy-preview", "branch-deploy", "dev"].includes(
        context ?? "",
      ) ||
      (buildContext !== undefined && buildContext !== context) ||
      (nativeContext !== undefined && nativeContext !== context)
    )
      return "invalid";
    if (context === "dev")
      return env.NETLIFY_DEV === "true" && nativeContext === "dev"
        ? "local"
        : "invalid";
    if (
      env.NETLIFY_DEV !== undefined ||
      (env.NETLIFY !== "true" && !env.SITE_ID)
    )
      return "invalid";
    return context === "production" ? "production" : "preview";
  }
  const platform = env.VERCEL?.trim() || "";
  const target = env.VERCEL_ENV?.trim() || "";
  if (
    !["", "0", "1"].includes(platform) ||
    !["", "development", "preview", "production"].includes(target)
  )
    return "invalid";
  if (target === "production" || target === "preview")
    return platform === "0" ? "invalid" : target;
  if (platform === "1" && !target) return "invalid";
  return env.NODE_ENV === "test" || env.CI === "true" ? "test" : "local";
}
/** Called by next.config only. Native CONTEXT is reserved by Netlify at build time. */
export function netlifyBuildContext(env: Record<string, string | undefined>) {
  if (!netlifySignals.some((key) => env[key] !== undefined)) return "";
  if (
    deploymentMode(env) === "invalid" ||
    !env.CONTEXT ||
    (env.NETLIFY !== "true" &&
      !(env.NETLIFY_DEV === "true" && env.CONTEXT === "dev"))
  )
    throw Error("Invalid Netlify build context");
  return env.CONTEXT;
}
/** Only a validated Vercel deployment may load Vercel's browser endpoints. */
export function vercelAnalyticsEnabled(
  env: Record<string, string | undefined>,
  buildContext?: string,
) {
  return (
    deploymentMode(env, buildContext) !== "invalid" &&
    (env.VERCEL === "1" ||
      env.VERCEL_ENV === "production" ||
      env.VERCEL_ENV === "preview")
  );
}
export type LimiterState = "local" | "distributed" | "required-but-unavailable";
export function limiterPolicy(
  mode: DeploymentMode,
  configured: boolean,
  malformed: boolean,
  providerCredentialsPresent: boolean,
): LimiterState {
  if (mode === "invalid" || malformed) return "required-but-unavailable";
  if (configured) return "distributed";
  return mode === "production" ||
    (mode === "preview" && providerCredentialsPresent)
    ? "required-but-unavailable"
    : "local";
}
/** Fixed application/version/environment scope; diagnostic IDs are random, never user data. */
export function limiterNamespace(mode: DeploymentMode, diagnosticId?: string) {
  if (
    !["local", "test", "preview", "production", "invalid"].includes(mode) ||
    (diagnosticId !== undefined && !/^[a-f0-9]{32}$/.test(diagnosticId))
  )
    throw Error("Invalid limiter namespace");
  return `goeksplo:v2:${mode}${diagnosticId ? `:diagnostic:${diagnosticId}` : ""}`;
}
export function validLimiterNamespace(value: string) {
  return /^goeksplo:v2:(local|test|preview|production|invalid)(?::diagnostic:[a-f0-9]{32})?$/.test(
    value,
  );
}

import "server-only";
/** Next can use an internal hostname in request.url. The HTTP Host identifies the browser-facing origin.
 * Origin checks are CSRF boundaries, not authentication; shared quotas also cover non-browser clients.
 * Never trust arbitrary X-Forwarded-Host/Proto supplied by a caller.
 */
export function matchesRequestOrigin(
  request: Request,
  origin: string,
): boolean {
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host");
    if (host) {
      if (!/^(?:[a-z0-9.-]+|\[[a-f0-9:]+\])(?::\d{1,5})?$/i.test(host))
        return false;
    }
    const supplied = new URL(origin);
    return (
      ["http:", "https:"].includes(supplied.protocol) &&
      supplied.origin === origin &&
      supplied.origin ===
        (host ? new URL(`${url.protocol}//${host}`) : url).origin
    );
  } catch {
    return false;
  }
}

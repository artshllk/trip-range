import "server-only";
/** Bounded body including slow-upload deadline. Callers retain their own origin/method policy. */
export async function boundedJson(
  request: Request,
  maxBytes: number,
  timeoutMs = 2000,
): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) return;
  const reader = request.body?.getReader();
  if (!reader) return;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      void reader.cancel().catch(() => {});
      resolve(undefined);
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      deadline,
      (async () => {
        let size = 0,
          text = "";
        const decoder = new TextDecoder();
        while (true) {
          const c = await reader.read();
          if (c.done) break;
          size += c.value.byteLength;
          if (size > maxBytes) {
            await reader.cancel();
            return;
          }
          text += decoder.decode(c.value, { stream: true });
        }
        try {
          return JSON.parse(text + decoder.decode());
        } catch {
          return;
        }
      })(),
    ]);
  } catch {
    return;
  } finally {
    clearTimeout(timer!);
  }
}

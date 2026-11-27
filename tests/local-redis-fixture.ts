import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

/** Optional real-Redis test transport. No Upstash, credentials or TCP listener;
 * the disposable server has persistence disabled and a private Unix socket.
 */
export async function localRedis() {
  const dir = await mkdtemp(join(tmpdir(), "goeksplo-redis-"));
  const socket = join(dir, "redis.sock");
  const child = spawn(
    process.env.GOEKSPLO_TEST_REDIS_SERVER ?? "redis-server",
    [
      "--port",
      "0",
      "--unixsocket",
      socket,
      "--unixsocketperm",
      "700",
      "--save",
      "",
      "--appendonly",
      "no",
      "--dir",
      dir,
    ],
    { stdio: "ignore" },
  );
  let spawnError: Error | undefined;
  child.on("error", (error) => {
    spawnError = error;
  });
  // Bound local socket pressure while keeping every concurrent admission call.
  // Redis still executes the real Lua atomically; no admission replies are mocked.
  let active = 0;
  const waiting: (() => void)[] = [];
  async function command(parts: readonly string[]): Promise<unknown> {
    if (active >= 32)
      await new Promise<void>((resolve) => waiting.push(resolve));
    else active++;
    try {
      return await new Promise((resolve, reject) => {
        const client = createConnection(socket);
        let raw = "";
        client.setTimeout(2000, () => {
          client.destroy();
          reject(Error("Local Redis timeout"));
        });
        client.on("error", reject);
        client.on("connect", () =>
          client.write(
            `*${parts.length}\r\n` +
              parts.map((p) => `$${Buffer.byteLength(p)}\r\n${p}\r\n`).join(""),
          ),
        );
        client.on("data", (chunk) => {
          raw += chunk.toString();
          const end = raw.indexOf("\r\n");
          if (end < 0) return;
          const prefix = raw[0],
            value = raw.slice(1, end);
          if (prefix === ":" || prefix === "+") {
            client.end();
            resolve(prefix === ":" ? Number(value) : value);
          } else if (prefix === "-") {
            client.end();
            reject(Error(value));
          } else if (
            prefix === "$" &&
            raw.length >= end + 2 + Number(value) + 2
          ) {
            client.end();
            resolve(raw.slice(end + 2, end + 2 + Number(value)));
          }
        });
      });
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active--;
    }
  }
  let ready = false;
  for (let n = 0; n < 50 && !spawnError; n++) {
    try {
      await command(["PING"]);
      ready = true;
      break;
    } catch {
      await sleep(10);
    }
  }
  async function close() {
    if (child.exitCode === null && !spawnError) {
      const exit = new Promise<void>((resolve) =>
        child.once("exit", () => resolve()),
      );
      child.kill();
      await exit;
    }
    await rm(dir, { recursive: true, force: true });
  }
  if (!ready) {
    await close();
    if (
      spawnError &&
      "code" in spawnError &&
      spawnError.code === "ENOENT" &&
      process.env.GOEKSPLO_REQUIRE_TEST_REDIS !== "1"
    )
      return undefined;
    throw Error("Disposable Redis did not start");
  }
  const fetcher: typeof fetch = async (_url, options) =>
    Response.json({ result: await command(JSON.parse(String(options?.body))) });
  return { command, fetcher, close };
}

// External scheduler for GitHub Actions (owner decision, 23 November 2026).
// GitHub's own cron delivered 1-7 of 28 daily triggers; Upstash QStash calls the
// workflow_dispatch API instead, and each workflow keeps its cron as a fallback.
//
//   node --env-file=.env.local scripts/qstash-schedules.mjs plan      # print, no network
//   node --env-file=.env.local scripts/qstash-schedules.mjs token     # check the GitHub token, print its expiry
//   node --env-file=.env.local scripts/qstash-schedules.mjs apply     # create/update every schedule (idempotent)
//   node --env-file=.env.local scripts/qstash-schedules.mjs list      # show schedules (no header values)
//   node --env-file=.env.local scripts/qstash-schedules.mjs test warm-coverage.yml
//                                                          # one QStash delivery now (read-only workflow)
//   node --env-file=.env.local scripts/qstash-schedules.mjs prune     # delete goeksplo-* schedules no longer defined
//
// Environment (never printed): QSTASH_TOKEN, optional QSTASH_URL (default EU region),
// GITHUB_TOKEN = fine-grained PAT for this repository only, "Actions: Read and write".
// The token is forwarded with Upstash-Forward-Authorization and redacted
// (Upstash-Redact-Fields: header[Authorization]); QStash shows only a hash of it.

import { pathToFileURL } from "node:url";

const repository = "artshllk/goeksplo";
const ref = "main";
const prefix = "goeksplo-";

/** Every scheduled workflow. Times are UTC; GitHub's fallback cron uses the same. */
export const schedules = [
  {
    id: "fare-warm-sweep",
    cron: "17 4,16 * * *",
    workflow: "fare-warm.yml",
    inputs: { mode: "sweep" },
  },
  {
    id: "fare-warm-catch-up",
    // Every three hours (owner decision, 27 November 2026, to cut Actions minutes):
    // 05:47 and 17:47 follow the 04:17 and 16:17 sweeps by about 90 minutes.
    cron: "47 2-23/3 * * *",
    workflow: "fare-warm.yml",
    inputs: { mode: "catch-up" },
  },
  { id: "warm-coverage", cron: "23 8 * * *", workflow: "warm-coverage.yml" },
  { id: "expiry-audit", cron: "37 8 * * *", workflow: "expiry-audit.yml" },
  { id: "fx-refresh", cron: "30 16 * * 1-5", workflow: "fx-refresh.yml" },
  { id: "ine-rooms", cron: "20 10 24,28 * *", workflow: "ine-rooms.yml" },
  // Independent of the collector: reads the store and raises an issue after 20 hours
  // without a full successful collection. Every three hours (27 November 2026): the
  // alert comes 20-23 hours after the last success instead of 20-21.
  {
    id: "collector-watchdog",
    cron: "7 */3 * * *",
    workflow: "collector-watchdog.yml",
  },
];

const qstash = (process.env.QSTASH_URL || "https://qstash.upstash.io").replace(
  /\/$/,
  "",
);
const secrets = [process.env.QSTASH_TOKEN, process.env.GITHUB_TOKEN].filter(
  Boolean,
);
const scrub = (text) =>
  secrets.reduce((t, s) => t.split(s).join("<redacted>"), String(text));

function need(name) {
  if (!process.env[name]) {
    console.error(`${name} is not set (expected in .env.local)`);
    process.exit(2);
  }
  return process.env[name];
}

const dispatchUrl = (workflow) =>
  `https://api.github.com/repos/${repository}/actions/workflows/${workflow}/dispatches`;
const body = (s) =>
  JSON.stringify({ ref, ...(s.inputs ? { inputs: s.inputs } : {}) });

function qstashHeaders(s, { schedule }) {
  const headers = {
    Authorization: `Bearer ${need("QSTASH_TOKEN")}`,
    "Content-Type": "application/json",
    "Upstash-Method": "POST",
    "Upstash-Retries": "3",
    "Upstash-Timeout": "30s",
    "Upstash-Redact-Fields": "header[Authorization]",
    "Upstash-Forward-Authorization": `Bearer ${need("GITHUB_TOKEN")}`,
    "Upstash-Forward-Accept": "application/vnd.github+json",
    "Upstash-Forward-X-GitHub-Api-Version": "2022-11-28",
    "Upstash-Forward-User-Agent": "goeksplo-qstash-scheduler",
  };
  if (schedule) {
    headers["Upstash-Cron"] = `CRON_TZ=UTC ${s.cron}`;
    headers["Upstash-Schedule-Id"] = prefix + s.id;
  }
  return headers;
}

async function call(method, path, init = {}) {
  const res = await fetch(qstash + path, {
    method,
    ...init,
    headers: {
      Authorization: `Bearer ${need("QSTASH_TOKEN")}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok)
    throw Error(
      `${method} ${path.split("/").slice(0, 3).join("/")} -> ${res.status} ${scrub(text).slice(0, 300)}`,
    );
  return text ? JSON.parse(text) : null;
}

async function checkToken() {
  const token = need("GITHUB_TOKEN");
  const res = await fetch(
    `https://api.github.com/repos/${repository}/actions/workflows`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "goeksplo-qstash-scheduler",
      },
    },
  );
  const expiry = res.headers.get("github-authentication-token-expiration");
  console.log(
    `GitHub token: HTTP ${res.status}; expires ${expiry ?? "not reported (classic token or no expiry)"}`,
  );
  if (!res.ok) process.exitCode = 1;
  return { ok: res.ok, expiry };
}

async function main() {
  const command = process.argv[2] ?? "plan";
  if (command === "plan") {
    for (const s of schedules)
      console.log(
        `${prefix}${s.id}\tCRON_TZ=UTC ${s.cron}\tPOST ${dispatchUrl(s.workflow)}\t${body(s)}`,
      );
  } else if (command === "token") {
    await checkToken();
  } else if (command === "apply") {
    const { ok } = await checkToken();
    if (!ok) {
      console.error(
        "Refusing to create schedules with a token GitHub rejects.",
      );
      process.exit(1);
    }
    for (const s of schedules) {
      const r = await call("POST", `/v2/schedules/${dispatchUrl(s.workflow)}`, {
        headers: qstashHeaders(s, { schedule: true }),
        body: body(s),
      });
      console.log(
        `upserted ${r.scheduleId}\tCRON_TZ=UTC ${s.cron}\t${s.workflow} ${s.inputs ? JSON.stringify(s.inputs) : ""}`,
      );
    }
  } else if (command === "list") {
    const all = await call("GET", "/v2/schedules");
    for (const s of all
      .filter((x) => x.scheduleId.startsWith(prefix))
      .sort((a, b) => a.scheduleId.localeCompare(b.scheduleId))) {
      const auth =
        (s.header?.Authorization ?? s.header?.authorization ?? [])[0] ?? "";
      console.log(
        [
          s.scheduleId,
          s.cron,
          s.destination
            .replace(/^.*\/workflows\//, "")
            .replace("/dispatches", ""),
          s.body ?? "",
          s.isPaused ? "PAUSED" : "active",
          `retries=${s.retries}`,
          `auth=${auth.startsWith("REDACTED:") ? "redacted" : auth ? "PRESENT-UNREDACTED" : "missing"}`,
          `last=${s.lastScheduleTime ? new Date(s.lastScheduleTime).toISOString() : "-"}`,
          `next=${s.nextScheduleTime ? new Date(s.nextScheduleTime).toISOString() : "-"}`,
          `lastStates=${JSON.stringify(s.lastScheduleStates ?? {})}`,
        ].join("\t"),
      );
    }
  } else if (command === "test") {
    const workflow = process.argv[3];
    const s = schedules.find((x) => x.workflow === workflow);
    if (!s)
      throw Error(
        "Expected a scheduled workflow file name, e.g. warm-coverage.yml",
      );
    const r = await call("POST", `/v2/publish/${dispatchUrl(s.workflow)}`, {
      headers: qstashHeaders(s, { schedule: false }),
      body: body(s),
    });
    console.log(
      `published one delivery for ${workflow}: messageId ${r.messageId}`,
    );
  } else if (command === "prune") {
    const all = await call("GET", "/v2/schedules");
    const keep = new Set(schedules.map((s) => prefix + s.id));
    for (const s of all.filter(
      (x) => x.scheduleId.startsWith(prefix) && !keep.has(x.scheduleId),
    )) {
      await call("DELETE", `/v2/schedules/${s.scheduleId}`);
      console.log(`deleted ${s.scheduleId}`);
    }
  } else {
    console.error(
      "Commands: plan | token | apply | list | test <workflow.yml> | prune",
    );
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();

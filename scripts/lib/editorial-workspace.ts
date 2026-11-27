import {
  lstatSync,
  readdirSync,
  readFileSync,
  openSync,
  writeFileSync,
  fsyncSync,
  fchmodSync,
  closeSync,
  renameSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join, resolve, relative, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  object,
  keys,
  subjectId,
  text,
} from "../../src/domain/places/validation";
import {
  isEditorialReview,
  type DestinationEditorialReview,
} from "../../src/content/operator/editorial";
import { loadContentOperations } from "./content-operations";
import type { EditorialFinding, ReviewInputs } from "./editorial-review";

export type EditorialWorkspace = ReturnType<typeof loadEditorialWorkspace>;

export function safeLocalFile(root: string, path: string): void {
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || resolve(root, rel) !== path)
    throw Error("unsafe-local-path");
  let current = root;
  if (lstatSync(current).isSymbolicLink()) throw Error("symlink-root");
  for (const part of rel.split("/").slice(0, -1)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("unsafe-local-directory");
  }
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 256_000
    )
      throw Error("unsafe-local-file");
  } else {
    // existsSync follows links; lstat also rejects dangling symlinks.
    try {
      lstatSync(path);
      throw Error("unsafe-local-file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** Reads source-controlled files only. No mutation path comes from CLI input. */
export function loadEditorialWorkspace(
  root = process.cwd(),
  operations = loadContentOperations(),
  now = Date.now(),
) {
  root = resolve(root);
  const watched = new Map<string, string | null>();
  const read = (path: string): string => {
    safeLocalFile(root, path);
    const raw = readFileSync(path, "utf8");
    if (Buffer.byteLength(raw) > 256_000) throw Error("local-file-too-large");
    watched.set(path, raw);
    return raw;
  };
  const contentFiles = new Map<string, string>();
  const records = new Map(
    operations.data.records.map((r) => [r.destinationId, r]),
  );
  for (const name of readdirSync(join(root, "content/destinations")).filter(
    (name) => name.endsWith(".json"),
  )) {
    const path = join(root, "content/destinations", name),
      record = JSON.parse(read(path));
    if (
      contentFiles.has(record.destinationId) ||
      !isDeepStrictEqual(record, records.get(record.destinationId))
    )
      throw Error("content-file-manifest-mismatch");
    contentFiles.set(record.destinationId, path);
  }
  if (contentFiles.size !== records.size) throw Error("content-file-missing");
  read(join(root, "content/destinations/records.ts"));
  // Watch the exact persisted dependencies as well as the content record.
  for (const directory of [
    "content/places",
    "content/research/destinations",
    "content/operations/queue",
  ])
    for (const name of readdirSync(join(root, directory)).filter((name) =>
      /\.(json|ts)$/.test(name),
    ))
      read(join(root, directory, name));
  const findingsData: unknown = JSON.parse(
    read(join(root, "content/operations/editorial-findings.json")),
  );
  if (
    !object(findingsData) ||
    !keys(findingsData, ["schemaVersion", "records"]) ||
    findingsData.schemaVersion !== 1 ||
    !Array.isArray(findingsData.records)
  )
    throw Error("invalid-editorial-findings");
  const findings = new Map<string, EditorialFinding[]>();
  for (const row of findingsData.records) {
    if (
      !object(row) ||
      !keys(row, ["destinationId", "findings"]) ||
      !subjectId(row.destinationId) ||
      !records.has(row.destinationId) ||
      findings.has(row.destinationId) ||
      !Array.isArray(row.findings) ||
      row.findings.length > 50
    )
      throw Error("invalid-editorial-findings");
    const ids = new Set<string>();
    for (const finding of row.findings) {
      if (
        !object(finding) ||
        !keys(finding, ["id", "message"]) ||
        !subjectId(finding.id) ||
        !text(finding.message, 2000) ||
        ids.has(finding.id)
      )
        throw Error("invalid-editorial-finding");
      ids.add(finding.id);
    }
    findings.set(row.destinationId, row.findings as EditorialFinding[]);
  }
  const reviews = new Map<string, DestinationEditorialReview>();
  const reviewDirectory = join(root, "content/operations/reviews");
  safeLocalFile(root, join(reviewDirectory, ".mutation.lock"));
  for (const name of readdirSync(reviewDirectory).filter((name) =>
    name.endsWith(".json"),
  )) {
    const review: unknown = JSON.parse(read(join(reviewDirectory, name)));
    if (
      !isEditorialReview(review, now) ||
      reviews.has(review.destinationId) ||
      !contentFiles.has(review.destinationId) ||
      name !== basename(contentFiles.get(review.destinationId)!)
    )
      throw Error("invalid-or-orphan-editorial-review");
    reviews.set(review.destinationId, review);
  }
  const identities = new Map(
    operations.context.identities.map((r) => [r.subject, r]),
  );
  const research = new Map(
    operations.research.map((r) => [r.destinationId, r]),
  );
  const inputs = new Map<string, ReviewInputs>();
  for (const [id, record] of records) {
    const identity = identities.get(record.identitySubject);
    if (!identity) throw Error("missing-identity");
    const evidence = research.get(id);
    inputs.set(id, {
      record,
      identity,
      research: evidence,
      evidence: operations.evidence.get(id) ?? "missing",
      findings: findings.get(id) ?? [],
      now,
      evidenceText: evidence?.report
        ? read(join(root, "docs/research/destination-content", evidence.report))
        : "",
    });
    const reviewPath = join(reviewDirectory, basename(contentFiles.get(id)!));
    if (!watched.has(reviewPath)) {
      safeLocalFile(root, reviewPath);
      watched.set(reviewPath, null);
    }
  }
  return { root, inputs, reviews, contentFiles, reviewDirectory, watched };
}

/** One atomic file replacement; preserve mode, reject concurrent edits and linked paths. */
export function writeEditorialFile(
  workspace: EditorialWorkspace,
  path: string,
  value: unknown,
): void {
  if (
    !workspace.watched.has(path) ||
    ![
      ...workspace.contentFiles.values(),
      ...[...workspace.contentFiles.values()].map((file) =>
        join(workspace.reviewDirectory, basename(file)),
      ),
    ].includes(path)
  )
    throw Error("mutation-path-not-allowed");
  const lock = join(workspace.reviewDirectory, ".mutation.lock");
  safeLocalFile(workspace.root, lock);
  const lockFd = openSync(lock, "wx", 0o600);
  const temp = join(workspace.reviewDirectory, `.write-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    const serialized = JSON.stringify(value, null, 2) + "\n";
    if (Buffer.byteLength(serialized) > 256_000)
      throw Error("mutation-too-large");
    for (const [file, expected] of workspace.watched) {
      safeLocalFile(workspace.root, file);
      const current = existsSync(file) ? readFileSync(file, "utf8") : null;
      if (current !== expected)
        throw Error("concurrent-source-edit-rerun-review");
    }
    const mode = existsSync(path) ? lstatSync(path).mode & 0o777 : 0o600;
    fd = openSync(temp, "wx", mode);
    fchmodSync(fd, mode);
    writeFileSync(fd, serialized);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    safeLocalFile(workspace.root, path);
    renameSync(temp, path);
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temp)) unlinkSync(temp);
    closeSync(lockFd);
    unlinkSync(lock);
  }
}

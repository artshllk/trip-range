import { subjectId } from "../../domain/media/validation";

export function parseContentResearchArguments(args: readonly string[]): {
  destination: string;
  live: boolean;
} {
  let destination: string | undefined;
  let live = false;
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (seen.has(flag)) throw Error("invalid-arguments");
    seen.add(flag);
    if (flag === "--live") live = true;
    else if (flag === "--destination") destination = args[++index];
    else throw Error("invalid-arguments");
  }
  if (!subjectId(destination)) throw Error("invalid-arguments");
  return { destination, live };
}

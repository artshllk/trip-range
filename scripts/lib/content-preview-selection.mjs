/** Bounded explicit review sample; never changes the production store. */
export function selectPreviewRecords(
  records,
  selection = process.env.VERIFY_DESTINATIONS,
) {
  const ids = selection
    ? selection.split(",")
    : ["city:BCN", "crete", "prishtina"];
  if (!ids.length || ids.length > 8 || new Set(ids).size !== ids.length)
    throw Error("Select between one and eight distinct draft IDs for preview");
  return ids.map((id) => {
    const record = records.find((record) => record.destinationId === id);
    if (!record || record.reviewStatus !== "draft")
      throw Error("Unknown or non-draft preview ID");
    return record;
  });
}

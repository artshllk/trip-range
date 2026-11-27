"use client";
import { useState } from "react";
import type { TripRequest } from "@/domain/types";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionaries";
import { resultsCopy } from "@/i18n/results";
import { SearchBar } from "./SearchBar";
import { SearchDialog } from "./SearchDialog";

/** Mount only while open: every opening starts from the applied request. */
export function SearchSheet({
  request,
  locale,
  t,
  today,
  filtersOnly = false,
  results = false,
  onClose,
}: {
  request: TripRequest;
  locale: Locale;
  t: Dictionary;
  today: string;
  filtersOnly?: boolean;
  results?: boolean;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <SearchDialog
      title={filtersOnly ? resultsCopy[locale].filters : t.editSearch}
      closeLabel={t.cancelSearch}
      closeAction={false}
      busy={pending}
      onClose={onClose}
      containFocus={results}
      className={`results-editor${results ? " results-v2-editor" : ""}`}
    >
      <SearchBar
        initial={request}
        locale={locale}
        t={t}
        today={today}
        embedded
        refinements
        filtersOnly={filtersOnly}
        onPendingChange={setPending}
        onSearch={onClose}
      />
    </SearchDialog>
  );
}

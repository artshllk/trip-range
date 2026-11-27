import Link from "next/link";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/config";
import { pageMetadata } from "@/services/seo";
import {
  budgetMethodology,
  fareDisclosure,
  methodologyQuestions,
} from "@/seo/content";
import { ContextLink } from "@/components/discovery/ContextLink";

/**
 * The one place the shared method, fare disclaimer and general questions
 * live. Origin and route pages link here instead of repeating the blocks.
 */
export const dynamic = "force-static";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return pageMetadata(
    locale,
    "How we calculate trip costs",
    "How Trip Range builds a whole-trip budget: which flight fares count, how stay, food, transport and activities are estimated, and what the safety buffer is for.",
    { en: "/methodology" },
  );
}
export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <main id="main" className="shell section seo-landing">
      <div className="seo-intro stack">
        <p className="eyebrow ember-text">Method</p>
        <h1>How we calculate trip costs</h1>
        <p>
          Every Trip Range total is for everyone travelling and the whole trip.
          Estimated spending covers the costs below; the budget needed adds a
          separate safety buffer. Unless a page says otherwise, examples assume
          two adults, standard accommodation and no selected baggage.
        </p>
      </div>
      <section className="stack" aria-labelledby="costs-heading">
        <h2 id="costs-heading">What goes into a total</h2>
        <dl className="seo-methodology">
          {budgetMethodology.map((item) => (
            <div key={item.name}>
              <dt>{item.name}</dt>
              <dd>{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="stack" aria-labelledby="fares-heading">
        <h2 id="fares-heading">Flight fares and booking</h2>
        <p>{fareDisclosure}</p>
        <p>
          Some outbound links are affiliate links and may earn a commission.{" "}
          <Link href="/affiliate-disclosure">Affiliate disclosure</Link>.
        </p>
      </section>
      <section className="stack" aria-labelledby="questions-heading">
        <h2 id="questions-heading">Common questions</h2>
        {methodologyQuestions.map((q) => (
          <div className="stack" key={q.question}>
            <h3>{q.question}</h3>
            <p>{q.answer}</p>
          </div>
        ))}
      </section>
      <p>
        <ContextLink className="button ember" path="/" hash="search">
          Find trips for my budget →
        </ContextLink>
      </p>
    </main>
  );
}

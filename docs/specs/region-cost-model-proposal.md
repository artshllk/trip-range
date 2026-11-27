# Decision: region context with an explicit stay base

Status: **shape approved on 2 November 2026; editorial base selections recorded below;
pricing and result integration pending**. The owner approved Florence and required
the other bases to follow actual overnight stays, not airport or administrative
location. The coverage audit was completed before the supporting stay-location
sources below were checked. Further cost collection and destination-content writing
remain paused for the owner's coverage decision.

Launch-scope update, 2 November 2026: Tenerife, Algarve and Crete are now parked.
Their base decisions and evidence are retained for a possible later reactivation.
Tuscany remains in the [launch build order](../research/launch-build-order-2026-11-02/README.md),
with Florence as its required stay base. No research for any region was started by
the launch-scope change.

The present model's cost subject is a city. An airport's coverage of a region is not
evidence that one city price applies throughout that region. This decision does not
claim that today's regional estimator already enforces the new contract.

## Approved shape and result contract

Keep the region as browsing context and require an explicit named town/city as the
priced stay base. Present, for example, “Tuscany — staying in Florence”, with the
allowance and its provenance attached to Florence. Do not label that figure “Tuscany
costs”. The base must be in the primary result title and trip-detail heading, including
the accessible link name, not only a note, tooltip, breakdown or methodology page.
The required titles are in the decision table below. A region without a selected and
supported base must be excluded from priced recommendations and budget-fit claims.
Editorial region content can remain discoverable. No new costs are published here.

The planning input would need distinct region and base identities, the selected
arrival airport, and the required airport-to-base transfer. Stay, food and local
transport use that base's scope. Statutory accommodation tax remains included in the
traveller-payable stay allowance under the approved definition. Property-dependent
extras remain separate. Selecting a different base invalidates the previous costs and
transfer match; it does not merely change the label.

An outing beyond the base is excluded unless specifically selected and priced. Do not
silently include a rental car, region-wide transit, multiple hotel locations or an
intercity transfer. An unpriced required airport-to-base transfer makes the trip total
incomplete. A missing flight retains the existing unpriced-flight treatment.

## Editorial base decisions

| Region | Required result title | Editorial decision and evidence |
| --- | --- | --- |
| Tuscany | Tuscany — staying in Florence | Florence is expressly approved by the owner. The municipality's official accommodation statistics document substantial actual overnight stays in the city; the retained Tuscany content already describes Florence as a city stay base. FLR and PSA remain separate arrival options, each needing a transfer to Florence. |
| Tenerife | Tenerife — staying in Puerto de la Cruz | Choose a bounded northern resort town already covered as a stay base in the retained content. The official island accommodation survey records materially more hotel/apartment overnight stays here than in Santa Cruz. Adeje has more stays again; this is a deliberate town-based option, not a claim that Puerto is the island's largest, cheapest or representative resort. Costa Adeje can be a separately researched base later. Neither TFN nor TFS proximity determines this choice. |
| Algarve | Algarve — staying in Albufeira | Choose the coastal stay destination documented by the municipality, citing INE, as the regional overnight-stay leader for June 2025, ahead of Lagos and Portimão. This supports a real stay base, not an inference from FAO airport. Lagos remains a possible separate option. The evidence is municipal and seasonal; it does not establish every neighbourhood or a year-round preference among our origins. |

Florence is an owner decision; Puerto de la Cruz and Albufeira are editorial selections
made under the owner's approved criterion. These decisions define one explicit trip
scope each. None is a price average, a claim about the whole region, or evidence of
PRN/TIA/SKP travellers' accommodation preferences. No room prices, cost basket, transfer
prices or new destination content were collected for this decision. The official
statistics below support where people stay, not how much a Trip Range traveller pays.

Evidence checked on **2026-11-02**:

- **Florence:** Comune di Firenze, Documento Unico di Programmazione 2026–2028,
  volume 1, printed page 40, table 1.9, based on ISTAT tourism data for 2024.
  [Official municipal document](https://amministrazionetrasparente.comune.fi.it/system/files/2026-02/2025-C-00076_allegato%20A1%20eme%20vol%201.pdf#page=40).
  It measures registered accommodation in the municipality, not all Tuscany or a
  home-origin segment. Existing qualitative base evidence is in
  `content/destinations/place-Q1273.json` (Florence area, retrieved 14 October 2026).
- **Puerto de la Cruz:** Turismo de Tenerife, Balance de situación turística de
  Tenerife 2025, printed page 29, hotel/apartment overnight stays by municipality,
  sourced to the ISTAC accommodation survey.
  [Official tourism authority report](https://www.webtenerife.com/-/media/files/investigacion/situacion-turistica/informes-de-situacin-turstica-de-tenerife/relateddocuments/2025/balance-de-situacin-turstica-de-tenerife-2025.pdf#page=29).
  Municipal annual hotel/apartment coverage excludes other accommodation categories;
  it is not a south-coast price proxy. The retained Puerto de la Cruz area in
  `content/destinations/place-Q40846.json` supplies the existing town-stay scope.
- **Albufeira:** Município de Albufeira, 5 August 2025, reporting INE's June 2025
  overnight-stay comparison.
  [Official municipal release](https://www.cm-albufeira.pt/artigo/albufeira-consolida-posicao-cimeira-no-mercado-turistico-nacional).
  The release supports the seasonal municipal comparison, not a new annual ranking
  or a claim that Albufeira is cheaper than Lagos. The old Faro candidate is withdrawn.

Existing entry-code evidence comes from the three retained
`content/travel/access/place-Q1273.json`, `place-Q40846.json` and `place-Q76516549.json`
records. The [coverage audit](../research/product-coverage-2026-11-02/README.md)
counts arrivals to those entry codes; its Tuscany or Tenerife counts must not be
relabeled as observations of a complete journey to the selected stay town.

## Implementation gates

This commit records the decision and audit only; it does not relabel a generic
regional allowance as a researched base price. Before enabling a priced region:

1. Store distinct region and stay-base identities. Resolve all stay, food, local
   transport and mandatory-charge evidence to that exact base.
2. Match the observed arrival airport to a supported airport-to-base transfer.
   A missing required transfer cannot silently be zero or use an airport-city leg.
3. Render the required base-bearing title on the result and detail page. Changing
   the base must invalidate the old estimate and transfer selection.
4. Exclude unsupported region/base combinations from priced recommendations and
   affordability claims. A selected base alone is not sufficient evidence.

All three bases currently lack the structured cost research required by this
contract. The safe exclusion fallback is approved; its runtime enforcement and the
base-bearing result presentation are still implementation work, not completed by
this documentation change. Crete needs the same explicit base decision before its
older generic allowance can satisfy this contract.

## Alternatives

A region-wide range is deferred. It would require a defined panel of towns, comparable
stay dates and travel styles, a declared selection rule and separate transfer costs.
The minimum and maximum of a few city estimates would not establish a regional range,
and no average or “representative” city may stand in for unobserved places.

Excluding regions from priced results until a base is supported is the safe fallback.
Editorial region content can remain separately discoverable. If the owner instead
archives these three as well, the current retained content set would fall from 10 to
7 destinations, 138 to 105 items, 92 to 79 dated item obligations and 109 to 90 source
records. That additional archive has not been performed.

The same base requirement applies to Crete and any future island or
region. No exception is implied by the presence of an older generic allowance.

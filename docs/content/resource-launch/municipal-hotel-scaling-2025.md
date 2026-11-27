# Can a national price index predict a city’s hotel rate?

A country price index carries no signal about differences between cities in the same country. Across **1,437 municipality-months** in Spain and Finland in 2025, scaling the capital’s room rate gave exactly the same prediction as simply copying it. In both cases 338 predictions fell within ±25% of the achieved rate.

## One city in two seasons

In **June**, Helsinki’s €148.19 predicted a rate **43% above** Rovaniemi’s €103.39. In **December**, Helsinki’s €123.69 predicted a rate **74% below** Rovaniemi’s €482.04. Both cities share Finland’s index in both months. Using a monthly capital rate captures seasonality in the capital, but it misses the winter rise in Rovaniemi. [Statistics Finland, monthly hotel statistics](https://pxdata.stat.fi/PxWeb/pxweb/en/StatFin/StatFin__matk/11lm.px/)

## How often the capital was close

| Same-month anchor | Other municipalities | Within ±25%, scaled or copied | Error greater than 35% |
| --- | ---: | ---: | ---: |
| Madrid | 106 in Spain | 171 of 1,209 (14.1%) | 973 (80.5%) |
| Helsinki | 19 in Finland | 167 of 228 (73.2%) | 34 (14.9%) |

Madrid predicted Barcelona within ±25% in all twelve months and overshot Zaragoza by more than 35% in every month. Helsinki predicted Tampere, Turku, Oulu and Vaasa within ±25% throughout the year. A capital average can be useful in some markets and seasons. The difference between Spain and Finland shows why a model needs validation in each country and why a national hit rate can hide large seasonal misses.

## What was tested

Each noncapital municipality was held out in each month with a published rate. We predicted its rate by multiplying the capital’s achieved rate that month by the target country’s price level index divided by the anchor country’s index. For a domestic prediction that ratio is exactly one. We weighted each available municipality-month equally and omitted Spain’s 63 missing observations. The same cities and anchors recur across months. These are descriptive results for the municipalities in the two tables.

We also tested using **only the foreign capital**, on the same 1,437 targets. For Spanish targets, scaling Helsinki improved the ±25% hit rate from 35.5% to 57.2%. For Finnish targets, scaling Madrid reduced it from 7.9% to 4.4%. Only this comparison changes the multiplier. We divided Finland’s VAT-inclusive rates by 1.14 for the cross-border comparison. The two directions do not establish a Europe-wide success rate.

**Scope.** INE reports achieved accommodation-only double-room rates excluding tax. Statistics Finland measures room sales including VAT per occupied room. Neither table isolates central three-star hotels, a particular booking date or a particular traveller’s quote. This study tests geographic scaling of municipal averages. It cannot validate a central three-star booking estimate. [INE table 46298](https://www.ine.es/jaxiT3/Tabla.htm?t=46298&L=1) · [Statistics Finland’s room-price definition](https://stat.fi/meta/kas/huonkeskhinta_en.html)

## Sources and citation

Prepared by Trip Range using data extracted from the INE website, www.ine.es, and Statistics Finland, Accommodation statistics, table 11lm. Both municipal sources use [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Source for the national indices: Eurostat, `prc_ppp_ind_1`, restaurants and accommodation services (A0111), 2025, accessed 11 November 2026. Trip Range calculated the comparisons. Eurostat bears no responsibility for the results. [INE reuse terms](https://www.ine.es/dyngs/AYU/en/index.htm?cid=125) · [Statistics Finland reuse terms](https://stat.fi/en/about-us/get-to-know-statistics-finland/legislation/terms-of-use) · [Eurostat reuse terms](https://ec.europa.eu/eurostat/help/copyright-notice)

> Trip Range (2026). *Can a national price index predict a city’s hotel rate? Spain and Finland, 2025*. Version 1. [Study and replication files](https://www.trip-range.com/data/municipal-hotel-scaling/2025-v1).

The downloads include all three inputs, the Python calculation, a CSV of every prediction and a plain-text summary. Keep the source files in the `sources/` subdirectory and run `python3 analyze.py --predictions predictions.csv`. The CSV has 2,874 rows because the domestic and foreign tests use the same 1,437 targets. [Replication notes and attribution](/data/municipal-hotel-scaling/2025-v1/files/sources/README.md)

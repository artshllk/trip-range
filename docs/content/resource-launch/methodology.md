# How Trip Range measures fares

We use cached Aviasales observations to answer two questions: which destinations appeared for a given departure point and stay length, and what the recorded return fares cost. A destination without a qualifying record is a gap in the sample. It may still have flights.

## Which fares count

For the 5 November study we kept positive economy return fares in euros for one traveller from Tirana, Prishtina and Skopje. The trip dates, airports and currency had to match. We used the provider’s observation time to apply a seven-day age limit at the cutoff. Fetching a record again did not make the fare newer. We grouped known destination-airport aliases and counted each destination once per departure month and duration group.

## How we compare prices

After removing duplicate date-and-price combinations, we report two medians. The record-weighted median gives each distinct fare one vote. For the destination-weighted median we first take the median fare within each destination, then take the median of those values. This prevents a destination with many recorded dates from dominating the comparison. The two-night Tirana sample illustrates the difference: €54 per median fare record and €95 per median destination.

## What a traveller can check

The [fare coverage study](/data/fare-coverage/2026-11-05-v1) links the counts, price summaries, SQL and an offline checker. Anyone can check the published totals and weighting comparisons. Recomputing the underlying medians requires private fare observations. The historical sample gives no guarantee about today’s fare, baggage or seat availability. The booking provider confirms the final price. [Affiliate disclosure](/affiliate-disclosure)

## Room measurement

Direct room-price measurement is underway. We will publish its method when source permissions are settled. Our [municipal hotel-rate study](/data/municipal-hotel-scaling/2025-v1) answers a separate question using achieved monthly rates from Spain and Finland. [Browse all data releases](/data)

import type { BudgetBreakdown, CostItem, MoneyAmount } from "./types";

import { money, assertCurrency } from "./money/currency";
import { planningCostPolicy } from "./money/planning-rates";
export { money } from "./money/currency";

// Both forward pricing and its inverse use the same integer reserve policy.
const reserveDivisor = BigInt(10);
export function safetyBufferFor(spend: MoneyAmount): MoneyAmount {
  assertCurrency(spend, spend.currency);
  const percentage =
    (BigInt(spend.cents) + reserveDivisor - BigInt(1)) / reserveDivisor;
  return money(
    Math.max(
      planningCostPolicy[spend.currency].minimumReserve,
      Number(percentage),
    ),
    spend.currency,
  );
}

/** Maximum total party airfare, NOT a fare estimate. No positive ceiling means no room.
 * S + max(minimumReserve, ceil(S / 10)) <= B holds exactly when
 * S <= min(B - minimumReserve, floor(10B / 11)), where S = known costs + flight.
 */
export function maxAffordableFlight(
  budget: MoneyAmount,
  knownNonFlightCosts: MoneyAmount,
): MoneyAmount | undefined {
  assertCurrency(budget, budget.currency);
  assertCurrency(knownNonFlightCosts, budget.currency);
  const b = BigInt(budget.cents);
  const minimumBound =
    b - BigInt(planningCostPolicy[budget.currency].minimumReserve);
  const percentageBound = (b * reserveDivisor) / (reserveDivisor + BigInt(1));
  const spendBound =
    minimumBound < percentageBound ? minimumBound : percentageBound;
  const ceiling = spendBound - BigInt(knownNonFlightCosts.cents);
  return ceiling > BigInt(0)
    ? money(Number(ceiling), budget.currency)
    : undefined;
}

export type FlightAffordability =
  | { status: "accommodation-charges-unpriced"; ceiling?: never }
  | { status: "stay-unpriced"; ceiling?: never }
  | { status: "required-transfer-unpriced"; ceiling?: never }
  | { status: "calculated"; ceiling: MoneyAmount }
  | { status: "no-room-in-budget"; ceiling?: never };
export function calculateBudget(
  budget: MoneyAmount,
  costs: CostItem[],
  safetyBuffer: MoneyAmount,
  savedEstimatedSpend?: MoneyAmount,
  possibleCharge?: MoneyAmount,
): BudgetBreakdown {
  const amounts = [
    budget,
    safetyBuffer,
    ...costs.map((c) => c.amount),
    ...(savedEstimatedSpend ? [savedEstimatedSpend] : []),
    ...(possibleCharge ? [possibleCharge] : []),
  ];
  for (const amount of amounts) {
    assertCurrency(amount, budget.currency);
  }
  if (budget.cents === 0) throw new RangeError("Budget must be positive");
  const estimatedSpend = money(
    costs.reduce((sum, item) => sum + item.amount.cents, 0),
    budget.currency,
  );
  const budgetNeeded = money(
    estimatedSpend.cents + safetyBuffer.cents,
    budget.currency,
  );
  const fitNeeded = money(
    budgetNeeded.cents + (possibleCharge?.cents ?? 0),
    budget.currency,
  );
  const utilization = fitNeeded.cents / budget.cents;
  return {
    estimatedSpend,
    safetyBuffer,
    budgetNeeded,
    utilization,
    remainingAfterReserve: money(
      Math.max(0, budget.cents - fitNeeded.cents),
      budget.currency,
    ),
    overBudget: money(
      Math.max(0, fitNeeded.cents - budget.cents),
      budget.currency,
    ),
    fit: utilization > 1 ? "over" : utilization > 0.9 ? "close" : "comfortable",
    ...(possibleCharge && possibleCharge.cents > 0
      ? { upperBoundNeeded: fitNeeded }
      : {}),
    priceChangeSpendDelta: {
      cents: savedEstimatedSpend
        ? estimatedSpend.cents - savedEstimatedSpend.cents
        : 0,
      currency: budget.currency,
    },
  };
}

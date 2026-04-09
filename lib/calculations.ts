export interface BonusInputs {
  currentCollections: number;         // cash already received this FY
  currentAR: number;                  // invoiced but not yet collected
  currentWIP: number;                 // worked but not invoiced ($ amount)
  billRate: number;
  projectedUtilization: number;
  currentWipRealizationRate: number;  // rate for existing WIP → collections
  futureWipRealizationRate: number;   // rate for new projected WIP → collections
  baseSalary: number;
  performanceMultiple: number;
  weeksRemaining: number;
}

export interface BonusResults {
  projectedNewWIP: number;
  projectedCollectionsFromCurrentWIP: number;
  projectedCollectionsFromFutureWIP: number;
  projectedCollectionsFromAR: number;
  totalProjectedCollections: number;
  totalPipeline: number;
  bonus: number;
  bonusPct: number;
  weeksCompleted: number;
  fiscalYearPct: number;
  // Pacing
  weeksElapsed: number;
  actualWeeklyRunRate: number;
  requiredWeeklyRunRate: number;
  // Breakeven
  breakevenUtil: number;
  // Gap to 100% bonus
  collectionsGapTo100: number;
  utilNeededFor100: number;
}

/** Fiscal year runs Nov 1 → Oct 31. Returns weeks remaining from today to Oct 31. */
export function calcWeeksRemaining(): number {
  const today = new Date();
  const yr = today.getFullYear();
  let fyEnd = new Date(yr, 9, 31, 23, 59, 59);
  if (today > fyEnd) fyEnd = new Date(yr + 1, 9, 31, 23, 59, 59);
  const ms = fyEnd.getTime() - today.getTime();
  const weeks = Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
  return Math.floor(weeks);
}

export function calculateBonus(inputs: BonusInputs): BonusResults {
  const {
    currentCollections, currentAR, currentWIP,
    billRate, projectedUtilization,
    currentWipRealizationRate, futureWipRealizationRate,
    baseSalary, performanceMultiple, weeksRemaining,
  } = inputs;

  const projectedNewWIP                    = billRate * (projectedUtilization / 100) * 40 * weeksRemaining;
  const projectedCollectionsFromCurrentWIP = currentWIP * (currentWipRealizationRate / 100);
  const projectedCollectionsFromFutureWIP  = projectedNewWIP * (futureWipRealizationRate / 100);
  const projectedCollectionsFromAR         = currentAR; // 100%
  const totalProjectedCollections          = currentCollections
    + projectedCollectionsFromAR
    + projectedCollectionsFromCurrentWIP
    + projectedCollectionsFromFutureWIP;
  const totalPipeline = currentCollections + currentAR + currentWIP;

  const bonus    = Math.max(0, totalProjectedCollections * (performanceMultiple / 100) - baseSalary);
  const bonusPct = baseSalary > 0 ? (bonus / baseSalary) * 100 : 0;
  const weeksCompleted = 52 - weeksRemaining;
  const fiscalYearPct  = Math.min(100, (weeksCompleted / 52) * 100);

  // ── Pacing ────────────────────────────────────────────────────────────────
  const weeksElapsed = weeksCompleted;
  const actualWeeklyRunRate = weeksElapsed > 0 ? currentCollections / weeksElapsed : 0;
  const requiredWeeklyRunRate = weeksRemaining > 0
    ? (totalProjectedCollections - currentCollections) / weeksRemaining : 0;

  // ── Breakeven: minimum utilization for bonus > 0 ─────────────────────────
  const breakevenCollections = performanceMultiple > 0
    ? baseSalary / (performanceMultiple / 100) : Infinity;
  const remainingNeededForBreakeven = isFinite(breakevenCollections)
    ? breakevenCollections - currentCollections - currentAR - (currentWIP * (currentWipRealizationRate / 100))
    : Infinity;
  const futureWipDenom = billRate * 40 * weeksRemaining * (futureWipRealizationRate / 100);
  const breakevenUtil = !isFinite(remainingNeededForBreakeven) ? Infinity
    : remainingNeededForBreakeven <= 0 ? 0
    : futureWipDenom > 0
      ? (remainingNeededForBreakeven / futureWipDenom) * 100
      : Infinity;

  // ── Gap to 100% of base salary as bonus ───────────────────────────────────
  // bonus = baseSalary ⟹ collections × perf% = 2 × baseSalary
  const targetCollectionsFor100PctBonus = performanceMultiple > 0
    ? (baseSalary + baseSalary) / (performanceMultiple / 100) : Infinity;
  const collectionsGapTo100 = !isFinite(targetCollectionsFor100PctBonus)
    ? Infinity
    : Math.max(0, targetCollectionsFor100PctBonus - totalProjectedCollections);
  const remainingNeededFor100 = !isFinite(targetCollectionsFor100PctBonus)
    ? Infinity
    : targetCollectionsFor100PctBonus - currentCollections - currentAR - (currentWIP * (currentWipRealizationRate / 100));
  const utilNeededFor100 = !isFinite(remainingNeededFor100) ? Infinity
    : remainingNeededFor100 <= 0 ? 0
    : futureWipDenom > 0
      ? (remainingNeededFor100 / futureWipDenom) * 100
      : Infinity;

  return {
    projectedNewWIP,
    projectedCollectionsFromCurrentWIP,
    projectedCollectionsFromFutureWIP,
    projectedCollectionsFromAR,
    totalProjectedCollections,
    totalPipeline,
    bonus, bonusPct, weeksCompleted, fiscalYearPct,
    weeksElapsed,
    actualWeeklyRunRate,
    requiredWeeklyRunRate,
    breakevenUtil,
    collectionsGapTo100,
    utilNeededFor100,
  };
}

/** Compute bonus for arbitrary util/perf combos — used in the sensitivity table. */
export function calcBonusAt(
  currentCollections: number,
  currentAR: number,
  currentWIP: number,
  billRate: number,
  util: number,
  baseSalary: number,
  perfMultiple: number,
  weeksRemaining: number,
  currentWipRealizationRate: number,
  futureWipRealizationRate: number,
): number {
  const projNewWIP  = billRate * (util / 100) * 40 * weeksRemaining;
  const fromCurrent = currentWIP * (currentWipRealizationRate / 100);
  const fromFuture  = projNewWIP * (futureWipRealizationRate / 100);
  const total       = currentCollections + currentAR + fromCurrent + fromFuture;
  return Math.max(0, total * (perfMultiple / 100) - baseSalary);
}

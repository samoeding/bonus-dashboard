export interface BonusInputs {
  currentCollections: number;    // cash already received this FY
  currentAR: number;             // invoiced but not yet collected
  currentWIP: number;            // worked but not invoiced ($ amount)
  billRate: number;
  projectedUtilization: number;
  wipRealizationRate: number;
  baseSalary: number;
  performanceMultiple: number;
  weeksRemaining: number;
}

export interface BonusResults {
  projectedNewWIP: number;
  totalWIPToRealize: number;
  projectedCollectionsFromWIP: number;  // (currentWIP + projectedNewWIP) × realization rate
  projectedCollectionsFromAR: number;   // currentAR converts at 100%
  totalProjectedCollections: number;
  totalPipeline: number;                // currentCollections + currentAR + currentWIP
  bonus: number;
  bonusPct: number;
  weeksCompleted: number;
  fiscalYearPct: number;
}

/** Fiscal year runs Nov 1 → Oct 31. Returns weeks remaining from today to Oct 31. */
export function calcWeeksRemaining(): number {
  const today = new Date();
  const yr = today.getFullYear();
  let fyEnd = new Date(yr, 9, 31, 23, 59, 59);
  if (today > fyEnd) fyEnd = new Date(yr + 1, 9, 31, 23, 59, 59);
  const ms = fyEnd.getTime() - today.getTime();
  const weeks = Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
  return Math.round(weeks * 10) / 10;
}

export function calculateBonus(inputs: BonusInputs): BonusResults {
  const {
    currentCollections, currentAR, currentWIP,
    billRate, projectedUtilization, wipRealizationRate,
    baseSalary, performanceMultiple, weeksRemaining,
  } = inputs;

  const projectedNewWIP = billRate * (projectedUtilization / 100) * 40 * weeksRemaining;
  const totalWIPToRealize = currentWIP + projectedNewWIP;
  const projectedCollectionsFromWIP = totalWIPToRealize * (wipRealizationRate / 100);
  const projectedCollectionsFromAR = currentAR; // converts at 100%
  const totalProjectedCollections = currentCollections + projectedCollectionsFromAR + projectedCollectionsFromWIP;
  const totalPipeline = currentCollections + currentAR + currentWIP;

  const bonus = Math.max(0, totalProjectedCollections * (performanceMultiple / 100) - baseSalary);
  const bonusPct = baseSalary > 0 ? (bonus / baseSalary) * 100 : 0;
  const weeksCompleted = 52 - weeksRemaining;
  const fiscalYearPct = Math.min(100, (weeksCompleted / 52) * 100);

  return {
    projectedNewWIP, totalWIPToRealize,
    projectedCollectionsFromWIP, projectedCollectionsFromAR,
    totalProjectedCollections, totalPipeline,
    bonus, bonusPct, weeksCompleted, fiscalYearPct,
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
  wipRealizationRate: number,
): number {
  const projNewWIP = billRate * (util / 100) * 40 * weeksRemaining;
  const fromWIP = (currentWIP + projNewWIP) * (wipRealizationRate / 100);
  const total = currentCollections + currentAR + fromWIP;
  return Math.max(0, total * (perfMultiple / 100) - baseSalary);
}

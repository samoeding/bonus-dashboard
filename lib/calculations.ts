export interface BonusInputs {
  ytdCollections: number;
  billRate: number;
  projectedUtilization: number;
  wipRealizationRate: number;
  baseSalary: number;
  performanceMultiple: number;
  weeksRemaining: number;
}

export interface BonusResults {
  projectedWIP: number;
  projectedCollections: number;
  totalCollections: number;
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
  if (today > fyEnd) {
    fyEnd = new Date(yr + 1, 9, 31, 23, 59, 59);
  }
  const ms = fyEnd.getTime() - today.getTime();
  const weeks = Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
  return Math.round(weeks * 10) / 10;
}

export function calculateBonus(inputs: BonusInputs): BonusResults {
  const {
    ytdCollections, billRate, projectedUtilization,
    wipRealizationRate, baseSalary, performanceMultiple, weeksRemaining,
  } = inputs;

  const projectedWIP = billRate * (projectedUtilization / 100) * 40 * weeksRemaining;
  const projectedCollections = projectedWIP * (wipRealizationRate / 100);
  const totalCollections = ytdCollections + projectedCollections;
  const bonus = Math.max(0, totalCollections * (performanceMultiple / 100) - baseSalary);
  const bonusPct = baseSalary > 0 ? (bonus / baseSalary) * 100 : 0;
  const weeksCompleted = 52 - weeksRemaining;
  const fiscalYearPct = Math.min(100, (weeksCompleted / 52) * 100);

  return { projectedWIP, projectedCollections, totalCollections, bonus, bonusPct, weeksCompleted, fiscalYearPct };
}

/** Compute bonus for arbitrary util/perf combos — used in the sensitivity table. */
export function calcBonusAt(
  ytdCollections: number,
  billRate: number,
  util: number,
  baseSalary: number,
  perfMultiple: number,
  weeksRemaining: number,
  wipRealizationRate: number,
): number {
  const wip = billRate * (util / 100) * 40 * weeksRemaining;
  const proj = wip * (wipRealizationRate / 100);
  const total = ytdCollections + proj;
  return Math.max(0, total * (perfMultiple / 100) - baseSalary);
}

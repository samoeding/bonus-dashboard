export interface BonusInputs {
  ytdCollections: number;
  billRate: number;
  projectedUtilization: number;
  baseSalary: number;
  performanceMultiple: number;
  weeksRemaining: number;
}

export interface BonusResults {
  projectedCollections: number;
  totalCollections: number;
  bonus: number;
  bonusPct: number;
  weeksCompleted: number;
  fiscalYearPct: number;
}

export interface ChartDataPoint {
  month: string;
  ytdActual: number | null;
  baseProjection: number | null;
  plus10: number | null;
  minus10: number | null;
}

/** Fiscal year runs Nov 1 → Oct 31. Returns weeks remaining from today to Oct 31. */
export function calcWeeksRemaining(): number {
  const today = new Date();
  const yr = today.getFullYear();
  // Oct 31 of current year; if past it, use next year's
  let fyEnd = new Date(yr, 9, 31, 23, 59, 59);
  if (today > fyEnd) {
    fyEnd = new Date(yr + 1, 9, 31, 23, 59, 59);
  }
  const ms = fyEnd.getTime() - today.getTime();
  const weeks = Math.max(0, ms / (7 * 24 * 60 * 60 * 1000));
  return Math.round(weeks * 10) / 10;
}

export function calculateBonus(inputs: BonusInputs): BonusResults {
  const { ytdCollections, billRate, projectedUtilization, baseSalary, performanceMultiple, weeksRemaining } = inputs;

  const projectedCollections = billRate * (projectedUtilization / 100) * 40 * weeksRemaining;
  const totalCollections = ytdCollections + projectedCollections;
  const bonus = Math.max(0, totalCollections * (performanceMultiple / 100) - baseSalary);
  const bonusPct = baseSalary > 0 ? (bonus / baseSalary) * 100 : 0;
  const weeksCompleted = 52 - weeksRemaining;
  const fiscalYearPct = Math.min(100, (weeksCompleted / 52) * 100);

  return { projectedCollections, totalCollections, bonus, bonusPct, weeksCompleted, fiscalYearPct };
}

/** Compute bonus for arbitrary util/perf combos (used in sensitivity table and bar chart). */
export function calcBonusAt(
  ytdCollections: number,
  billRate: number,
  util: number,
  baseSalary: number,
  perfMultiple: number,
  weeksRemaining: number
): number {
  const proj = billRate * (util / 100) * 40 * weeksRemaining;
  const total = ytdCollections + proj;
  return Math.max(0, total * (perfMultiple / 100) - baseSalary);
}

/**
 * Generate monthly chart data for the collections trajectory.
 * Fiscal year months: [Nov=0, Dec=1, Jan=2, ..., Oct=11]
 */
export function generateChartData(inputs: BonusInputs): ChartDataPoint[] {
  const { ytdCollections, billRate, projectedUtilization, weeksRemaining } = inputs;
  const weeksCompleted = 52 - weeksRemaining;
  const WEEKS_PER_MONTH = 52 / 12;
  const currentMonthIdx = Math.min(11, Math.floor(weeksCompleted / WEEKS_PER_MONTH));

  const MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

  const weeklyRate = (util: number) => billRate * (util / 100) * 40;

  return MONTHS.map((month, i) => {
    const monthEndWeek = (i + 1) * WEEKS_PER_MONTH;
    const weeksProjected = Math.max(0, monthEndWeek - weeksCompleted);

    // YTD actual: flat line from start of FY up to and including the current month
    const ytdActual: number | null = i <= currentMonthIdx ? ytdCollections : null;

    // Projections start at the current month (join point) and go forward
    const isProjectionMonth = i >= currentMonthIdx;
    const baseProjection: number | null = isProjectionMonth
      ? ytdCollections + weeklyRate(projectedUtilization) * weeksProjected
      : null;
    const plus10: number | null = isProjectionMonth
      ? ytdCollections + weeklyRate(Math.min(200, projectedUtilization + 10)) * weeksProjected
      : null;
    const minus10: number | null = isProjectionMonth
      ? ytdCollections + weeklyRate(Math.max(0, projectedUtilization - 10)) * weeksProjected
      : null;

    return { month, ytdActual, baseProjection, plus10, minus10 };
  });
}

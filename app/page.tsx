'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  calculateBonus, calcWeeksRemaining, calcBonusAt,
  type BonusInputs, type BonusResults,
} from '@/lib/calculations';
import {
  DollarSign, TrendingUp, TrendingDown, Percent, Layers, Printer,
  ChevronDown, ChevronUp, CheckCircle2,
} from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const LEVELS = [
  { name: 'MD2',              rate: 1010 },
  { name: 'MD1',              rate: 945  },
  { name: 'Senior Director',  rate: 875  },
  { name: 'Director',         rate: 800  },
  { name: 'Manager',          rate: 650  },
  { name: 'Senior Associate', rate: 560  },
  { name: 'Associate',        rate: 475  },
  { name: 'Analyst',          rate: 380  },
  { name: 'Intern',           rate: 55   },
] as const;

const OLD_STORAGE_KEY = 'bonusDashboardSettings';
const STORAGE_KEY     = 'bonusDashboardSettingsV2';

// Chart colors per spec
const CHART_BLUE  = '#3266ad';
const CHART_GREEN = '#3B6D11';
const CHART_AMBER = '#F59E0B';

// Stacked bar segment colors per spec F1/F2
const BAR_COLLECTIONS = '#1d4ed8';
const BAR_AR          = '#b45309';
const BAR_WIP         = '#15803d';
const BAR_PROJECTED   = '#0e7490';

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (!isFinite(v)) return '—';
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000)     return `$${(v / 1_000).toFixed(0)}K`;
  return fmtCurrency(v);
};

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

const fmtPace = (v: number) => `$${(v / 1000).toFixed(1)}k/wk`;

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}

function useCountUp(target: number, duration = 350): number {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(0);
  const prevRef = useRef(0);
  const rafRef  = useRef<number | null>(null);

  useEffect(() => {
    if (reduced || !isFinite(target)) { setValue(target); prevRef.current = target; return; }
    const from = prevRef.current;
    const to   = target;
    const startTime = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - startTime) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setValue(from + (to - from) * e);
      if (p < 1) { rafRef.current = requestAnimationFrame(tick); }
      else { prevRef.current = to; }
    };
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, duration, reduced]);

  return value;
}

// ─── Chart data ───────────────────────────────────────────────────────────────

interface ChartPoint {
  label: string;
  collections: number;
  productionAbove: number;
  totalCompensation: number;
}

/**
 * 30 evenly-spaced points from today (t=0) to Oct 31 (t=1).
 * Last point is pinned to totalProjectedCollections from calculateBonus
 * so chart tooltip and summary card are guaranteed to match.
 */
function generateProductionChartData(
  inputs: BonusInputs,
  totalProjectedCollections: number,
): ChartPoint[] {
  const N = 30;
  const {
    currentCollections, currentAR, currentWIP, billRate, projectedUtilization,
    currentWipRealizationRate, futureWipRealizationRate, performanceMultiple,
    weeksRemaining, baseSalary,
  } = inputs;

  const WEEKLY_BILL = billRate * (projectedUtilization / 100) * 40;
  const today  = new Date();
  const fyEnd  = new Date(today.getFullYear(), 9, 31, 23, 59, 59);
  const totalMs = Math.max(0, fyEnd.getTime() - today.getTime());

  const makePoint = (label: string, t: number, isLast: boolean): ChartPoint => {
    const weeksFromNow = t * weeksRemaining;
    const newWipGross  = WEEKLY_BILL * weeksFromNow;
    const collections  = isLast
      ? totalProjectedCollections
      : currentCollections + currentAR
          + (currentWIP * (currentWipRealizationRate / 100)) * t
          + (newWipGross * (futureWipRealizationRate / 100)) * t;
    const grossProd      = currentCollections + currentAR + currentWIP + newWipGross;
    const totalCompensation = baseSalary + Math.max(0, collections * (performanceMultiple / 100) - baseSalary);
    return { label, collections, productionAbove: Math.max(0, grossProd - collections), totalCompensation };
  };

  if (totalMs === 0 || weeksRemaining <= 0) {
    return [makePoint('Oct 31', 1, true)];
  }

  const points: ChartPoint[] = [];
  let prevMonth = -1;

  for (let i = 0; i < N; i++) {
    const t      = i / (N - 1);
    const isLast = i === N - 1;
    const date   = new Date(today.getTime() + t * totalMs);

    let label = '';
    if (isLast) {
      label = 'Oct 31';
    } else {
      const m = date.getMonth();
      if (m !== prevMonth) { label = date.toLocaleString('en-US', { month: 'short' }); prevMonth = m; }
    }

    points.push(makePoint(label, t, isLast));
  }

  // Dev assertion: last point must match summary card
  if (process.env.NODE_ENV === 'development') {
    const last = points[points.length - 1];
    const drift = Math.abs(last.collections - totalProjectedCollections);
    if (drift > 0.01) console.warn('[chart] drift from summary card:', drift);
  }

  return points;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_LEVEL = 'Manager';

function defaultInputs(): BonusInputs {
  return {
    currentCollections:       500_000,
    currentAR:                150_000,
    currentWIP:                75_000,
    billRate:                     650,
    projectedUtilization:          80,
    currentWipRealizationRate:     85,
    futureWipRealizationRate:      50,
    baseSalary:               200_000,
    performanceMultiple:           50,
    weeksRemaining:        calcWeeksRemaining(),
  };
}

// ─── Design tokens ────────────────────────────────────────────────────────────

const card       = 'bg-[#0F1629] border border-white/[0.07] rounded-2xl';
const inputCls   = 'h-10 w-full rounded-xl border border-white/[0.10] bg-white/[0.04] px-2 text-sm font-mono tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-150 cursor-text';
const sectionLabel = 'text-xs font-semibold text-blue-400/80 tracking-wide shrink-0';

// ─── TextInput ────────────────────────────────────────────────────────────────

function TextInput({
  labelText, value, onChange, prefix, suffix, decimals = 0, placeholder, scale = 1,
}: {
  labelText: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number;
  placeholder?: string; scale?: number;
}) {
  const [raw, setRaw] = useState((value / scale).toFixed(decimals));
  useEffect(() => { setRaw((value / scale).toFixed(decimals)); }, [value, decimals, scale]);

  const commit = () => {
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (!isNaN(parsed) && parsed >= 0) { onChange(parsed * scale); setRaw(parsed.toFixed(decimals)); }
    else setRaw((value / scale).toFixed(decimals));
  };

  return (
    <div>
      {/* Fixed-height, centered label so all inputs align to the same baseline */}
      <label
        className="text-xs font-medium text-muted-foreground flex items-end justify-center text-center pb-1"
        style={{ minHeight: '2.5rem' }}
      >
        {labelText}
      </label>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-muted-foreground font-mono shrink-0">{prefix}</span>}
        <input
          type="text" value={raw} placeholder={placeholder}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={inputCls}
        />
        {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
    </div>
  );
}

// ─── LevelSelect ──────────────────────────────────────────────────────────────

function LevelSelect({ level, onLevelChange }: {
  level: string;
  onLevelChange: (name: string, rate: number) => void;
}) {
  const selected = LEVELS.find((l) => l.name === level) ?? LEVELS[4];
  return (
    <div>
      <label
        className="text-xs font-medium text-muted-foreground flex items-end justify-center text-center pb-1"
        style={{ minHeight: '2.5rem' }}
      >
        Level
      </label>
      <div className="relative">
        <select
          value={level}
          onChange={(e) => {
            const l = LEVELS.find((x) => x.name === e.target.value);
            if (l) onLevelChange(l.name, l.rate);
          }}
          className={`${inputCls} appearance-none pr-7 cursor-pointer overflow-hidden`}
          style={{ minWidth: '180px', textOverflow: 'ellipsis' }}
        >
          {LEVELS.map((l) => <option key={l.name} value={l.name} className="bg-[#0F1629]">{l.name}</option>)}
        </select>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
      <p className="text-[10px] text-muted-foreground/70 mt-1 text-center">
        ${selected.rate}/hr
      </p>
    </div>
  );
}

// ─── StackedBar ───────────────────────────────────────────────────────────────

function StackedBar({ segments }: {
  segments: { label: string; value: number; color: string }[];
}) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  if (total <= 0) return null;
  return (
    <div className="mt-3">
      <div className="flex h-4 rounded-lg overflow-hidden w-full">
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          return (
            <div
              key={i}
              className="flex items-center justify-center overflow-hidden shrink-0"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${fmtShort(seg.value)} · ${pct.toFixed(0)}%`}
            >
              {pct >= 20 && (
                <span className="text-[9px] font-mono font-semibold text-white/90 px-0.5 leading-none truncate">
                  {fmtShort(seg.value)}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-3 mt-1.5 flex-wrap">
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          return (
            <div key={i} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: seg.color }} />
              <span className="text-[10px] text-muted-foreground">
                {seg.label} <span className="font-mono">{fmtShort(seg.value)}</span>{' '}
                <span className="opacity-60">{pct.toFixed(0)}%</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── PacingSection ────────────────────────────────────────────────────────────

function PacingSection({ results }: { results: BonusResults }) {
  const { weeksElapsed, actualWeeklyRunRate, requiredWeeklyRunRate } = results;

  if (weeksElapsed <= 0) {
    return (
      <p className="mt-2 text-xs text-muted-foreground/60">
        No pace data yet — check back after week 1
      </p>
    );
  }

  const isOnPace = actualWeeklyRunRate >= requiredWeeklyRunRate;
  const gap      = actualWeeklyRunRate - requiredWeeklyRunRate;

  return (
    <div className="mt-3 space-y-1.5 pt-2.5 border-t border-white/[0.06]">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Actual pace</span>
        <span className="font-mono tabular-nums">{fmtPace(actualWeeklyRunRate)}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">Required pace</span>
        <span className="font-mono tabular-nums">{fmtPace(requiredWeeklyRunRate)}</span>
      </div>
      <div className="flex items-center gap-1.5 pt-0.5">
        {isOnPace ? (
          <>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 text-xs font-medium">
              <TrendingUp className="h-3 w-3" /> On pace
            </span>
            <span className="text-[11px] text-emerald-400/70">+{fmtPace(gap)} ahead</span>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-xs font-medium">
              <TrendingDown className="h-3 w-3" /> Behind pace
            </span>
            <span className="text-[11px] text-amber-400/70">{fmtPace(Math.abs(gap))} gap</span>
          </>
        )}
      </div>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  title, rawValue, format, sub, icon: Icon, accentColor, animDelay = 0, isPositive, children,
}: {
  title: string; rawValue: number; format: (v: number) => string;
  sub?: string; icon: React.ComponentType<{ className?: string }>;
  accentColor?: string; animDelay?: number; isPositive?: boolean;
  children?: React.ReactNode;
}) {
  const counted   = useCountUp(rawValue);
  const formatted = format(counted);
  return (
    <div
      className={`${card} p-5 group hover:-translate-y-0.5 hover:border-white/[0.12] transition-all duration-150 animate-fade-up`}
      style={{ animationDelay: `${animDelay}ms` }}
    >
      <div className="flex items-start justify-between mb-3">
        <p className="text-xs font-medium text-muted-foreground">{title}</p>
        <div className="rounded-lg bg-white/[0.05] p-1.5">
          <Icon className="h-4 w-4 text-muted-foreground" />
        </div>
      </div>
      <p className="text-3xl font-bold tabular-nums tracking-tight leading-none"
         style={{ color: accentColor ?? '#F1F5F9' }}>
        {formatted}
      </p>
      {sub && (
        <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
          {isPositive !== undefined && (
            isPositive
              ? <TrendingUp className="h-3 w-3 text-emerald-400 shrink-0" />
              : <TrendingDown className="h-3 w-3 text-red-400 shrink-0" />
          )}
          {sub}
        </p>
      )}
      {children}
    </div>
  );
}

// ─── BreakevenCallout ─────────────────────────────────────────────────────────

function BreakevenCallout({ results, projectedUtilization }: {
  results: BonusResults; projectedUtilization: number;
}) {
  const { breakevenUtil } = results;
  const covered      = breakevenUtil <= 0;
  const unachievable = !isFinite(breakevenUtil) || breakevenUtil > 200;
  const aboveBreakeven = !covered && !unachievable && breakevenUtil <= projectedUtilization;

  const borderColor = covered || aboveBreakeven ? 'border-emerald-500/30'
    : unachievable ? 'border-red-500/30' : 'border-amber-500/30';

  return (
    <div className={`rounded-xl border ${borderColor} bg-white/[0.03] p-2.5 flex flex-col justify-between`}
         style={{ minWidth: '100px' }}>
      <div>
        <p className="text-[10px] font-semibold text-muted-foreground leading-tight">
          Breakeven utilization
        </p>
        <p className="text-[10px] text-muted-foreground/60 leading-tight mb-1.5">
          Min util for any bonus
        </p>
      </div>
      {covered ? (
        <p className="text-xs font-semibold text-emerald-400 leading-tight">Already covered</p>
      ) : unachievable ? (
        <p className="text-xs font-semibold text-red-400 leading-tight">Not achievable</p>
      ) : (
        <p className={`text-xl font-bold font-mono tabular-nums leading-none ${aboveBreakeven ? 'text-emerald-400' : 'text-amber-400'}`}>
          {breakevenUtil.toFixed(1)}%
        </p>
      )}
    </div>
  );
}

// ─── SensitivityTable ─────────────────────────────────────────────────────────

function SensitivityTable({ inputs }: { inputs: BonusInputs }) {
  const {
    currentCollections, currentAR, currentWIP,
    billRate, baseSalary, weeksRemaining,
    currentWipRealizationRate, futureWipRealizationRate,
    performanceMultiple, projectedUtilization,
  } = inputs;

  // Dynamic 7×7 grid centered on user's current inputs (H1)
  const perfRows = [-3, -2, -1, 0, 1, 2, 3].map((d) =>
    Math.min(100, Math.max(0, performanceMultiple + d))
  );
  const utilCols = [-15, -10, -5, 0, 5, 10, 15].map((d) =>
    Math.min(200, Math.max(0, projectedUtilization + d))
  );
  const activePerf = perfRows[3];
  const activeUtil = utilCols[3];

  // Widths for precise H3 alignment
  // The Perf % row-header cell uses w-14 (3.5rem = 56px) in the table
  const ROW_HEADER_W = '3.5rem';
  // The x-axis label row height + table header row height ≈ 3.5rem total
  const Y_AXIS_TOP_SPACER = '3.5rem';

  return (
    <div className="flex gap-0">
      {/* Y-axis: label + downward extending line; arrow starts at first data row (H3) */}
      <div className="flex flex-col items-center shrink-0 mr-2">
        {/* Spacer aligns line start with first data row, not header row */}
        <div style={{ height: Y_AXIS_TOP_SPACER, flexShrink: 0 }} />
        <span
          className="text-[11px] text-muted-foreground/60 tracking-wide whitespace-nowrap"
          style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)', flexShrink: 0 }}
        >
          Performance multiple (%)
        </span>
        <div className="flex-1 mt-1" style={{ borderLeft: '1px solid rgba(255,255,255,0.15)', minHeight: '0.5rem' }} />
        <span className="text-[10px] text-muted-foreground/40 mt-0.5">↓</span>
      </div>

      <div className="flex-1 overflow-x-auto">
        {/* X-axis: arrow starts above first data column, not above row-header cell (H3) */}
        <div className="flex items-center mb-0.5 text-[11px] text-muted-foreground/60 tracking-wide">
          {/* Spacer = width of Perf % column */}
          <div style={{ width: ROW_HEADER_W, flexShrink: 0 }} />
          <span className="whitespace-nowrap">Projected utilization (%)</span>
          <div className="flex-1 mx-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '1px' }} />
          <span>→</span>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              {/* Empty top-left corner (H2) */}
              <TableHead className="w-14" />
              {utilCols.map((u, ci) => (
                <TableHead key={ci}
                  className={`text-center text-xs ${u === activeUtil ? 'text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                  {u}%
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {perfRows.map((perf, ri) => (
              <TableRow key={ri} className="border-white/[0.04] hover:bg-white/[0.02]">
                <TableCell className={`text-center text-xs font-semibold py-2 ${ri === 3 ? 'text-blue-400' : 'text-muted-foreground'}`}>
                  {perf}%
                </TableCell>
                {utilCols.map((util, ci) => {
                  const bonus = calcBonusAt(
                    currentCollections, currentAR, currentWIP,
                    billRate, util, baseSalary, perf, weeksRemaining,
                    currentWipRealizationRate, futureWipRealizationRate,
                  );
                  const isHighlight = ri === 3 && ci === 3;
                  const projNewWIP  = billRate * (util / 100) * 40 * weeksRemaining;
                  const fromCur     = currentWIP * (currentWipRealizationRate / 100);
                  const fromFut     = projNewWIP * (futureWipRealizationRate / 100);
                  const total       = currentCollections + currentAR + fromCur + fromFut;
                  const tooltip     = `Util ${util}% × Perf ${perf}%\nNew WIP: ${fmtShort(projNewWIP)}\nFrom cur WIP: ${fmtShort(fromCur)}\nFrom fut WIP: ${fmtShort(fromFut)}\nTotal: ${fmtShort(total)}\nBonus: ${fmtCurrency(bonus)}`;
                  let cellBg = '', cellText = 'text-foreground/80';
                  if (bonus <= 0) { cellBg = 'bg-red-950/40'; cellText = 'text-red-400'; }
                  else if (bonus > 0.5 * baseSalary) { cellBg = 'bg-emerald-950/40'; cellText = 'text-emerald-400'; }
                  return (
                    <TableCell key={ci} title={tooltip}
                      className={`text-center font-mono text-xs py-2 cursor-default transition-colors duration-100 hover:bg-white/[0.05] ${cellBg} ${cellText} ${isHighlight ? 'animate-pulse-ring font-bold rounded-sm' : ''}`}>
                      {fmtShort(bonus)}
                    </TableCell>
                  );
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

// ─── FormulaBreakdown ─────────────────────────────────────────────────────────

function FormulaBreakdown({ inputs, results }: {
  inputs: BonusInputs; results: BonusResults;
}) {
  const rows = [
    { label: 'Current collections',                  note: 'Cash received this FY',                                                                                       value: fmtCurrency(inputs.currentCollections),                         bold: false, accent: '' },
    { label: '+ Current AR (100%)',                   note: 'Invoiced, not yet collected',                                                                                  value: `+ ${fmtCurrency(inputs.currentAR)}`,                           bold: false, accent: '' },
    { label: '+ Current WIP × current realization',  note: `${fmtCurrency(inputs.currentWIP)} × ${inputs.currentWipRealizationRate}%`,                                    value: `+ ${fmtCurrency(results.projectedCollectionsFromCurrentWIP)}`, bold: false, accent: '' },
    { label: '+ Projected WIP × future realization', note: `$${inputs.billRate}/hr × ${inputs.projectedUtilization}% × 40 hrs × ${Math.round(inputs.weeksRemaining)} wks × ${inputs.futureWipRealizationRate}%`, value: `+ ${fmtCurrency(results.projectedCollectionsFromFutureWIP)}`,  bold: false, accent: '' },
    { label: '= Total projected collections',        note: '',                                                                                                             value: fmtCurrency(results.totalProjectedCollections),                 bold: true,  accent: '' },
    { label: '× Performance multiple',               note: `${inputs.performanceMultiple}%`,                                                                               value: `× ${inputs.performanceMultiple}%`,                             bold: false, accent: '' },
    { label: '− Base salary',                        note: '',                                                                                                             value: `− ${fmtCurrency(inputs.baseSalary)}`,                          bold: false, accent: '' },
    { label: '= Bonus',                              note: `${fmtPct(results.bonusPct)} of base salary`,                                                                  value: fmtCurrency(results.bonus),                                     bold: true,  accent: results.bonus > 0 ? 'text-emerald-400' : 'text-red-400' },
  ];
  return (
    <div className="overflow-x-auto rounded-xl border border-white/[0.07]">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className={`border-b border-white/[0.05] last:border-0 ${row.bold ? 'bg-white/[0.04] font-semibold' : ''}`}>
              <td className="py-3 px-4 text-foreground/90 whitespace-nowrap text-sm">{row.label}</td>
              <td className="py-3 px-4 text-xs text-muted-foreground italic">{row.note}</td>
              <td className={`py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap ${row.accent || 'text-foreground/90'}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Production Chart ─────────────────────────────────────────────────────────

function ProductionTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const collections       = payload.find((p) => p.dataKey === 'collections')?.value ?? 0;
  const productionAbove   = payload.find((p) => p.dataKey === 'productionAbove')?.value ?? 0;
  const totalCompensation = payload.find((p) => p.dataKey === 'totalCompensation')?.value ?? 0;
  return (
    <div className="bg-[#131D35] border border-white/[0.10] rounded-xl shadow-xl px-3 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      <p style={{ color: '#60A5FA' }}>Collections: {fmtCurrency(collections)}</p>
      <p style={{ color: '#86EFAC' }}>Gross production: {fmtCurrency(collections + productionAbove)}</p>
      <p style={{ color: CHART_AMBER }}>Total compensation: {fmtCurrency(totalCompensation)}</p>
    </div>
  );
}

function ProductionChart({
  inputs, totalProjectedCollections,
}: {
  inputs: BonusInputs; totalProjectedCollections: number;
}) {
  const data = generateProductionChartData(inputs, totalProjectedCollections);
  return (
    <div className={`${card} p-5 h-full flex flex-col`}>
      <div className="flex items-center justify-between mb-4 shrink-0">
        <h2 className="text-sm font-semibold text-foreground">Production trajectory</h2>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground justify-end">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: CHART_BLUE }} />
            <span>Collections</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: CHART_GREEN }} />
            <span>Gross production</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3" style={{ borderTop: `2px dashed ${CHART_AMBER}`, marginTop: '1px' }} />
            <span>Total compensation</span>
          </div>
        </div>
      </div>
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={CHART_BLUE}  stopOpacity={0.35} />
                <stop offset="100%" stopColor={CHART_BLUE}  stopOpacity={0.04} />
              </linearGradient>
              <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor={CHART_GREEN} stopOpacity={0.30} />
                <stop offset="100%" stopColor={CHART_GREEN} stopOpacity={0.03} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} interval={0} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10, fill: '#64748B' }} width={76} axisLine={false} tickLine={false} />
            <Tooltip content={<ProductionTooltip />} />
            <Area type="monotone" dataKey="collections"      stackId="p" stroke={CHART_BLUE}  strokeWidth={2} fill="url(#gradBlue)"  animationDuration={800} animationEasing="ease-out" />
            <Area type="monotone" dataKey="productionAbove"  stackId="p" stroke={CHART_GREEN} strokeWidth={2} fill="url(#gradGreen)" animationDuration={800} animationEasing="ease-out" />
            <Area type="monotone" dataKey="totalCompensation" stroke={CHART_AMBER} strokeWidth={2} strokeDasharray="4 3" fill="none" fillOpacity={0} animationDuration={800} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── ReverseCalculator ────────────────────────────────────────────────────────

function ReverseCalculator({ inputs }: { inputs: BonusInputs }) {
  const [open, setOpen] = useState(false);
  const [targetRaw, setTargetRaw] = useState('');

  const {
    baseSalary, performanceMultiple, currentCollections, currentAR, currentWIP,
    currentWipRealizationRate, billRate, weeksRemaining, futureWipRealizationRate,
    projectedUtilization,
  } = inputs;

  const targetBonus = parseFloat(targetRaw.replace(/[^0-9.]/g, '')) || 0;
  const targetCollections = performanceMultiple > 0
    ? (baseSalary + targetBonus) / (performanceMultiple / 100) : Infinity;
  const remaining = !isFinite(targetCollections) ? Infinity
    : targetCollections - currentCollections - currentAR - (currentWIP * (currentWipRealizationRate / 100));
  const futureWipDenom = billRate * 40 * weeksRemaining * (futureWipRealizationRate / 100);
  const requiredUtil = !isFinite(remaining) ? Infinity
    : remaining <= 0 ? 0
    : futureWipDenom > 0 ? (remaining / futureWipDenom) * 100 : Infinity;
  const requiredHrs = isFinite(requiredUtil) && requiredUtil <= 200 ? (requiredUtil / 100) * 40 : null;

  const presets = [
    { label: '50% of salary',  value: baseSalary * 0.5 },
    { label: '100% of salary', value: baseSalary * 1.0 },
    { label: '150% of salary', value: baseSalary * 1.5 },
  ];

  return (
    <div className={`${card} no-print overflow-hidden`}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        <span className="text-sm font-semibold text-foreground">Reverse calculator</span>
        {open
          ? <ChevronUp className="h-4 w-4 text-muted-foreground" />
          : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="px-5 pb-5 space-y-4">
          {/* Target bonus input */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Target bonus ($)</label>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground font-mono">$</span>
              <input
                type="text"
                value={targetRaw}
                onChange={(e) => setTargetRaw(e.target.value)}
                placeholder="e.g. 150000"
                className={`${inputCls} max-w-xs`}
              />
            </div>
          </div>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => setTargetRaw(p.value.toFixed(0))}
                className="text-xs px-2.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-muted-foreground hover:text-foreground transition-all cursor-pointer"
              >
                {p.label} ({fmtShort(p.value)})
              </button>
            ))}
          </div>

          {/* Computed outputs */}
          {targetRaw.trim() !== '' && (
            <div className={`rounded-xl border border-white/[0.10] bg-white/[0.02] p-4 space-y-2.5`}>
              {requiredUtil <= 0 ? (
                <p className="text-xs text-emerald-400">Already on track with current production</p>
              ) : !isFinite(requiredUtil) || requiredUtil > 200 ? (
                <p className="text-xs text-red-400">Not achievable this year — required utilization exceeds 200%</p>
              ) : (
                <>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">Required projected utilization</span>
                    <span className="font-mono font-semibold text-foreground">{requiredUtil.toFixed(1)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground text-xs">Required weekly billing</span>
                    <span className="font-mono font-semibold text-foreground">{requiredHrs?.toFixed(1)} hrs/wk</span>
                  </div>
                  <p className="text-xs text-muted-foreground/70">
                    {(requiredUtil - projectedUtilization) >= 0
                      ? `+${(requiredUtil - projectedUtilization).toFixed(1)}% above your current projection`
                      : `${(requiredUtil - projectedUtilization).toFixed(1)}% below your current projection`}
                  </p>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [inputs, setInputs]           = useState<BonusInputs>(defaultInputs);
  const [level,  setLevel]            = useState(DEFAULT_LEVEL);
  const [lastYearBonus, setLastYearBonus] = useState(0);
  const [mounted, setMounted]         = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BonusInputs> & { level?: string; lastYearBonus?: number };
        const { level: savedLevel, lastYearBonus: savedLYB, ...savedInputs } = parsed;
        setInputs((prev) => ({ ...prev, ...savedInputs }));
        if (savedLevel) setLevel(savedLevel);
        if (savedLYB)   setLastYearBonus(savedLYB);
        if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, raw);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...inputs, level, lastYearBonus }));
    }, 500);
  }, [inputs, level, lastYearBonus, mounted]);

  const update = useCallback(
    (key: keyof BonusInputs) => (value: number) =>
      setInputs((prev) => ({ ...prev, [key]: value })),
    []
  );

  const handleLevelChange = useCallback((name: string, rate: number) => {
    setLevel(name);
    setInputs((prev) => ({ ...prev, billRate: rate }));
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground text-sm">Loading…</div>
      </div>
    );
  }

  const results    = calculateBonus(inputs);
  const weeksCompleted = 52 - inputs.weeksRemaining;
  const fiscalPct  = Math.min(100, (weeksCompleted / 52) * 100);
  const todayStr   = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── Stacked bar segments ──────────────────────────────────────────────────
  const productionSegments = [
    { label: 'Collections', value: inputs.currentCollections, color: BAR_COLLECTIONS },
    { label: 'AR',          value: inputs.currentAR,          color: BAR_AR          },
    { label: 'WIP',         value: inputs.currentWIP,         color: BAR_WIP         },
  ];
  const receivedTotal  = inputs.currentCollections + inputs.currentAR;
  const projectedExtra = Math.max(0, results.totalProjectedCollections - receivedTotal);
  const collectionsSegments = [
    { label: 'Received (collections + AR)', value: receivedTotal,    color: BAR_COLLECTIONS },
    { label: 'Projected',                   value: projectedExtra,   color: BAR_PROJECTED   },
  ];

  // ── Last year bonus comparison (F4) ──────────────────────────────────────
  const hasLastYear = lastYearBonus > 0;
  let lastYearSub: React.ReactNode;
  if (!hasLastYear) {
    lastYearSub = <span className="text-muted-foreground/60">Enter last year's bonus to compare</span>;
  } else {
    const diff    = results.bonus - lastYearBonus;
    const diffPct = (diff / lastYearBonus) * 100;
    if (diff > 0) {
      lastYearSub = <span className="text-emerald-400 flex items-center gap-1"><TrendingUp className="h-3 w-3 shrink-0" />vs last year: +{fmtShort(diff)} (+{diffPct.toFixed(0)}%)</span>;
    } else if (diff < 0) {
      lastYearSub = <span className="text-red-400 flex items-center gap-1"><TrendingDown className="h-3 w-3 shrink-0" />vs last year: {fmtShort(diff)} ({diffPct.toFixed(0)}%)</span>;
    } else {
      lastYearSub = <span className="text-muted-foreground">vs last year: no change</span>;
    }
  }

  // ── Gap to 100% card ──────────────────────────────────────────────────────
  const gap100 = results.collectionsGapTo100;
  const util100 = results.utilNeededFor100;

  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.06] px-6 py-3.5 no-print sticky top-0 z-40 backdrop-blur-sm bg-background/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-blue-400" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground tracking-tight">Bonus Dashboard</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Fiscal year ends October 31 · Auto-saved</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { setInputs(defaultInputs()); setLevel(DEFAULT_LEVEL); setLastYearBonus(0); localStorage.removeItem(STORAGE_KEY); }}
              className="text-xs px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all duration-150 cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.10] text-foreground transition-all duration-150 cursor-pointer"
            >
              <Printer className="h-3.5 w-3.5" />
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* ── Metric Cards (5) ───────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 xl:grid-cols-5">

          {/* 1. Total production today */}
          <MetricCard
            title="Total production today"
            rawValue={results.totalPipeline}
            format={fmtShort}
            icon={Layers}
            animDelay={0}
          >
            <StackedBar segments={productionSegments} />
          </MetricCard>

          {/* 2. Total projected collections */}
          <MetricCard
            title="Total projected collections"
            rawValue={results.totalProjectedCollections}
            format={fmtShort}
            icon={DollarSign}
            animDelay={60}
          >
            <StackedBar segments={collectionsSegments} />
            <PacingSection results={results} />
          </MetricCard>

          {/* 3. Projected bonus */}
          <MetricCard
            title="Projected bonus"
            rawValue={results.bonus}
            format={fmtShort}
            sub={`Total comp: ${fmtShort(inputs.baseSalary + results.bonus)}`}
            icon={TrendingUp}
            accentColor={results.bonus > 0 ? '#34D399' : '#F87171'}
            isPositive={results.bonus > 0}
            animDelay={120}
          />

          {/* 4. Bonus % of base salary */}
          <MetricCard
            title="Bonus % of base salary"
            rawValue={results.bonusPct}
            format={fmtPct}
            icon={Percent}
            accentColor={results.bonusPct > 50 ? '#34D399' : '#F1F5F9'}
            animDelay={180}
          >
            <p className="text-xs mt-2 flex items-center gap-1 flex-wrap">{lastYearSub}</p>
          </MetricCard>

          {/* 5. Gap to 100% bonus */}
          <div
            className={`${card} p-5 hover:-translate-y-0.5 hover:border-white/[0.12] transition-all duration-150 animate-fade-up`}
            style={{ animationDelay: '240ms' }}
          >
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-medium text-muted-foreground">Gap to 100% bonus</p>
              <div className="rounded-lg bg-white/[0.05] p-1.5">
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            {gap100 <= 0 ? (
              <>
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-6 w-6 text-emerald-400 shrink-0" />
                  <p className="text-2xl font-bold text-emerald-400 leading-none">Target reached</p>
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  {((results.bonus / inputs.baseSalary) * 100).toFixed(0)}% of base salary projected
                </p>
              </>
            ) : !isFinite(util100) || util100 > 200 ? (
              <>
                <p className="text-3xl font-bold tabular-nums tracking-tight leading-none">{fmtShort(gap100)}</p>
                <p className="text-xs text-red-400 mt-2">Not achievable this year</p>
              </>
            ) : (
              <>
                <p className="text-3xl font-bold tabular-nums tracking-tight leading-none">{fmtShort(gap100)}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Requires {util100.toFixed(1)}% projected utilization
                </p>
              </>
            )}
          </div>
        </section>

        {/* ── Inputs (horizontal compact) ────────────────────────────────── */}
        <div className={`${card} p-5 no-print`}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground">Inputs</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-blue-400 font-mono tabular-nums font-medium">{fiscalPct.toFixed(0)}%</span>
              <span>of FY elapsed</span>
            </div>
          </div>

          {/* Weeks remaining above bar */}
          <div className="flex justify-end text-xs text-muted-foreground/60 mb-1">
            <span>{Math.round(inputs.weeksRemaining)} wks remaining</span>
          </div>

          {/* FY progress bar */}
          <div>
            <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
              <div className="h-full rounded-full bg-blue-500 transition-all duration-500"
                   style={{ width: `${fiscalPct}%` }} />
            </div>
            <div className="relative h-5 mt-0.5">
              <span
                className="absolute text-[10px] text-blue-400/80 font-mono -translate-x-1/2 whitespace-nowrap"
                style={{ left: `${Math.min(fiscalPct, 96)}%` }}
              >
                {todayStr}
              </span>
            </div>
            <div className="flex justify-between text-xs text-muted-foreground/40">
              <span>Nov 1</span><span>Oct 31</span>
            </div>
          </div>

          {/* Three input clusters — flex so Projections can be wider */}
          <div className="flex items-start mt-5 gap-0">

            {/* Group 1: Current production */}
            <div className="shrink-0 pr-5 border-r border-white/[0.06]">
              <p className={`${sectionLabel} mb-2`}>Current production</p>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 90px)', gap: '8px', alignItems: 'start' }}>
                <TextInput labelText="Collections" value={inputs.currentCollections} onChange={update('currentCollections')} prefix="$" suffix="K" scale={1000} placeholder="500" />
                <TextInput labelText="Accounts receivable" value={inputs.currentAR} onChange={update('currentAR')} prefix="$" suffix="K" scale={1000} placeholder="150" />
                <TextInput labelText="WIP" value={inputs.currentWIP} onChange={update('currentWIP')} prefix="$" suffix="K" scale={1000} placeholder="75" />
              </div>
            </div>

            {/* Group 2: Projections */}
            <div className="flex-1 px-5 border-r border-white/[0.06] min-w-0">
              <p className={`${sectionLabel} mb-2`}>Projections</p>
              <div style={{ display: 'grid', gridTemplateColumns: '180px 75px 85px 85px auto', gap: '8px', alignItems: 'start' }}>
                <LevelSelect level={level} onLevelChange={handleLevelChange} />
                <TextInput labelText="Projected utilization" value={inputs.projectedUtilization} onChange={update('projectedUtilization')} suffix="%" placeholder="80" />
                <TextInput labelText="Current WIP realization" value={inputs.currentWipRealizationRate} onChange={update('currentWipRealizationRate')} suffix="%" placeholder="85" />
                <TextInput labelText="Future WIP realization" value={inputs.futureWipRealizationRate} onChange={update('futureWipRealizationRate')} suffix="%" placeholder="50" />
                <BreakevenCallout results={results} projectedUtilization={inputs.projectedUtilization} />
              </div>
            </div>

            {/* Group 3: Compensation */}
            <div className="shrink-0 pl-5">
              <p className={`${sectionLabel} mb-2`}>Compensation</p>
              <div style={{ display: 'grid', gridTemplateColumns: '100px 85px 90px 95px', gap: '8px', alignItems: 'start' }}>
                <TextInput labelText="Base salary" value={inputs.baseSalary} onChange={update('baseSalary')} prefix="$" suffix="K" scale={1000} placeholder="200" />
                <TextInput labelText="Performance multiple" value={inputs.performanceMultiple} onChange={update('performanceMultiple')} suffix="%" placeholder="50" />
                <TextInput labelText="Weeks remaining" value={inputs.weeksRemaining} onChange={update('weeksRemaining')} suffix=" wks" decimals={0} placeholder="28" />
                <TextInput labelText="Last year's bonus" value={lastYearBonus} onChange={setLastYearBonus} prefix="$" suffix="K" scale={1000} placeholder="0" />
              </div>
            </div>

          </div>
        </div>

        {/* ── Reverse calculator (collapsible) ───────────────────────────── */}
        <ReverseCalculator inputs={inputs} />

        {/* ── Chart + Sensitivity side-by-side ───────────────────────────── */}
        <div className="grid grid-cols-2 gap-5 items-stretch" style={{ minHeight: '420px' }}>
          <ProductionChart inputs={inputs} totalProjectedCollections={results.totalProjectedCollections} />

          <div className={`${card} p-5 no-print h-full`}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">Sensitivity analysis</h2>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Bonus at varying performance multiples × projected utilization</div>
                <div>
                  <span className="text-red-400">red = $0</span>
                  {' · '}
                  <span className="text-emerald-400">green = &gt;50% of salary</span>
                  {' · '}
                  <span className="text-blue-400">blue = current inputs</span>
                </div>
              </div>
            </div>
            <SensitivityTable inputs={inputs} />
          </div>
        </div>

        {/* ── Formula Breakdown ──────────────────────────────────────────── */}
        <div className={`${card} p-5`}>
          <h2 className="text-sm font-semibold text-foreground mb-4">Formula breakdown</h2>
          <FormulaBreakdown inputs={inputs} results={results} />
        </div>

      </main>

      <div className="hidden print:block text-center text-xs text-muted-foreground py-6 border-t border-border mt-8">
        Bonus Dashboard · Exported {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

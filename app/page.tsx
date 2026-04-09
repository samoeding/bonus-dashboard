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

const CHART_BLUE  = '#4472C4';
const CHART_GREEN = '#2E75B6';
const CHART_AMBER = '#C0504D';

const BAR_COLLECTIONS = '#2E75B6';
const BAR_AR          = '#C0504D';
const BAR_WIP         = '#4472C4';
const BAR_PROJECTED   = '#95B3D7';

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
  fullDate: string;
  collections: number;
  productionAbove: number;
  totalCompensation: number;
}

/**
 * Calendar-month boundary sampling: today + 1st of each remaining month + Oct 31.
 * Last point pinned to totalProjectedCollections so chart matches summary card.
 */
function generateProductionChartData(
  inputs: BonusInputs,
  totalProjectedCollections: number,
): ChartPoint[] {
  const {
    currentCollections, currentAR, currentWIP, billRate, projectedUtilization,
    currentWipRealizationRate, futureWipRealizationRate, performanceMultiple,
    weeksRemaining, baseSalary,
  } = inputs;

  const WEEKLY_BILL = billRate * (projectedUtilization / 100) * 40;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const yr = today.getFullYear();
  let fyEnd = new Date(yr, 9, 31, 23, 59, 59);
  if (today > fyEnd) fyEnd = new Date(yr + 1, 9, 31, 23, 59, 59);

  const totalMs = Math.max(0, fyEnd.getTime() - today.getTime());

  const makePoint = (date: Date, isLast: boolean): ChartPoint => {
    const t = totalMs > 0 ? Math.min(1, (date.getTime() - today.getTime()) / totalMs) : 1;
    const weeksFromNow = t * weeksRemaining;
    const newWipGross  = WEEKLY_BILL * weeksFromNow;
    const collections  = isLast
      ? totalProjectedCollections
      : currentCollections + currentAR
          + (currentWIP * (currentWipRealizationRate / 100)) * t
          + (newWipGross * (futureWipRealizationRate / 100)) * t;
    const grossProd         = currentCollections + currentAR + currentWIP + newWipGross;
    const totalCompensation = baseSalary + Math.max(0, collections * (performanceMultiple / 100) - baseSalary);
    const label    = isLast ? 'Oct 31' : date.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    const fullDate = date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    return { label, fullDate, collections, productionAbove: Math.max(0, grossProd - collections), totalCompensation };
  };

  if (totalMs === 0 || weeksRemaining <= 0) {
    return [makePoint(fyEnd, true)];
  }

  // today + 1st of each remaining month + Oct 31
  const dates: Date[] = [new Date(today)];
  const cursor = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  while (cursor < fyEnd) {
    dates.push(new Date(cursor));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  dates.push(new Date(fyEnd.getFullYear(), 9, 31));

  return dates.map((d, i) => makePoint(d, i === dates.length - 1));
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

const card         = 'bg-[#172435] border border-white/[0.08] rounded-2xl';
const inputCls     = 'h-10 w-full rounded-xl border border-white/[0.10] bg-white/[0.04] px-2 text-sm font-mono tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[#2E75B6]/50 focus:border-[#2E75B6]/50 transition-all duration-150 cursor-text';
const sectionLabel = 'text-xs font-semibold text-[#95B3D7] tracking-wide shrink-0';

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
          style={{ textOverflow: 'ellipsis' }}
        >
          {LEVELS.map((l) => <option key={l.name} value={l.name} className="bg-[#172435]">{l.name}</option>)}
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
  const total  = segments.reduce((s, seg) => s + seg.value, 0);
  const barRef = useRef<HTMLDivElement>(null);
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    setBarWidth(el.offsetWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => setBarWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (total <= 0) return null;
  return (
    <div className="mt-3">
      <div ref={barRef} className="flex h-5 rounded-lg overflow-hidden w-full">
        {segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          const px  = (pct / 100) * barWidth;
          return (
            <div
              key={i}
              className="relative overflow-hidden shrink-0"
              style={{ width: `${pct}%`, background: seg.color }}
              title={`${seg.label}: ${fmtShort(seg.value)} · ${pct.toFixed(0)}%`}
            >
              {px >= 50 && (
                <span
                  className="absolute text-[11px] font-semibold text-white leading-none pointer-events-none"
                  style={{ top: '50%', left: '50%', transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap' }}
                >
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

function PacingSection({ results, weeksRemaining }: { results: BonusResults; weeksRemaining: number }) {
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
    <div className="mt-3 space-y-2 pt-2.5 border-t border-white/[0.06]">
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">Avg collections/wk so far</span>
          <span className="font-mono tabular-nums">{fmtPace(actualWeeklyRunRate)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">Based on {Math.round(weeksElapsed)} weeks elapsed</p>
      </div>
      <div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground font-medium">Collections/wk needed to hit projection</span>
          <span className="font-mono tabular-nums">{fmtPace(requiredWeeklyRunRate)}</span>
        </div>
        <p className="text-[10px] text-muted-foreground/50 mt-0.5">Over {Math.round(weeksRemaining)} weeks remaining</p>
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

// ─── BreakevenCard ────────────────────────────────────────────────────────────

function BreakevenCard({ results, projectedUtilization }: {
  results: BonusResults; projectedUtilization: number;
}) {
  const { breakevenUtil } = results;
  const covered        = breakevenUtil <= 0;
  const unachievable   = !isFinite(breakevenUtil) || breakevenUtil > 200;
  const aboveBreakeven = !covered && !unachievable && breakevenUtil <= projectedUtilization;

  const borderColor  = covered || aboveBreakeven ? 'border-emerald-500/30'
    : unachievable ? 'border-red-500/30' : 'border-amber-500/30';
  const statusColor  = covered || aboveBreakeven ? 'text-emerald-400'
    : unachievable ? 'text-red-400' : 'text-amber-400';

  return (
    <div className={`${card} px-5 py-4 border-2 ${borderColor} flex items-center gap-6`}>
      <div>
        <p className="text-xs font-semibold text-foreground/90">Breakeven utilization</p>
        <p className="text-[11px] text-muted-foreground/60 mt-0.5">Minimum utilization needed for any bonus</p>
      </div>
      <div className="ml-auto text-right shrink-0">
        {covered ? (
          <p className={`text-sm font-semibold ${statusColor} flex items-center gap-1.5 justify-end`}>
            <CheckCircle2 className="h-4 w-4" /> Already covered
          </p>
        ) : unachievable ? (
          <p className={`text-sm font-semibold ${statusColor}`}>Not achievable</p>
        ) : (
          <>
            <p className={`text-2xl font-bold font-mono tabular-nums leading-none ${statusColor}`}>
              {breakevenUtil.toFixed(1)}%
            </p>
            <p className="text-[11px] text-muted-foreground/60 mt-0.5">
              {aboveBreakeven
                ? 'Current projection exceeds this'
                : `${(breakevenUtil - projectedUtilization).toFixed(1)}% above your projection`}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ─── SensitivityTable ─────────────────────────────────────────────────────────

interface SensTooltipData {
  util: number; perf: number;
  projectedCollections: number;
  grossBonus: number;
  x: number; y: number;
}

function SensitivityTable({ inputs }: { inputs: BonusInputs }) {
  const {
    currentCollections, currentAR, currentWIP,
    billRate, baseSalary, weeksRemaining,
    currentWipRealizationRate, futureWipRealizationRate,
    performanceMultiple, projectedUtilization,
  } = inputs;

  const [tooltip, setTooltip] = useState<SensTooltipData | null>(null);

  const perfRows = [-3, -2, -1, 0, 1, 2, 3].map((d) =>
    Math.min(100, Math.max(0, performanceMultiple + d))
  );
  const utilCols = [-15, -10, -5, 0, 5, 10, 15].map((d) =>
    Math.min(200, Math.max(0, projectedUtilization + d))
  );
  const activeUtil = utilCols[3];

  // Pre-compute all 49 values for gradient scaling (transparent → steel blue)
  const allBonuses = perfRows.flatMap((perf) =>
    utilCols.map((util) =>
      calcBonusAt(currentCollections, currentAR, currentWIP, billRate, util, baseSalary, perf, weeksRemaining, currentWipRealizationRate, futureWipRealizationRate)
    )
  );
  const positiveBonuses = allBonuses.filter((b) => b > 0);
  const minPositive = positiveBonuses.length > 0 ? Math.min(...positiveBonuses) : 0;
  const maxPositive = positiveBonuses.length > 0 ? Math.max(...positiveBonuses) : 1;

  const ROW_HEADER_W    = '3.5rem';
  const Y_AXIS_TOP_SPACER = '3.5rem';

  return (
    <div className="flex gap-0 relative">
      {/* Styled tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: tooltip.x + 12, top: tooltip.y - 8 }}
        >
          <div className="bg-[#1D2E44] border border-[#2E75B6]/40 rounded-xl shadow-2xl px-3.5 py-3 text-xs space-y-1.5 min-w-[200px]">
            <p className="font-semibold text-[#DEEAF1] mb-2 border-b border-white/[0.08] pb-1.5">
              Util {tooltip.util}% × Perf {tooltip.perf}%
            </p>
            <div className="flex justify-between gap-4">
              <span className="text-[#95B3D7]">Projected collections</span>
              <span className="font-mono text-[#DEEAF1] tabular-nums">{fmtShort(tooltip.projectedCollections)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#95B3D7]">Gross bonus</span>
              <span className={`font-mono tabular-nums ${tooltip.grossBonus > 0 ? 'text-emerald-400' : 'text-red-400'}`}>{fmtCurrency(tooltip.grossBonus)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span className="text-[#95B3D7]">Net bonus <span className="opacity-60">(est. 35%)</span></span>
              <span className={`font-mono tabular-nums ${tooltip.grossBonus > 0 ? 'text-emerald-300' : 'text-red-400'}`}>{fmtCurrency(tooltip.grossBonus * 0.65)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Y-axis */}
      <div className="flex flex-col items-center shrink-0 mr-2">
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
        {/* X-axis */}
        <div className="flex items-center mb-0.5 text-[11px] text-muted-foreground/60 tracking-wide">
          <div style={{ width: ROW_HEADER_W, flexShrink: 0 }} />
          <span className="whitespace-nowrap">Projected utilization (%)</span>
          <div className="flex-1 mx-1.5" style={{ borderTop: '1px solid rgba(255,255,255,0.15)', marginTop: '1px' }} />
          <span>→</span>
        </div>

        <Table>
          <TableHeader>
            <TableRow className="border-white/[0.06] hover:bg-transparent">
              <TableHead className="w-14" />
              {utilCols.map((u, ci) => (
                <TableHead key={ci}
                  className={`text-center text-xs ${u === activeUtil ? 'text-[#4472C4] font-bold' : 'text-muted-foreground'}`}>
                  {u}%
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {perfRows.map((perf, ri) => (
              <TableRow key={ri} className="border-white/[0.04] hover:bg-white/[0.02]">
                <TableCell className={`text-center text-xs font-semibold py-2 ${ri === 3 ? 'text-[#4472C4]' : 'text-muted-foreground'}`}>
                  {perf}%
                </TableCell>
                {utilCols.map((util, ci) => {
                  const bonus = calcBonusAt(
                    currentCollections, currentAR, currentWIP,
                    billRate, util, baseSalary, perf, weeksRemaining,
                    currentWipRealizationRate, futureWipRealizationRate,
                  );
                  const isActive   = ri === 3 && ci === 3;
                  const projNewWIP = billRate * (util / 100) * 40 * weeksRemaining;
                  const fromCur    = currentWIP * (currentWipRealizationRate / 100);
                  const fromFut    = projNewWIP * (futureWipRealizationRate / 100);
                  const total      = currentCollections + currentAR + fromCur + fromFut;

                  let cellStyle: React.CSSProperties = {};
                  let cellText = 'text-white';
                  if (bonus <= 0) {
                    cellStyle = { background: 'rgba(192, 80, 77, 0.30)' };
                    cellText  = 'text-red-300';
                  } else {
                    const range = maxPositive - minPositive;
                    const alpha = range > 0 ? ((bonus - minPositive) / range) * 0.55 : 0.55;
                    cellStyle = { background: `rgba(46, 117, 182, ${alpha.toFixed(3)})` };
                  }
                  if (isActive) {
                    cellStyle = { ...cellStyle, outline: '2px solid #2E75B6', outlineOffset: '-2px' };
                  }

                  return (
                    <TableCell
                      key={ci}
                      style={cellStyle}
                      onMouseEnter={(e) => setTooltip({ util, perf, projectedCollections: total, grossBonus: bonus, x: e.clientX, y: e.clientY })}
                      onMouseMove={(e) => setTooltip((t) => t ? { ...t, x: e.clientX, y: e.clientY } : t)}
                      onMouseLeave={() => setTooltip(null)}
                      className={`text-center font-mono text-xs py-2 cursor-default transition-colors duration-100 ${cellText} ${isActive ? 'font-bold' : ''}`}
                    >
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
    { label: 'Current collections',                  note: 'Cash received this FY',                                                                                                                               value: fmtCurrency(inputs.currentCollections),                         bold: false, accent: '' },
    { label: '+ Current AR (100%)',                   note: 'Invoiced, not yet collected',                                                                                                                          value: `+ ${fmtCurrency(inputs.currentAR)}`,                           bold: false, accent: '' },
    { label: '+ Current WIP × current realization',  note: `${fmtCurrency(inputs.currentWIP)} × ${inputs.currentWipRealizationRate}%`,                                                                            value: `+ ${fmtCurrency(results.projectedCollectionsFromCurrentWIP)}`, bold: false, accent: '' },
    { label: '+ Projected WIP × future realization', note: `$${inputs.billRate}/hr × ${inputs.projectedUtilization}% × 40 hrs × ${Math.round(inputs.weeksRemaining)} wks × ${inputs.futureWipRealizationRate}%`, value: `+ ${fmtCurrency(results.projectedCollectionsFromFutureWIP)}`,  bold: false, accent: '' },
    { label: '= Total projected collections',        note: '',                                                                                                                                                     value: fmtCurrency(results.totalProjectedCollections),                 bold: true,  accent: '' },
    { label: '× Performance multiple',               note: `${inputs.performanceMultiple}%`,                                                                                                                       value: `× ${inputs.performanceMultiple}%`,                             bold: false, accent: '' },
    { label: '− Base salary',                        note: '',                                                                                                                                                     value: `− ${fmtCurrency(inputs.baseSalary)}`,                          bold: false, accent: '' },
    { label: '= Bonus',                              note: `${fmtPct(results.bonusPct)} of base salary`,                                                                                                          value: fmtCurrency(results.bonus),                                     bold: true,  accent: results.bonus > 0 ? 'text-emerald-400' : 'text-red-400' },
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

function ProductionTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; payload: ChartPoint }>;
}) {
  if (!active || !payload?.length) return null;
  const point             = payload[0]?.payload;
  const collections       = payload.find((p) => p.dataKey === 'collections')?.value ?? 0;
  const productionAbove   = payload.find((p) => p.dataKey === 'productionAbove')?.value ?? 0;
  const totalCompensation = payload.find((p) => p.dataKey === 'totalCompensation')?.value ?? 0;
  return (
    <div className="bg-[#1D2E44] border border-white/[0.10] rounded-xl shadow-xl px-3 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1.5">{point?.fullDate ?? ''}</p>
      <p style={{ color: '#4472C4' }}>Collections: {fmtCurrency(collections)}</p>
      <p style={{ color: '#95B3D7' }}>Gross production: {fmtCurrency(collections + productionAbove)}</p>
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
            <Area type="monotone" dataKey="collections"      stackId="p" stroke={CHART_BLUE}  strokeWidth={2} fill="url(#gradBlue)"  dot={{ r: 3, fill: CHART_BLUE,  strokeWidth: 0 }} activeDot={{ r: 4 }} animationDuration={800} animationEasing="ease-out" />
            <Area type="monotone" dataKey="productionAbove"  stackId="p" stroke={CHART_GREEN} strokeWidth={2} fill="url(#gradGreen)" dot={{ r: 3, fill: CHART_GREEN, strokeWidth: 0 }} activeDot={{ r: 4 }} animationDuration={800} animationEasing="ease-out" />
            <Area type="monotone" dataKey="totalCompensation" stroke={CHART_AMBER} strokeWidth={2} strokeDasharray="4 3" fill="none" fillOpacity={0} dot={{ r: 3, fill: CHART_AMBER, strokeWidth: 0 }} activeDot={{ r: 4 }} animationDuration={800} animationEasing="ease-out" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── LastYearInputs ───────────────────────────────────────────────────────────

function LastYearInputs({
  lastYearBaseSalary, lastYearBonus, lastYearCollections,
  setLastYearBaseSalary, setLastYearBonus, setLastYearCollections,
}: {
  lastYearBaseSalary: number; lastYearBonus: number; lastYearCollections: number;
  setLastYearBaseSalary: (v: number) => void; setLastYearBonus: (v: number) => void;
  setLastYearCollections: (v: number) => void;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground/60 mb-3">Used for year-over-year comparisons on metric cards.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <TextInput labelText="Base salary" value={lastYearBaseSalary} onChange={setLastYearBaseSalary} prefix="$" suffix="K" scale={1000} placeholder="200" />
        <TextInput labelText="Bonus"       value={lastYearBonus}      onChange={setLastYearBonus}      prefix="$" suffix="K" scale={1000} placeholder="0"   />
        <TextInput labelText="Collections" value={lastYearCollections} onChange={setLastYearCollections} prefix="$" suffix="K" scale={1000} placeholder="0"   />
      </div>
    </div>
  );
}

// ─── PDF Export ───────────────────────────────────────────────────────────────

function generatePrintHTML(
  inputs: BonusInputs,
  results: BonusResults,
  lastYearBaseSalary: number,
  lastYearBonus: number,
  lastYearCollections: number,
  todayStr: string,
): string {
  const f  = fmtCurrency;
  const fs = fmtShort;

  // Sensitivity table
  const perfDeltas = [-3, -2, -1, 0, 1, 2, 3];
  const utilDeltas = [-15, -10, -5, 0, 5, 10, 15];
  const sensHeaders = utilDeltas.map((d) => {
    const u  = Math.min(200, Math.max(0, inputs.projectedUtilization + d));
    const hl = u === inputs.projectedUtilization ? ' style="color:#2E75B6"' : '';
    return `<th${hl}>${u}%</th>`;
  }).join('');
  const sensRows = perfDeltas.map((dp, ri) => {
    const perf  = Math.min(100, Math.max(0, inputs.performanceMultiple + dp));
    const cells = utilDeltas.map((du, ci) => {
      const util  = Math.min(200, Math.max(0, inputs.projectedUtilization + du));
      const bonus = calcBonusAt(inputs.currentCollections, inputs.currentAR, inputs.currentWIP, inputs.billRate, util, inputs.baseSalary, perf, inputs.weeksRemaining, inputs.currentWipRealizationRate, inputs.futureWipRealizationRate);
      const cls   = (ri === 3 && ci === 3) ? 'sens-active' : bonus <= 0 ? 'sens-neg' : 'sens-pos';
      return `<td class="${cls}">${fs(bonus)}</td>`;
    }).join('');
    const phd = ri === 3 ? ' style="color:#2E75B6"' : '';
    return `<tr><th${phd}>${perf}%</th>${cells}</tr>`;
  }).join('');

  const lyInputRows = [
    lastYearBaseSalary > 0  ? `<tr><td>LY base salary</td><td class="num">${f(lastYearBaseSalary)}</td></tr>` : '',
    lastYearBonus > 0       ? `<tr><td>LY bonus</td><td class="num">${f(lastYearBonus)}</td></tr>` : '',
    lastYearCollections > 0 ? `<tr><td>LY collections</td><td class="num">${f(lastYearCollections)}</td></tr>` : '',
  ].join('');

  const lyAnalyticsRows = [
    lastYearCollections > 0
      ? `<tr><td>YoY collections</td><td class="num">${fs(results.totalProjectedCollections - lastYearCollections)}</td><td style="color:#64748b;font-size:11px">vs LY ${fs(lastYearCollections)}</td></tr>`
      : '',
    (lastYearBonus > 0 && lastYearBaseSalary > 0)
      ? `<tr><td>YoY total compensation</td><td class="num">${fs((inputs.baseSalary + results.bonus) - (lastYearBaseSalary + lastYearBonus))}</td><td style="color:#64748b;font-size:11px">vs LY ${fs(lastYearBaseSalary + lastYearBonus)}</td></tr>`
      : '',
  ].join('');

  const breakevenStr = (results.breakevenUtil <= 0)
    ? 'Already covered'
    : (!isFinite(results.breakevenUtil) || results.breakevenUtil > 200)
      ? 'Not achievable'
      : fmtPct(results.breakevenUtil);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Bonus Dashboard — ${todayStr}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, system-ui, sans-serif; font-size: 13px; color: #1e293b; background: #fff; padding: 32px 40px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
    h2 { font-size: 14px; font-weight: 600; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 1.5px solid #e2e8f0; color: #1e293b; }
    .subtitle { font-size: 11px; color: #64748b; margin-bottom: 20px; }
    .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .grid5 { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; }
    .mc { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; }
    .mc .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 6px; }
    .mc .val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .mc .sub { font-size: 10px; color: #64748b; margin-top: 4px; }
    .green { color: #16a34a; } .red { color: #dc2626; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 8px; }
    th { background: #f1f5f9; font-weight: 600; text-align: left; padding: 7px 10px; border: 1px solid #e2e8f0; }
    td { padding: 7px 10px; border: 1px solid #e2e8f0; }
    .num { text-align: right; font-variant-numeric: tabular-nums; font-family: monospace; }
    .bold { font-weight: 600; background: #f8fafc; }
    .sens-table th, .sens-table td { text-align: center; padding: 5px 8px; font-size: 11px; font-family: monospace; }
    .sens-active { outline: 2px solid #2E75B6; font-weight: 700; }
    .sens-pos { background: rgba(21,128,61,0.15); }
    .sens-neg { background: rgba(220,38,38,0.20); color: #dc2626; }
    .footer { margin-top: 32px; font-size: 10px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 12px; }
    @media print { body { padding: 16px 20px; } }
  </style>
</head>
<body>
  <h1>Bonus Dashboard</h1>
  <p class="subtitle">Exported ${todayStr} &middot; Fiscal Year ends October 31</p>

  <h2>1. Summary Metrics</h2>
  <div class="grid5">
    <div class="mc"><div class="lbl">Total production today</div><div class="val">${fs(results.totalPipeline)}</div><div class="sub">Collections + AR + WIP</div></div>
    <div class="mc"><div class="lbl">Total projected collections</div><div class="val">${fs(results.totalProjectedCollections)}</div><div class="sub">FY end projection</div></div>
    <div class="mc"><div class="lbl">Projected bonus</div><div class="val ${results.bonus > 0 ? 'green' : 'red'}">${fs(results.bonus)}</div><div class="sub">Total comp: ${fs(inputs.baseSalary + results.bonus)}</div></div>
    <div class="mc"><div class="lbl">Bonus % of base salary</div><div class="val">${fmtPct(results.bonusPct)}</div><div class="sub">${lastYearBonus > 0 ? 'LY bonus: ' + fs(lastYearBonus) : 'No LY data'}</div></div>
    <div class="mc"><div class="lbl">Gap to target bonus</div><div class="val ${results.collectionsGapTo100 <= 0 ? 'green' : ''}">${results.collectionsGapTo100 <= 0 ? 'Target reached' : fs(results.collectionsGapTo100)}</div><div class="sub">Collections needed for bonus = base</div></div>
  </div>

  <h2>2. Inputs Snapshot</h2>
  <div class="grid3">
    <table><tbody>
      <tr><th colspan="2">Current Production</th></tr>
      <tr><td>Collections</td><td class="num">${f(inputs.currentCollections)}</td></tr>
      <tr><td>Accounts receivable</td><td class="num">${f(inputs.currentAR)}</td></tr>
      <tr><td>WIP</td><td class="num">${f(inputs.currentWIP)}</td></tr>
    </tbody></table>
    <table><tbody>
      <tr><th colspan="2">Projections</th></tr>
      <tr><td>Bill rate</td><td class="num">$${inputs.billRate}/hr</td></tr>
      <tr><td>Projected utilization</td><td class="num">${inputs.projectedUtilization}%</td></tr>
      <tr><td>Cur WIP realization</td><td class="num">${inputs.currentWipRealizationRate}%</td></tr>
      <tr><td>Fut WIP realization</td><td class="num">${inputs.futureWipRealizationRate}%</td></tr>
      <tr><td>Weeks remaining</td><td class="num">${Math.round(inputs.weeksRemaining)} wks</td></tr>
    </tbody></table>
    <table><tbody>
      <tr><th colspan="2">Compensation</th></tr>
      <tr><td>Base salary</td><td class="num">${f(inputs.baseSalary)}</td></tr>
      <tr><td>Performance multiple</td><td class="num">${inputs.performanceMultiple}%</td></tr>
      ${lyInputRows}
    </tbody></table>
  </div>

  <h2>3. Pipeline Breakdown</h2>
  <table><tbody>
    <tr><td>Current collections</td><td class="num">${f(inputs.currentCollections)}</td><td style="color:#64748b;font-size:11px">Cash received this FY</td></tr>
    <tr><td>+ Current AR (100%)</td><td class="num">${f(inputs.currentAR)}</td><td style="color:#64748b;font-size:11px">Invoiced, not yet collected</td></tr>
    <tr><td>+ Current WIP &times; ${inputs.currentWipRealizationRate}%</td><td class="num">${f(results.projectedCollectionsFromCurrentWIP)}</td><td style="color:#64748b;font-size:11px">${f(inputs.currentWIP)} &times; ${inputs.currentWipRealizationRate}%</td></tr>
    <tr><td>+ Projected WIP &times; ${inputs.futureWipRealizationRate}%</td><td class="num">${f(results.projectedCollectionsFromFutureWIP)}</td><td style="color:#64748b;font-size:11px">$${inputs.billRate}/hr &times; ${inputs.projectedUtilization}% &times; 40 hrs &times; ${Math.round(inputs.weeksRemaining)} wks &times; ${inputs.futureWipRealizationRate}%</td></tr>
    <tr class="bold"><td>= Total projected collections</td><td class="num">${f(results.totalProjectedCollections)}</td><td></td></tr>
    <tr><td>&times; Performance multiple</td><td class="num">${inputs.performanceMultiple}%</td><td></td></tr>
    <tr><td>&minus; Base salary</td><td class="num">${f(inputs.baseSalary)}</td><td></td></tr>
    <tr class="bold"><td>= Bonus</td><td class="num ${results.bonus > 0 ? 'green' : 'red'}">${f(results.bonus)}</td><td style="color:#64748b;font-size:11px">${fmtPct(results.bonusPct)} of base salary</td></tr>
  </tbody></table>

  <h2>4. Sensitivity Analysis</h2>
  <p style="font-size:11px;color:#64748b;margin-bottom:8px">Bonus at varying performance multiples (rows) &times; projected utilization (columns)</p>
  <table class="sens-table">
    <thead><tr><th>Perf \\ Util</th>${sensHeaders}</tr></thead>
    <tbody>${sensRows}</tbody>
  </table>

  <h2>5. Pacing &amp; Analytics</h2>
  <table><tbody>
    <tr><td>FY elapsed</td><td class="num">${fmtPct(results.fiscalYearPct)}</td><td style="color:#64748b;font-size:11px">${Math.round(results.weeksElapsed)} of 52 weeks</td></tr>
    <tr><td>Avg collections/wk so far</td><td class="num">${fmtPace(results.actualWeeklyRunRate)}</td><td style="color:#64748b;font-size:11px">Based on ${Math.round(results.weeksElapsed)} weeks elapsed</td></tr>
    <tr><td>Collections/wk needed to hit projection</td><td class="num">${fmtPace(results.requiredWeeklyRunRate)}</td><td style="color:#64748b;font-size:11px">Over ${Math.round(inputs.weeksRemaining)} weeks remaining</td></tr>
    <tr><td>Breakeven utilization</td><td class="num">${breakevenStr}</td><td style="color:#64748b;font-size:11px">Min util for any bonus</td></tr>
    <tr><td>Gap to target bonus</td><td class="num">${results.collectionsGapTo100 <= 0 ? 'Target reached' : fs(results.collectionsGapTo100)}</td><td style="color:#64748b;font-size:11px">Additional collections for bonus = base salary</td></tr>
    ${lyAnalyticsRows}
  </tbody></table>

  <p class="footer">Generated by Bonus Dashboard &middot; ${todayStr}</p>
</body>
</html>`;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [inputs, setInputs]                         = useState<BonusInputs>(defaultInputs);
  const [level,  setLevel]                          = useState(DEFAULT_LEVEL);
  const [lastYearBonus, setLastYearBonus]           = useState(0);
  const [lastYearBaseSalary, setLastYearBaseSalary] = useState(0);
  const [lastYearCollections, setLastYearCollections] = useState(0);
  const [collapsiblesOpen, setCollapsiblesOpen]     = useState(false);
  const [mounted, setMounted]                       = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(OLD_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<BonusInputs> & {
          level?: string; lastYearBonus?: number;
          lastYearBaseSalary?: number; lastYearCollections?: number;
        };
        const { level: savedLevel, lastYearBonus: savedLYB, lastYearBaseSalary: savedLYBS, lastYearCollections: savedLYC, weeksRemaining: _wr, ...savedInputs } = parsed;
        setInputs((prev) => ({ ...prev, ...savedInputs }));
        if (savedLevel) setLevel(savedLevel);
        if (savedLYB)   setLastYearBonus(savedLYB);
        if (savedLYBS)  setLastYearBaseSalary(savedLYBS);
        if (savedLYC)   setLastYearCollections(savedLYC);
        if (!localStorage.getItem(STORAGE_KEY)) localStorage.setItem(STORAGE_KEY, raw);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...inputs, level, lastYearBonus, lastYearBaseSalary, lastYearCollections,
      }));
    }, 500);
  }, [inputs, level, lastYearBonus, lastYearBaseSalary, lastYearCollections, mounted]);

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

  const results        = calculateBonus(inputs);
  const weeksCompleted = 52 - inputs.weeksRemaining;
  const fiscalPct      = Math.min(100, (weeksCompleted / 52) * 100);
  const todayStr       = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── Dynamic FY label ──────────────────────────────────────────────────────
  const today = new Date();
  let fyEndDate = new Date(today.getFullYear(), 9, 31);
  if (today > fyEndDate) fyEndDate = new Date(today.getFullYear() + 1, 9, 31);
  const fyLabel = `FY${String(fyEndDate.getFullYear()).slice(-2)}`;

  // ── Stacked bar segments ──────────────────────────────────────────────────
  const productionSegments = [
    { label: 'Collections', value: inputs.currentCollections, color: BAR_COLLECTIONS },
    { label: 'AR',          value: inputs.currentAR,          color: BAR_AR          },
    { label: 'WIP',         value: inputs.currentWIP,         color: BAR_WIP         },
  ];
  const receivedTotal  = inputs.currentCollections + inputs.currentAR;
  const projectedExtra = Math.max(0, results.totalProjectedCollections - receivedTotal);
  const collectionsSegments = [
    { label: 'Received (collections + AR)', value: receivedTotal,  color: BAR_COLLECTIONS },
    { label: 'Projected',                   value: projectedExtra, color: BAR_PROJECTED   },
  ];

  // ── YoY: collections ─────────────────────────────────────────────────────
  let collectionsYoySub: React.ReactNode = null;
  if (lastYearCollections > 0) {
    const diff    = results.totalProjectedCollections - lastYearCollections;
    const diffPct = (diff / lastYearCollections) * 100;
    collectionsYoySub = diff >= 0 ? (
      <span className="text-emerald-400 flex items-center gap-1 text-xs mt-1.5">
        <TrendingUp className="h-3 w-3 shrink-0" />
        vs last year: +{fmtShort(diff)} (+{diffPct.toFixed(0)}%)
      </span>
    ) : (
      <span className="text-red-400 flex items-center gap-1 text-xs mt-1.5">
        <TrendingDown className="h-3 w-3 shrink-0" />
        vs last year: {fmtShort(diff)} ({diffPct.toFixed(0)}%)
      </span>
    );
  }

  // ── YoY: bonus (bonus % card) ─────────────────────────────────────────────
  let lastYearSub: React.ReactNode;
  if (lastYearBonus <= 0) {
    lastYearSub = <span className="text-muted-foreground/60">Enter last year&apos;s bonus to compare</span>;
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

  // ── YoY: total compensation (projected bonus card) ────────────────────────
  const thisYearTC = inputs.baseSalary + results.bonus;
  let tcYoySub: React.ReactNode = null;
  if (lastYearBonus > 0 && lastYearBaseSalary > 0) {
    const lastYearTC = lastYearBaseSalary + lastYearBonus;
    const diff       = thisYearTC - lastYearTC;
    const diffPct    = (diff / lastYearTC) * 100;
    tcYoySub = (
      <span className={`flex items-center gap-1 text-xs mt-1 ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
        {diff >= 0 ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
        TC vs LY: {diff >= 0 ? '+' : ''}{fmtShort(diff)} ({diffPct >= 0 ? '+' : ''}{diffPct.toFixed(0)}%)
      </span>
    );
  }

  // ── Gap to target bonus ───────────────────────────────────────────────────
  const gap100  = results.collectionsGapTo100;
  const util100 = results.utilNeededFor100;

  // ── Export PDF ────────────────────────────────────────────────────────────
  const handleExportPDF = () => {
    const html = generatePrintHTML(inputs, results, lastYearBaseSalary, lastYearBonus, lastYearCollections, todayStr);
    const win  = window.open('', '_blank');
    if (!win) return;
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); }, 500);
  };

  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="border-b border-white/[0.06] px-6 py-3.5 no-print sticky top-0 z-40 backdrop-blur-sm bg-background/80">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-[#2E75B6]/20 flex items-center justify-center">
              <TrendingUp className="h-4 w-4 text-[#4472C4]" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground tracking-tight">Bonus Dashboard</h1>
              <p className="text-xs text-muted-foreground hidden sm:block">Fiscal year ends October 31 · Auto-saved</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setInputs(defaultInputs());
                setLevel(DEFAULT_LEVEL);
                setLastYearBonus(0);
                setLastYearBaseSalary(0);
                setLastYearCollections(0);
                localStorage.removeItem(STORAGE_KEY);
              }}
              className="text-xs px-3 py-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/[0.06] transition-all duration-150 cursor-pointer"
            >
              Reset
            </button>
            <button
              onClick={handleExportPDF}
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
          <MetricCard title="Total production today" rawValue={results.totalPipeline} format={fmtShort} icon={Layers} animDelay={0}>
            <StackedBar segments={productionSegments} />
          </MetricCard>

          {/* 2. Total projected collections */}
          <MetricCard title="Total projected collections" rawValue={results.totalProjectedCollections} format={fmtShort} icon={DollarSign} animDelay={60}>
            <StackedBar segments={collectionsSegments} />
            {collectionsYoySub}
          </MetricCard>

          {/* 3. Projected bonus */}
          <MetricCard
            title="Projected bonus"
            rawValue={results.bonus}
            format={fmtShort}
            sub={`Total comp: ${fmtShort(thisYearTC)}`}
            icon={TrendingUp}
            accentColor={results.bonus > 0 ? '#34D399' : '#F87171'}
            isPositive={results.bonus > 0}
            animDelay={120}
          >
            {tcYoySub}
          </MetricCard>

          {/* 4. Bonus % of base salary */}
          <MetricCard title="Bonus % of base salary" rawValue={results.bonusPct} format={fmtPct} icon={Percent} accentColor={results.bonusPct > 50 ? '#34D399' : '#F1F5F9'} animDelay={180}>
            {(lastYearBonus > 0 && lastYearBaseSalary > 0) ? (
              <>
                <p className="text-[13px] text-muted-foreground mt-2 tabular-nums">
                  Last year: {((lastYearBonus / lastYearBaseSalary) * 100).toFixed(1)}%
                </p>
                <p className="text-xs mt-1 flex items-center gap-1 flex-wrap">{lastYearSub}</p>
              </>
            ) : (
              <p className="text-xs mt-2 flex items-center gap-1 flex-wrap">{lastYearSub}</p>
            )}
          </MetricCard>

          {/* 5. Gap to target bonus + breakeven */}
          <div
            className={`${card} p-5 hover:-translate-y-0.5 hover:border-white/[0.12] transition-all duration-150 animate-fade-up`}
            style={{ animationDelay: '240ms' }}
          >
            <div className="flex items-start justify-between mb-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Gap to target bonus</p>
                <p className="text-[10px] text-muted-foreground/50 mt-0.5 leading-snug">Additional collections needed for bonus = base salary</p>
              </div>
              <div className="rounded-lg bg-white/[0.05] p-1.5 shrink-0 ml-2">
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
            {/* Breakeven utilization — embedded secondary metric */}
            {(() => {
              const bu = results.breakevenUtil;
              const bCovered      = bu <= 0;
              const bUnachievable = !isFinite(bu) || bu > 200;
              const bAbove        = !bCovered && !bUnachievable && bu <= inputs.projectedUtilization;
              const bColor        = bCovered || bAbove ? 'text-emerald-400' : bUnachievable ? 'text-red-400' : 'text-amber-400';
              return (
                <div className="mt-3 pt-3 border-t border-white/[0.08]">
                  <p className="text-[10px] text-muted-foreground mb-1">Breakeven utilization</p>
                  {bCovered ? (
                    <p className={`text-xs font-semibold ${bColor}`}>Already covered by pipeline</p>
                  ) : bUnachievable ? (
                    <p className={`text-xs font-semibold ${bColor}`}>Not achievable this year</p>
                  ) : (
                    <>
                      <p className={`text-sm font-bold font-mono tabular-nums ${bColor}`}>{bu.toFixed(1)}%</p>
                      <p className="text-[10px] text-muted-foreground/60 mt-0.5">Min utilization for any bonus</p>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        </section>

        {/* ── Inputs (horizontal compact) ────────────────────────────────── */}
        <div className={`${card} p-5 no-print`}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-foreground">Inputs</h2>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="text-[#4472C4] font-mono tabular-nums font-medium">{fiscalPct.toFixed(0)}%</span>
              <span>of {fyLabel} elapsed · {inputs.weeksRemaining} wks remaining</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '3fr 4fr 3fr', gap: '0' }}>

            {/* Group 1: Current production */}
            <div className="pr-5 border-r border-white/[0.06]">
              <p className={`${sectionLabel} mb-2`}>Current production</p>
              <div className="flex gap-2">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Collections" value={inputs.currentCollections} onChange={update('currentCollections')} prefix="$" suffix="K" scale={1000} placeholder="500" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Accounts receivable" value={inputs.currentAR} onChange={update('currentAR')} prefix="$" suffix="K" scale={1000} placeholder="150" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="WIP" value={inputs.currentWIP} onChange={update('currentWIP')} prefix="$" suffix="K" scale={1000} placeholder="75" />
                </div>
              </div>
            </div>

            {/* Group 2: Projections */}
            <div className="px-5 border-r border-white/[0.06]">
              <p className={`${sectionLabel} mb-2`}>Projections</p>
              <div className="flex gap-2">
                <div style={{ flex: 2, minWidth: 0 }}>
                  <LevelSelect level={level} onLevelChange={handleLevelChange} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Projected utilization" value={inputs.projectedUtilization} onChange={update('projectedUtilization')} suffix="%" placeholder="80" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Current WIP realization" value={inputs.currentWipRealizationRate} onChange={update('currentWipRealizationRate')} suffix="%" placeholder="85" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Future WIP realization" value={inputs.futureWipRealizationRate} onChange={update('futureWipRealizationRate')} suffix="%" placeholder="50" />
                </div>
              </div>
            </div>

            {/* Group 3: Compensation */}
            <div className="pl-5">
              <p className={`${sectionLabel} mb-2`}>Compensation</p>
              <div className="flex gap-2">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Base salary" value={inputs.baseSalary} onChange={update('baseSalary')} prefix="$" suffix="K" scale={1000} placeholder="200" />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TextInput labelText="Performance multiple" value={inputs.performanceMultiple} onChange={update('performanceMultiple')} suffix="%" placeholder="50" />
                </div>
              </div>
            </div>

          </div>

          {/* ── Last Year Inputs (accordion within Inputs card) ────────── */}
          <div className="mt-4 pt-4 border-t border-white/[0.06] no-print">
            <button
              onClick={() => setCollapsiblesOpen((o) => !o)}
              className="w-full flex items-center justify-between cursor-pointer hover:opacity-80 transition-opacity"
            >
              <span className={`${sectionLabel}`}>Last year&apos;s inputs</span>
              {collapsiblesOpen
                ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </button>
            {collapsiblesOpen && (
              <div className="mt-3">
                <LastYearInputs
                  lastYearBaseSalary={lastYearBaseSalary}
                  lastYearBonus={lastYearBonus}
                  lastYearCollections={lastYearCollections}
                  setLastYearBaseSalary={setLastYearBaseSalary}
                  setLastYearBonus={setLastYearBonus}
                  setLastYearCollections={setLastYearCollections}
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Chart + Sensitivity side-by-side ───────────────────────────── */}
        <div className="grid grid-cols-2 gap-5 items-stretch" style={{ minHeight: '420px' }}>
          <ProductionChart inputs={inputs} totalProjectedCollections={results.totalProjectedCollections} />

          <div className={`${card} p-5 no-print h-full`}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">Sensitivity analysis</h2>
              <div className="text-xs text-muted-foreground space-y-0.5">
                <div>Bonus at varying performance multiples × projected utilization</div>
                <div>
                  <span className="text-red-400">red = $0 bonus</span>
                  {' · '}
                  <span className="text-[#4472C4]">blue = positive (darker = larger)</span>
                  {' · '}
                  <span className="text-[#2E75B6]">outline = current inputs</span>
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

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Slider } from '@/components/ui/slider';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  calculateBonus, calcWeeksRemaining, calcBonusAt,
  type BonusInputs,
} from '@/lib/calculations';
import {
  DollarSign, TrendingUp, Percent, Layers, Printer,
  TrendingDown, ChevronDown,
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

const SENSITIVITY_PERFS = [25, 50, 75, 100];
const SENSITIVITY_UTILS = [50, 60, 70, 80, 90, 100, 120];
const STORAGE_KEY = 'bonusDashboardSettings';

// Chart colors — kept from original spec
const CHART_BLUE       = '#3266ad';
const CHART_BLUE_FILL  = 'rgba(50, 102, 173, 0.22)';
const CHART_GREEN      = '#4a9e2a';   // lightened slightly for dark bg visibility
const CHART_GREEN_FILL = 'rgba(74, 158, 42, 0.18)';

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return fmtCurrency(v);
};

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

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
    if (reduced) { setValue(target); prevRef.current = target; return; }
    const from = prevRef.current;
    const to   = target;
    const startTime = performance.now();

    const tick = (now: number) => {
      const p = Math.min((now - startTime) / duration, 1);
      const e = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setValue(from + (to - from) * e);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        prevRef.current = to;
      }
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
  pipelineAbove: number;
}

function generatePipelineChartData(inputs: BonusInputs): ChartPoint[] {
  const {
    currentCollections, currentAR, currentWIP, billRate, projectedUtilization,
    currentWipRealizationRate, futureWipRealizationRate, weeksRemaining,
  } = inputs;
  const WEEKLY_NEW_WIP = billRate * (projectedUtilization / 100) * 40;
  const MS_PER_WEEK    = 7 * 24 * 60 * 60 * 1000;
  const today = new Date();
  const fyEnd = new Date(today.getFullYear(), 9, 31);
  const totalMs = Math.max(0, fyEnd.getTime() - today.getTime());

  if (totalMs === 0) return [{ label: 'Oct', collections: currentCollections, pipelineAbove: currentWIP }];

  const dates: { date: Date; label: string }[] = [];
  dates.push({ date: today, label: today.toLocaleString('en-US', { month: 'short' }) });
  const cursor = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  while (cursor < fyEnd) {
    dates.push({ date: new Date(cursor), label: cursor.toLocaleString('en-US', { month: 'short' }) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  if (dates[dates.length - 1].label !== 'Oct') dates.push({ date: fyEnd, label: 'Oct' });

  const totalWeeks = totalMs / MS_PER_WEEK;
  return dates.map(({ date, label }) => {
    const weeksFromNow      = Math.max(0, (date.getTime() - today.getTime()) / MS_PER_WEEK);
    const t                 = totalWeeks > 0 ? weeksFromNow / totalWeeks : 0;
    const newWipAccumulated = WEEKLY_NEW_WIP * weeksFromNow;
    const collections = currentCollections + currentAR
      + (currentWIP  * (currentWipRealizationRate / 100)) * t
      + (newWipAccumulated * (futureWipRealizationRate  / 100)) * t;
    const pipeline = currentCollections + currentAR + currentWIP + newWipAccumulated;
    return { label, collections, pipelineAbove: Math.max(0, pipeline - collections) };
  });
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

const card  = 'bg-[#0F1629] border border-white/[0.07] rounded-2xl';
const input = 'h-10 w-full rounded-xl border border-white/[0.10] bg-white/[0.04] px-3 text-sm font-mono tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-150 cursor-text';
const label = 'block text-xs font-medium text-muted-foreground mb-1';
const sectionDivider = 'flex items-center gap-3 mb-4';
const sectionLabel = 'text-xs font-semibold text-blue-400/80 tracking-wide shrink-0';
const dividerLine = 'flex-1 h-px bg-white/[0.06]';

// ─── TextInput ────────────────────────────────────────────────────────────────

function TextInput({
  labelText, value, onChange, prefix, suffix, decimals = 0, placeholder, description, scale = 1,
}: {
  labelText: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number;
  placeholder?: string; description?: string; scale?: number;
}) {
  const [raw, setRaw] = useState((value / scale).toFixed(decimals));
  useEffect(() => { setRaw((value / scale).toFixed(decimals)); }, [value, decimals, scale]);

  const commit = () => {
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (!isNaN(parsed) && parsed >= 0) { onChange(parsed * scale); setRaw(parsed.toFixed(decimals)); }
    else setRaw((value / scale).toFixed(decimals));
  };

  return (
    <div className="space-y-1">
      <label className={label}>{labelText}</label>
      <div className="flex items-center gap-1.5">
        {prefix && <span className="text-xs text-muted-foreground font-mono shrink-0">{prefix}</span>}
        <input
          type="text" value={raw} placeholder={placeholder}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className={input}
        />
        {suffix && <span className="text-xs text-muted-foreground shrink-0">{suffix}</span>}
      </div>
      {description && <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>}
    </div>
  );
}

// ─── SliderInput ──────────────────────────────────────────────────────────────

function SliderInput({
  labelText, value, onChange, min, max, step, suffix, description,
}: {
  labelText: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; description?: string;
}) {
  const [raw, setRaw] = useState(String(value));
  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = () => {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) { const c = Math.min(max, Math.max(min, parsed)); onChange(c); setRaw(String(c)); }
    else setRaw(String(value));
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className={label}>{labelText}</label>
        <div className="flex items-center gap-1">
          <input
            type="text" value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-14 h-7 text-right rounded-lg border border-white/[0.10] bg-white/[0.04] px-2 text-xs font-mono tabular-nums text-foreground focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all duration-150 cursor-text"
          />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="cursor-pointer" />
      {description && <p className="text-xs text-muted-foreground/70 mt-0.5">{description}</p>}
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
    <div className="space-y-1">
      <label className={label}>Level</label>
      <div className="relative">
        <select
          value={level}
          onChange={(e) => {
            const l = LEVELS.find((x) => x.name === e.target.value);
            if (l) onLevelChange(l.name, l.rate);
          }}
          className={`${input} appearance-none pr-8 cursor-pointer`}
        >
          {LEVELS.map((l) => <option key={l.name} value={l.name} className="bg-[#0F1629]">{l.name}</option>)}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
      </div>
      <p className="text-xs text-muted-foreground/70">
        Bill rate: <span className="font-mono font-semibold text-blue-400">${selected.rate}/hr</span>
      </p>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  title, rawValue, format, sub, icon: Icon, accentColor, animDelay = 0, isPositive,
}: {
  title: string;
  rawValue: number;
  format: (v: number) => string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accentColor?: string;
  animDelay?: number;
  isPositive?: boolean;
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
      <p
        className="text-3xl font-bold tabular-nums tracking-tight leading-none"
        style={{ color: accentColor ?? '#F1F5F9' }}
      >
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

  const closestPerf = SENSITIVITY_PERFS.reduce((p, c) =>
    Math.abs(c - performanceMultiple) < Math.abs(p - performanceMultiple) ? c : p
  );
  const closestUtil = SENSITIVITY_UTILS.reduce((p, c) =>
    Math.abs(c - projectedUtilization) < Math.abs(p - projectedUtilization) ? c : p
  );

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow className="border-white/[0.06] hover:bg-transparent">
            <TableHead className="text-center text-xs font-semibold text-muted-foreground w-14">Perf %</TableHead>
            {SENSITIVITY_UTILS.map((u) => (
              <TableHead key={u} className={`text-center text-xs ${u === closestUtil ? 'text-blue-400 font-bold' : 'text-muted-foreground'}`}>
                {u}%
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SENSITIVITY_PERFS.map((perf) => (
            <TableRow key={perf} className="border-white/[0.04] hover:bg-white/[0.02]">
              <TableCell className={`text-center text-xs font-semibold py-2 ${perf === closestPerf ? 'text-blue-400' : 'text-muted-foreground'}`}>
                {perf}%
              </TableCell>
              {SENSITIVITY_UTILS.map((util) => {
                const bonus = calcBonusAt(
                  currentCollections, currentAR, currentWIP,
                  billRate, util, baseSalary, perf, weeksRemaining,
                  currentWipRealizationRate, futureWipRealizationRate,
                );
                const isHighlight = perf === closestPerf && util === closestUtil;
                const projNewWIP  = billRate * (util / 100) * 40 * weeksRemaining;
                const fromCur     = currentWIP * (currentWipRealizationRate / 100);
                const fromFut     = projNewWIP * (futureWipRealizationRate / 100);
                const total       = currentCollections + currentAR + fromCur + fromFut;
                const tooltip     = `Util ${util}% × Perf ${perf}%\nProjected new WIP: ${fmtShort(projNewWIP)}\nFrom current WIP: ${fmtShort(fromCur)}\nFrom future WIP: ${fmtShort(fromFut)}\nTotal projected: ${fmtShort(total)}\nBonus: ${fmtCurrency(bonus)}`;

                let cellBg   = '';
                let cellText = 'text-foreground/80';
                if (bonus <= 0) { cellBg = 'bg-red-950/40';   cellText = 'text-red-400'; }
                else if (bonus > 0.5 * baseSalary) { cellBg = 'bg-emerald-950/40'; cellText = 'text-emerald-400'; }

                return (
                  <TableCell
                    key={util}
                    title={tooltip}
                    className={`text-center font-mono text-xs py-2 cursor-default transition-colors duration-100 hover:bg-white/[0.05] ${cellBg} ${cellText} ${isHighlight ? 'animate-pulse-ring font-bold rounded-sm' : ''}`}
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
  );
}

// ─── FormulaBreakdown ─────────────────────────────────────────────────────────

function FormulaBreakdown({ inputs, results }: {
  inputs: BonusInputs;
  results: ReturnType<typeof calculateBonus>;
}) {
  const rows = [
    { label: 'Current collections',                   note: 'Cash received this fiscal year',                                                                          value: fmtCurrency(inputs.currentCollections),                         bold: false, accent: '' },
    { label: '+ Current AR (100%)',                    note: 'Invoiced, not yet collected',                                                                             value: `+ ${fmtCurrency(inputs.currentAR)}`,                           bold: false, accent: '' },
    { label: '+ Current WIP × current realization',   note: `${fmtCurrency(inputs.currentWIP)} × ${inputs.currentWipRealizationRate}%`,                               value: `+ ${fmtCurrency(results.projectedCollectionsFromCurrentWIP)}`, bold: false, accent: '' },
    { label: '+ Projected WIP × future realization',  note: `$${inputs.billRate}/hr × ${inputs.projectedUtilization}% × 40 hrs × ${Math.round(inputs.weeksRemaining)} wks × ${inputs.futureWipRealizationRate}%`, value: `+ ${fmtCurrency(results.projectedCollectionsFromFutureWIP)}`,  bold: false, accent: '' },
    { label: '= Total projected collections',         note: '',                                                                                                        value: fmtCurrency(results.totalProjectedCollections),                 bold: true,  accent: '' },
    { label: '× Performance multiple',                note: `${inputs.performanceMultiple}%`,                                                                          value: `× ${inputs.performanceMultiple}%`,                             bold: false, accent: '' },
    { label: '− Base salary',                         note: '',                                                                                                        value: `− ${fmtCurrency(inputs.baseSalary)}`,                          bold: false, accent: '' },
    { label: '= Bonus',                               note: `${fmtPct(results.bonusPct)} of base salary`,                                                             value: fmtCurrency(results.bonus),                                     bold: true,  accent: results.bonus > 0 ? 'text-emerald-400' : 'text-red-400' },
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

// ─── Pipeline Chart ───────────────────────────────────────────────────────────

function PipelineTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const collections   = payload.find((p) => p.dataKey === 'collections')?.value ?? 0;
  const pipelineAbove = payload.find((p) => p.dataKey === 'pipelineAbove')?.value ?? 0;
  return (
    <div className="bg-[#131D35] border border-white/[0.10] rounded-xl shadow-xl px-3 py-2.5 text-xs space-y-1">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      <p style={{ color: '#60A5FA' }}>Collections: {fmtCurrency(collections)}</p>
      <p style={{ color: '#86EFAC' }}>Pipeline: {fmtCurrency(collections + pipelineAbove)}</p>
    </div>
  );
}

function PipelineChart({ inputs }: { inputs: BonusInputs }) {
  const data = generatePipelineChartData(inputs);
  return (
    <div className={`${card} p-5`}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-foreground">Pipeline trajectory</h2>
        <div className="flex gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: CHART_BLUE }} />
            <span>Collections</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-0.5 rounded-full" style={{ background: CHART_GREEN }} />
            <span>WIP above collections</span>
          </div>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gradBlue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_BLUE}  stopOpacity={0.35} />
              <stop offset="100%" stopColor={CHART_BLUE}  stopOpacity={0.05} />
            </linearGradient>
            <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={CHART_GREEN} stopOpacity={0.30} />
              <stop offset="100%" stopColor={CHART_GREEN} stopOpacity={0.04} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748B' }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10, fill: '#64748B' }} width={76} axisLine={false} tickLine={false} />
          <Tooltip content={<PipelineTooltip />} />
          <Area type="monotone" dataKey="collections" stackId="p" stroke={CHART_BLUE}  strokeWidth={2} fill="url(#gradBlue)"  animationDuration={800} animationEasing="ease-out" />
          <Area type="monotone" dataKey="pipelineAbove" stackId="p" stroke={CHART_GREEN} strokeWidth={2} fill="url(#gradGreen)" animationDuration={800} animationEasing="ease-out" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [inputs, setInputs] = useState<BonusInputs>(defaultInputs);
  const [level,  setLevel]  = useState(DEFAULT_LEVEL);
  const [mounted, setMounted] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<BonusInputs> & { level?: string };
        const { level: savedLevel, ...savedInputs } = parsed;
        setInputs((prev) => ({ ...prev, ...savedInputs }));
        if (savedLevel) setLevel(savedLevel);
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...inputs, level }));
    }, 500);
  }, [inputs, level, mounted]);

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

  const results = calculateBonus(inputs);
  const weeksCompleted = 52 - inputs.weeksRemaining;
  const fiscalPct = Math.min(100, (weeksCompleted / 52) * 100);

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
              onClick={() => { setInputs(defaultInputs()); setLevel(DEFAULT_LEVEL); localStorage.removeItem(STORAGE_KEY); }}
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

        {/* ── Metric Cards ───────────────────────────────────────────────── */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            title="Total pipeline today"
            rawValue={results.totalPipeline}
            format={fmtShort}
            sub="Collections + AR + WIP"
            icon={Layers}
            animDelay={0}
          />
          <MetricCard
            title="Total projected collections"
            rawValue={results.totalProjectedCollections}
            format={fmtShort}
            sub={`${fmtShort(inputs.currentCollections)} received + ${fmtShort(results.totalProjectedCollections - inputs.currentCollections)} projected`}
            icon={DollarSign}
            animDelay={80}
          />
          <MetricCard
            title="Projected bonus"
            rawValue={results.bonus}
            format={fmtShort}
            sub={results.bonus > 0 ? 'Above threshold' : 'Below threshold'}
            icon={TrendingUp}
            accentColor={results.bonus > 0 ? '#34D399' : '#F87171'}
            isPositive={results.bonus > 0}
            animDelay={160}
          />
          <MetricCard
            title="Bonus % of base salary"
            rawValue={results.bonusPct}
            format={fmtPct}
            sub={`Base: ${fmtShort(inputs.baseSalary)}`}
            icon={Percent}
            accentColor={results.bonusPct > 50 ? '#34D399' : '#F1F5F9'}
            animDelay={240}
          />
        </section>

        {/* ── Pipeline Chart ─────────────────────────────────────────────── */}
        <PipelineChart inputs={inputs} />

        {/* ── Inputs + Sensitivity side-by-side ──────────────────────────── */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[400px_1fr]">

          {/* Inputs panel */}
          <div className={`${card} p-5 no-print space-y-5`}>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Inputs</h2>
              {/* FY progress bar */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="text-blue-400 font-mono tabular-nums font-medium">{fiscalPct.toFixed(0)}%</span>
                <span>of FY elapsed</span>
              </div>
            </div>

            {/* FY progress bar */}
            <div className="space-y-1">
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${fiscalPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground/60">
                <span>Nov 1</span>
                <span>{Math.round(inputs.weeksRemaining)} wks remaining</span>
                <span>Oct 31</span>
              </div>
            </div>

            {/* Current pipeline */}
            <div>
              <div className={sectionDivider}>
                <p className={sectionLabel}>Current pipeline</p>
                <div className={dividerLine} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <TextInput labelText="Collections" value={inputs.currentCollections} onChange={update('currentCollections')} prefix="$" suffix="K" scale={1000} placeholder="500" description="Cash received" />
                <TextInput labelText="Accounts receivable" value={inputs.currentAR} onChange={update('currentAR')} prefix="$" suffix="K" scale={1000} placeholder="150" description="Invoiced, unpaid" />
                <TextInput labelText="WIP" value={inputs.currentWIP} onChange={update('currentWIP')} prefix="$" suffix="K" scale={1000} placeholder="75" description="Worked, not invoiced" />
              </div>
            </div>

            {/* Projections */}
            <div>
              <div className={sectionDivider}>
                <p className={sectionLabel}>Projections</p>
                <div className={dividerLine} />
              </div>
              <div className="space-y-4">
                <LevelSelect level={level} onLevelChange={handleLevelChange} />
                <SliderInput labelText="Projected utilization" value={inputs.projectedUtilization} onChange={update('projectedUtilization')} min={0} max={200} step={1} suffix="%" description="Assumes 40 hrs/week" />
                <div className="grid grid-cols-2 gap-3">
                  <TextInput labelText="Current WIP realization" value={inputs.currentWipRealizationRate} onChange={update('currentWipRealizationRate')} suffix="%" placeholder="85" description="Existing WIP → collections" />
                  <TextInput labelText="Future WIP realization" value={inputs.futureWipRealizationRate} onChange={update('futureWipRealizationRate')} suffix="%" placeholder="50" description="New WIP → collections" />
                </div>
                <TextInput labelText="Weeks remaining" value={inputs.weeksRemaining} onChange={update('weeksRemaining')} suffix=" wks" decimals={0} placeholder="28" description="Auto-calculated from today → Oct 31" />
              </div>
            </div>

            {/* Compensation */}
            <div>
              <div className={sectionDivider}>
                <p className={sectionLabel}>Compensation</p>
                <div className={dividerLine} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TextInput labelText="Base salary" value={inputs.baseSalary} onChange={update('baseSalary')} prefix="$" suffix="K" scale={1000} placeholder="200" />
                <TextInput labelText="Performance multiple" value={inputs.performanceMultiple} onChange={update('performanceMultiple')} suffix="%" placeholder="50" />
              </div>
            </div>
          </div>

          {/* Sensitivity table */}
          <div className={`${card} p-5 no-print`}>
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground mb-1">Sensitivity analysis</h2>
              <p className="text-xs text-muted-foreground">
                Bonus at varying performance multiples × projected utilization ·{' '}
                <span className="text-red-400">red = $0</span> ·{' '}
                <span className="text-emerald-400">green = &gt;50% of salary</span> ·{' '}
                <span className="text-blue-400">blue = current inputs</span>
              </p>
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

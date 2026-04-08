'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  calculateBonus, calcWeeksRemaining, calcBonusAt,
  type BonusInputs,
} from '@/lib/calculations';
import { DollarSign, TrendingUp, Percent, Layers, Printer } from 'lucide-react';

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

// ─── Formatters ───────────────────────────────────────────────────────────────

const fmtCurrency = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(v);

const fmtShort = (v: number) => {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return fmtCurrency(v);
};

const fmtPct = (v: number) => `${v.toFixed(1)}%`;

// ─── Pipeline Chart ───────────────────────────────────────────────────────────

const CHART_BLUE       = '#3266ad';
const CHART_BLUE_FILL  = 'rgba(50, 102, 173, 0.18)';
const CHART_GREEN      = '#3B6D11';
const CHART_GREEN_FILL = 'rgba(59, 109, 17, 0.15)';

interface ChartPoint {
  label: string;
  collections: number;
  pipelineAbove: number; // pipeline − collections (stacked on top)
}

function generatePipelineChartData(inputs: BonusInputs): ChartPoint[] {
  const { currentCollections, currentWIP, billRate, projectedUtilization, wipRealizationRate, weeksRemaining } = inputs;
  const WEEKLY_NEW_WIP = billRate * (projectedUtilization / 100) * 40;
  const MS_PER_WEEK    = 7 * 24 * 60 * 60 * 1000;

  const today = new Date();
  const yr    = today.getFullYear();
  const fyEnd = new Date(yr, 9, 31); // Oct 31
  const totalMs = Math.max(0, fyEnd.getTime() - today.getTime());

  if (totalMs === 0) {
    return [{ label: 'Oct', collections: currentCollections, pipelineAbove: currentWIP }];
  }

  // Build the date points: today, then 1st of each subsequent month, then Oct 31
  const dates: { date: Date; label: string }[] = [];

  dates.push({ date: today, label: today.toLocaleString('en-US', { month: 'short' }) });

  const cursor = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  while (cursor < fyEnd) {
    dates.push({ date: new Date(cursor), label: cursor.toLocaleString('en-US', { month: 'short' }) });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  // Always include Oct 31 unless the last point is already Oct
  const last = dates[dates.length - 1];
  if (last.label !== 'Oct') {
    dates.push({ date: fyEnd, label: 'Oct' });
  }

  const totalWeeks = totalMs / MS_PER_WEEK;

  return dates.map(({ date, label }) => {
    const weeksFromNow     = Math.max(0, (date.getTime() - today.getTime()) / MS_PER_WEEK);
    const t                = totalWeeks > 0 ? weeksFromNow / totalWeeks : 0;
    const newWipAccumulated = WEEKLY_NEW_WIP * weeksFromNow;

    const collections  = currentCollections
      + (currentWIP * (wipRealizationRate / 100) + newWipAccumulated * (wipRealizationRate / 100)) * t;
    const pipeline     = currentCollections + currentWIP + newWipAccumulated;

    return { label, collections, pipelineAbove: Math.max(0, pipeline - collections) };
  });
}

function PipelineTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  const collections   = payload.find((p) => p.dataKey === 'collections')?.value ?? 0;
  const pipelineAbove = payload.find((p) => p.dataKey === 'pipelineAbove')?.value ?? 0;
  return (
    <div className="bg-white border border-border rounded shadow-sm px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-foreground">{label}</p>
      <p style={{ color: CHART_BLUE }}>Collections: {fmtCurrency(collections)}</p>
      <p style={{ color: CHART_GREEN }}>Pipeline: {fmtCurrency(collections + pipelineAbove)}</p>
    </div>
  );
}

function PipelineChart({ inputs }: { inputs: BonusInputs }) {
  const data = generatePipelineChartData(inputs);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Pipeline Trajectory</CardTitle>
        {/* Custom legend */}
        <div className="flex gap-5 text-xs text-muted-foreground pt-1">
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CHART_BLUE }} />
            Collections
          </div>
          <div className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm" style={{ background: CHART_GREEN }} />
            WIP pipeline above collections
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10 }} width={76} />
            <Tooltip content={<PipelineTooltip />} />
            {/* Blue area: 0 → collections */}
            <Area
              type="monotone"
              dataKey="collections"
              stackId="pipeline"
              stroke={CHART_BLUE}
              strokeWidth={2}
              fill={CHART_BLUE_FILL}
            />
            {/* Green area: collections → pipeline (stacked on top) */}
            <Area
              type="monotone"
              dataKey="pipelineAbove"
              stackId="pipeline"
              stroke={CHART_GREEN}
              strokeWidth={2}
              fill={CHART_GREEN_FILL}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

const DEFAULT_LEVEL = 'Manager';

function defaultInputs(): BonusInputs {
  return {
    currentCollections:   500_000,
    currentAR:            150_000,
    currentWIP:            75_000,
    billRate:               650,    // Manager
    projectedUtilization:   80,
    wipRealizationRate:     85,
    baseSalary:           200_000,
    performanceMultiple:    50,
    weeksRemaining:       calcWeeksRemaining(),
  };
}

// ─── TextInput ────────────────────────────────────────────────────────────────

function TextInput({
  label, value, onChange, prefix, suffix, decimals = 0, placeholder, description, scale = 1,
}: {
  label: string; value: number; onChange: (v: number) => void;
  prefix?: string; suffix?: string; decimals?: number;
  placeholder?: string; description?: string; scale?: number;
}) {
  const [raw, setRaw] = useState((value / scale).toFixed(decimals));

  useEffect(() => { setRaw((value / scale).toFixed(decimals)); }, [value, decimals, scale]);

  const commit = () => {
    const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ''));
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed * scale);
      setRaw(parsed.toFixed(decimals));
    } else {
      setRaw((value / scale).toFixed(decimals));
    }
  };

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">{label}</label>
      <div className="flex items-center gap-1.5">
        {prefix && <span className="text-sm text-muted-foreground font-mono shrink-0">{prefix}</span>}
        <input
          type="text"
          value={raw}
          placeholder={placeholder}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          className="w-full rounded border border-border bg-white px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {suffix && <span className="text-sm text-muted-foreground shrink-0">{suffix}</span>}
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// ─── SliderInput ──────────────────────────────────────────────────────────────

function SliderInput({
  label, value, onChange, min, max, step, suffix, description,
}: {
  label: string; value: number; onChange: (v: number) => void;
  min: number; max: number; step: number; suffix?: string; description?: string;
}) {
  const [raw, setRaw] = useState(String(value));

  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = () => {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
      setRaw(String(clamped));
    } else {
      setRaw(String(value));
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="w-16 text-right rounded border border-border bg-white px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {suffix && <span className="text-xs text-muted-foreground">{suffix}</span>}
        </div>
      </div>
      <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} />
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

// ─── LevelSelect ──────────────────────────────────────────────────────────────

function LevelSelect({
  level, onLevelChange,
}: {
  level: string;
  onLevelChange: (name: string, rate: number) => void;
}) {
  const selected = LEVELS.find((l) => l.name === level) ?? LEVELS[4];

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-foreground">Level</label>
      <select
        value={level}
        onChange={(e) => {
          const l = LEVELS.find((x) => x.name === e.target.value);
          if (l) onLevelChange(l.name, l.rate);
        }}
        className="w-full rounded border border-border bg-white px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {LEVELS.map((l) => (
          <option key={l.name} value={l.name}>{l.name}</option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Bill rate: <span className="font-mono font-semibold text-foreground">${selected.rate}/hr</span>
      </p>
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  title, value, sub, icon: Icon, accent,
}: {
  title: string; value: string; sub?: string;
  icon: React.ComponentType<{ className?: string }>; accent?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">{title}</p>
            <p className={`text-2xl font-bold ${accent ?? 'text-foreground'}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
          </div>
          <div className="rounded-lg bg-secondary p-2">
            <Icon className="h-5 w-5 text-muted-foreground" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── FormulaBreakdown ─────────────────────────────────────────────────────────

function FormulaBreakdown({
  inputs, results,
}: {
  inputs: BonusInputs;
  results: ReturnType<typeof calculateBonus>;
}) {
  const currentWIPRealized = inputs.currentWIP * (inputs.wipRealizationRate / 100);
  const projectedWIPRealized = results.projectedNewWIP * (inputs.wipRealizationRate / 100);

  const rows: { label: string; note: string; value: string; bold: boolean; accent: string }[] = [
    {
      label: 'Current Collections',
      note: 'Cash received this fiscal year',
      value: fmtCurrency(inputs.currentCollections),
      bold: false, accent: '',
    },
    {
      label: '+ Current AR (converts at 100%)',
      note: 'Invoiced but not yet collected',
      value: `+ ${fmtCurrency(inputs.currentAR)}`,
      bold: false, accent: '',
    },
    {
      label: `+ Current WIP × realization rate`,
      note: `${fmtCurrency(inputs.currentWIP)} × ${inputs.wipRealizationRate}%`,
      value: `+ ${fmtCurrency(currentWIPRealized)}`,
      bold: false, accent: '',
    },
    {
      label: '+ Projected WIP × realization rate',
      note: `$${inputs.billRate}/hr × ${inputs.projectedUtilization}% × 40 hrs × ${Math.round(inputs.weeksRemaining)} wks × ${inputs.wipRealizationRate}%`,
      value: `+ ${fmtCurrency(projectedWIPRealized)}`,
      bold: false, accent: '',
    },
    {
      label: '= Total Projected Collections',
      note: '',
      value: fmtCurrency(results.totalProjectedCollections),
      bold: true, accent: '',
    },
    {
      label: '× Performance Multiple',
      note: `${inputs.performanceMultiple}%`,
      value: `× ${inputs.performanceMultiple}%`,
      bold: false, accent: '',
    },
    {
      label: '− Base Salary',
      note: '',
      value: `− ${fmtCurrency(inputs.baseSalary)}`,
      bold: false, accent: '',
    },
    {
      label: '= Bonus',
      note: `${fmtPct(results.bonusPct)} of base salary`,
      value: fmtCurrency(results.bonus),
      bold: true,
      accent: results.bonus > 0 ? 'text-green-600' : 'text-red-500',
    },
  ];

  return (
    <div className="overflow-x-auto rounded border border-border">
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={`border-b border-border last:border-0 ${row.bold ? 'bg-secondary/60 font-semibold' : 'bg-white'}`}
            >
              <td className="py-3 px-4 text-foreground whitespace-nowrap">{row.label}</td>
              <td className="py-3 px-4 text-xs text-muted-foreground italic">{row.note}</td>
              <td className={`py-3 px-4 text-right font-mono whitespace-nowrap ${row.accent}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── SensitivityTable ─────────────────────────────────────────────────────────

function SensitivityTable({ inputs }: { inputs: BonusInputs }) {
  const {
    currentCollections, currentAR, currentWIP,
    billRate, baseSalary, weeksRemaining, wipRealizationRate,
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
          <TableRow>
            <TableHead className="text-center font-semibold w-16">Perf %</TableHead>
            {SENSITIVITY_UTILS.map((u) => (
              <TableHead
                key={u}
                className={`text-center text-xs ${u === closestUtil ? 'bg-blue-50 font-bold text-blue-700' : ''}`}
              >
                {u}%
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {SENSITIVITY_PERFS.map((perf) => (
            <TableRow key={perf}>
              <TableCell className={`text-center font-semibold text-sm ${perf === closestPerf ? 'bg-blue-50 text-blue-700' : ''}`}>
                {perf}%
              </TableCell>
              {SENSITIVITY_UTILS.map((util) => {
                const bonus = calcBonusAt(
                  currentCollections, currentAR, currentWIP,
                  billRate, util, baseSalary, perf, weeksRemaining, wipRealizationRate,
                );
                const isHighlight = perf === closestPerf && util === closestUtil;
                let bg = '', text = '';
                if (bonus <= 0) { bg = 'bg-red-50'; text = 'text-red-600'; }
                else if (bonus > 0.5 * baseSalary) { bg = 'bg-green-50'; text = 'text-green-700'; }
                return (
                  <TableCell
                    key={util}
                    className={`text-center font-mono text-xs py-2 ${bg} ${text} ${isHighlight ? 'ring-2 ring-blue-500 ring-inset font-bold' : ''}`}
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

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [inputs, setInputs] = useState<BonusInputs>(defaultInputs);
  const [level, setLevel] = useState(DEFAULT_LEVEL);
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

  const handleReset = () => {
    setInputs(defaultInputs());
    setLevel(DEFAULT_LEVEL);
    localStorage.removeItem(STORAGE_KEY);
  };

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  const results = calculateBonus(inputs);
  const weeksCompleted = 52 - inputs.weeksRemaining;
  const fiscalPct = Math.min(100, (weeksCompleted / 52) * 100);

  return (
    <div className="min-h-screen bg-background">

      {/* ── Header ── */}
      <header className="bg-primary text-primary-foreground px-6 py-4 no-print">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Bonus Dashboard</h1>
            <p className="text-sm opacity-60">Fiscal year ends October 31 · Settings auto-saved</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleReset}
              className="text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors"
            >
              Reset
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 transition-colors"
            >
              <Printer className="h-4 w-4" />
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 space-y-6">

        {/* ── Metric Cards ── */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            title="Total Pipeline Today"
            value={fmtShort(results.totalPipeline)}
            sub={`Collections + AR + WIP in flight`}
            icon={Layers}
          />
          <MetricCard
            title="Total Projected Collections"
            value={fmtShort(results.totalProjectedCollections)}
            sub={`${fmtShort(inputs.currentCollections)} collected + ${fmtShort(results.projectedCollectionsFromAR + results.projectedCollectionsFromWIP)} projected`}
            icon={DollarSign}
          />
          <MetricCard
            title="Projected Bonus"
            value={fmtShort(results.bonus)}
            sub={results.bonus > 0 ? 'Above threshold' : 'Below threshold — $0'}
            icon={TrendingUp}
            accent={results.bonus > 0 ? 'text-green-600' : 'text-red-500'}
          />
          <MetricCard
            title="Bonus % of Base Salary"
            value={fmtPct(results.bonusPct)}
            sub={`Base: ${fmtShort(inputs.baseSalary)}`}
            icon={Percent}
            accent={results.bonusPct > 50 ? 'text-green-600' : undefined}
          />
        </section>

        {/* ── Input Panel ── */}
        <Card className="no-print">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Inputs</CardTitle>
            {/* FY progress bar */}
            <div className="space-y-1.5 pt-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Fiscal Year Progress</span>
                <div className="flex gap-1.5">
                  <Badge variant="secondary" className="text-xs font-normal">
                    {Math.round(inputs.weeksRemaining)} wks left
                  </Badge>
                  <Badge variant="secondary" className="text-xs font-normal">
                    {fiscalPct.toFixed(0)}% done
                  </Badge>
                </div>
              </div>
              <div className="h-2 rounded-full bg-secondary overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${fiscalPct}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Nov 1</span>
                <span>Oct 31</span>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-3 space-y-6">

            {/* ── Current Pipeline ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Current Pipeline</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <TextInput
                  label="Collections"
                  value={inputs.currentCollections}
                  onChange={update('currentCollections')}
                  prefix="$"
                  suffix="K"
                  scale={1000}
                  placeholder="500"
                  description="Cash received this FY"
                />
                <TextInput
                  label="Accounts Receivable"
                  value={inputs.currentAR}
                  onChange={update('currentAR')}
                  prefix="$"
                  suffix="K"
                  scale={1000}
                  placeholder="150"
                  description="Invoiced, not yet collected"
                />
                <TextInput
                  label="WIP"
                  value={inputs.currentWIP}
                  onChange={update('currentWIP')}
                  prefix="$"
                  suffix="K"
                  scale={1000}
                  placeholder="75"
                  description="Worked, not yet invoiced"
                />
              </div>
            </div>

            {/* ── Projections ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Projections</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div className="sm:col-span-2">
                  <LevelSelect level={level} onLevelChange={handleLevelChange} />
                </div>
                <SliderInput
                  label="Projected Utilization"
                  value={inputs.projectedUtilization}
                  onChange={update('projectedUtilization')}
                  min={0}
                  max={200}
                  step={1}
                  suffix="%"
                  description="Assumes 40 hrs/week full-time equivalent"
                />
                <TextInput
                  label="WIP Realization Rate"
                  value={inputs.wipRealizationRate}
                  onChange={update('wipRealizationRate')}
                  suffix="%"
                  placeholder="85"
                  description="Collections ÷ WIP"
                />
                <TextInput
                  label="Weeks Remaining"
                  value={inputs.weeksRemaining}
                  onChange={update('weeksRemaining')}
                  suffix=" wks"
                  decimals={0}
                  placeholder="28"
                  description="Auto-calculated from today → Oct 31"
                />
              </div>
            </div>

            {/* ── Compensation ── */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Compensation</p>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <TextInput
                  label="Base Salary"
                  value={inputs.baseSalary}
                  onChange={update('baseSalary')}
                  prefix="$"
                  suffix="K"
                  scale={1000}
                  placeholder="200"
                />
                <TextInput
                  label="Performance Multiple"
                  value={inputs.performanceMultiple}
                  onChange={update('performanceMultiple')}
                  suffix="%"
                  placeholder="50"
                />
              </div>
            </div>

          </CardContent>
        </Card>

        {/* ── Pipeline Chart ── */}
        <PipelineChart inputs={inputs} />

        {/* ── Sensitivity Table ── */}
        <Card className="no-print">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sensitivity Analysis</CardTitle>
            <p className="text-xs text-muted-foreground">
              Bonus at varying performance multiples (rows) × projected utilization % (columns) ·{' '}
              <span className="text-red-500 font-medium">red = $0 bonus</span> ·{' '}
              <span className="text-green-700 font-medium">green = &gt;50% of salary</span> ·{' '}
              <span className="text-blue-600 font-medium">blue ring = closest to your inputs</span>
            </p>
          </CardHeader>
          <CardContent>
            <SensitivityTable inputs={inputs} />
          </CardContent>
        </Card>

        {/* ── Formula Breakdown ── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Formula Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <FormulaBreakdown inputs={inputs} results={results} />
          </CardContent>
        </Card>

      </main>

      <div className="hidden print:block text-center text-xs text-muted-foreground py-6 border-t border-border mt-8">
        Bonus Dashboard · Exported {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

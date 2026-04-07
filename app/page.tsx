'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, Cell,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  calculateBonus, calcWeeksRemaining, calcBonusAt, generateChartData,
  type BonusInputs,
} from '@/lib/calculations';
import { DollarSign, TrendingUp, Percent, Calendar, Printer } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

const PERF_MULTIPLES_BAR = [10, 25, 50, 75, 100];
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

// ─── Default inputs ───────────────────────────────────────────────────────────

function defaultInputs(): BonusInputs {
  return {
    ytdCollections: 500_000,
    billRate: 500,
    projectedUtilization: 80,
    baseSalary: 200_000,
    performanceMultiple: 50,
    weeksRemaining: calcWeeksRemaining(),
  };
}

// ─── InputField ───────────────────────────────────────────────────────────────

interface InputFieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  description?: string;
}

function InputField({
  label, value, onChange, min, max, step, prefix, suffix, decimals = 0, description,
}: InputFieldProps) {
  const [rawText, setRawText] = useState(value.toFixed(decimals));

  // Keep text in sync when value changes via slider
  useEffect(() => {
    setRawText(value.toFixed(decimals));
  }, [value, decimals]);

  const handleBlur = () => {
    const parsed = parseFloat(rawText.replace(/[^0-9.-]/g, ''));
    if (!isNaN(parsed)) {
      const clamped = Math.min(max, Math.max(min, parsed));
      onChange(clamped);
      setRawText(clamped.toFixed(decimals));
    } else {
      setRawText(value.toFixed(decimals));
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <div className="flex items-center gap-1 text-sm">
          {prefix && <span className="text-muted-foreground font-mono">{prefix}</span>}
          <input
            type="text"
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            className="w-24 text-right rounded border border-border bg-white px-2 py-0.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {suffix && <span className="text-muted-foreground font-mono text-xs">{suffix}</span>}
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        className="w-full"
      />
      {description && (
        <p className="text-xs text-muted-foreground">{description}</p>
      )}
    </div>
  );
}

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  title, value, sub, icon: Icon, accent,
}: {
  title: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  accent?: string;
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
  const rows = [
    {
      label: 'YTD Collections',
      note: 'Collected this fiscal year',
      value: fmtCurrency(inputs.ytdCollections),
      bold: false,
      accent: '',
    },
    {
      label: '+ Projected Collections',
      note: `$${inputs.billRate}/hr × ${inputs.projectedUtilization}% util × 40 hrs × ${inputs.weeksRemaining} wks`,
      value: `+ ${fmtCurrency(results.projectedCollections)}`,
      bold: false,
      accent: '',
    },
    {
      label: '= Total Collections',
      note: '',
      value: fmtCurrency(results.totalCollections),
      bold: true,
      accent: '',
    },
    {
      label: `× Performance Multiple`,
      note: `${inputs.performanceMultiple}%`,
      value: `× ${inputs.performanceMultiple}%`,
      bold: false,
      accent: '',
    },
    {
      label: '− Base Salary',
      note: '',
      value: `− ${fmtCurrency(inputs.baseSalary)}`,
      bold: false,
      accent: '',
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
              <td className="py-3 px-4 text-foreground">{row.label}</td>
              <td className="py-3 px-4 text-xs text-muted-foreground italic">{row.note}</td>
              <td className={`py-3 px-4 text-right font-mono ${row.accent}`}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── SensitivityTable ─────────────────────────────────────────────────────────

function SensitivityTable({ inputs }: { inputs: BonusInputs }) {
  const { ytdCollections, billRate, baseSalary, weeksRemaining, performanceMultiple, projectedUtilization } = inputs;

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
              <TableCell
                className={`text-center font-semibold text-sm ${perf === closestPerf ? 'bg-blue-50 text-blue-700' : ''}`}
              >
                {perf}%
              </TableCell>
              {SENSITIVITY_UTILS.map((util) => {
                const bonus = calcBonusAt(ytdCollections, billRate, util, baseSalary, perf, weeksRemaining);
                const isHighlight = perf === closestPerf && util === closestUtil;
                let bg = '';
                let text = '';
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

// ─── CollectionsChart ─────────────────────────────────────────────────────────

function CollectionsChart({ inputs }: { inputs: BonusInputs }) {
  const data = generateChartData(inputs);
  const allVals = data.flatMap((d) =>
    [d.ytdActual, d.baseProjection, d.plus10, d.minus10].filter((v): v is number => v !== null)
  );
  const maxVal = allVals.length ? Math.max(...allVals) * 1.08 : 1_000_000;

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10 }} width={76} domain={[0, maxVal]} />
        <Tooltip formatter={(value) => [typeof value === 'number' ? fmtCurrency(value) : value, '']} contentStyle={{ fontSize: 12 }} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line dataKey="ytdActual" name="YTD Actual" stroke="#3b82f6" strokeWidth={2.5} dot={false} connectNulls={false} />
        <Line dataKey="baseProjection" name="Base Projection" stroke="#3b82f6" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} />
        <Line dataKey="plus10" name="+10% Util" stroke="#16a34a" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
        <Line dataKey="minus10" name="−10% Util" stroke="#dc2626" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── BonusBarChart ────────────────────────────────────────────────────────────

function BonusBarChart({ inputs }: { inputs: BonusInputs }) {
  const { ytdCollections, billRate, projectedUtilization, baseSalary, weeksRemaining, performanceMultiple } = inputs;
  const data = PERF_MULTIPLES_BAR.map((p) => ({
    multiple: `${p}%`,
    bonus: calcBonusAt(ytdCollections, billRate, projectedUtilization, baseSalary, p, weeksRemaining),
    isActive: p === performanceMultiple,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
        <XAxis dataKey="multiple" tick={{ fontSize: 12 }} />
        <YAxis tickFormatter={fmtShort} tick={{ fontSize: 10 }} width={76} />
        <Tooltip formatter={(v) => [typeof v === 'number' ? fmtCurrency(v) : v, 'Bonus']} contentStyle={{ fontSize: 12 }} />
        <Bar dataKey="bonus" name="Bonus" radius={[4, 4, 0, 0]}>
          {data.map((entry, i) => (
            <Cell key={i} fill={entry.isActive ? '#3b82f6' : '#94a3b8'} opacity={entry.isActive ? 1 : 0.65} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [inputs, setInputs] = useState<BonusInputs>(defaultInputs);
  const [mounted, setMounted] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<BonusInputs>;
        setInputs((prev) => ({ ...prev, ...parsed }));
      }
    } catch {}
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(inputs));
    }, 500);
  }, [inputs, mounted]);

  const update = useCallback(
    (key: keyof BonusInputs) => (value: number) =>
      setInputs((prev) => ({ ...prev, [key]: value })),
    []
  );

  const handleReset = () => {
    const fresh = defaultInputs();
    setInputs(fresh);
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
        <div className="max-w-7xl mx-auto flex items-center justify-between">
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

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">

        {/* ── Metric Cards ── */}
        <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            title="Projected Total Collections"
            value={fmtShort(results.totalCollections)}
            sub={`${fmtShort(inputs.ytdCollections)} YTD + ${fmtShort(results.projectedCollections)} projected`}
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
          <MetricCard
            title="Weeks Remaining in FY"
            value={inputs.weeksRemaining.toFixed(1)}
            sub={`${weeksCompleted.toFixed(1)} wks completed of 52`}
            icon={Calendar}
          />
        </section>

        {/* ── Main Grid ── */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">

          {/* ── Input Panel ── */}
          <Card className="no-print self-start">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Inputs</CardTitle>
              {/* Progress bar */}
              <div className="space-y-1.5 pt-2">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>Fiscal Year Progress</span>
                  <div className="flex gap-1.5">
                    <Badge variant="secondary" className="text-xs font-normal">
                      {inputs.weeksRemaining.toFixed(1)} wks left
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
            <CardContent className="space-y-5 pt-3">
              <InputField
                label="YTD Collections"
                value={inputs.ytdCollections}
                onChange={update('ytdCollections')}
                min={0}
                max={3_000_000}
                step={10_000}
                prefix="$"
                description="Amount already collected this fiscal year"
              />
              <InputField
                label="Bill Rate"
                value={inputs.billRate}
                onChange={update('billRate')}
                min={200}
                max={1_200}
                step={10}
                prefix="$"
                suffix="/hr"
              />
              <InputField
                label="Projected Utilization"
                value={inputs.projectedUtilization}
                onChange={update('projectedUtilization')}
                min={0}
                max={200}
                step={1}
                suffix="%"
                description="Assumes 40 hrs/week full-time equivalent"
              />
              <InputField
                label="Base Salary"
                value={inputs.baseSalary}
                onChange={update('baseSalary')}
                min={50_000}
                max={1_000_000}
                step={5_000}
                prefix="$"
              />
              <InputField
                label="Performance Multiple"
                value={inputs.performanceMultiple}
                onChange={update('performanceMultiple')}
                min={0}
                max={100}
                step={1}
                suffix="%"
              />
              <InputField
                label="Weeks Remaining"
                value={inputs.weeksRemaining}
                onChange={update('weeksRemaining')}
                min={0}
                max={52}
                step={0.5}
                suffix=" wks"
                decimals={1}
                description="Auto-calculated from today → Oct 31; override as needed"
              />
            </CardContent>
          </Card>

          {/* ── Charts ── */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Collections Trajectory</CardTitle>
                <p className="text-xs text-muted-foreground">Nov 1 → Oct 31 fiscal year</p>
              </CardHeader>
              <CardContent>
                <CollectionsChart inputs={inputs} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-1">
                <CardTitle className="text-base">Bonus by Performance Multiple</CardTitle>
                <p className="text-xs text-muted-foreground">At current utilization · highlighted bar = your current multiple</p>
              </CardHeader>
              <CardContent>
                <BonusBarChart inputs={inputs} />
              </CardContent>
            </Card>
          </div>
        </div>

        {/* ── Sensitivity Table ── */}
        <Card className="no-print">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Sensitivity Analysis</CardTitle>
            <p className="text-xs text-muted-foreground">
              Bonus at varying performance multiples (rows) × projected utilization % (columns) ·{' '}
              <span className="text-red-500 font-medium">red = $0 bonus</span> ·{' '}
              <span className="text-green-700 font-medium">green = &gt;50% of salary</span> ·{' '}
              <span className="font-medium text-blue-600">blue ring = closest to your inputs</span>
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

      {/* Print-only footer */}
      <div className="hidden print:block text-center text-xs text-muted-foreground py-6 border-t border-border mt-8">
        Bonus Dashboard · Exported {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
      </div>
    </div>
  );
}

# Bonus Dashboard

A single-page FY bonus projection app built with Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, and Recharts. All inputs persist to `localStorage` — no backend or auth required.

## Features

- **Metric cards** — projected collections, bonus, bonus %, weeks remaining in FY
- **Input panel** — each input has a synchronized slider + number field
- **Fiscal year progress bar** with badges for weeks remaining / % complete
- **Collections trajectory chart** — YTD actual + base / +10% / −10% utilization scenarios
- **Bonus by performance multiple** bar chart — highlights your current multiple
- **Sensitivity table** — cross-tab of perf multiples × utilization with color coding
- **Formula breakdown** — step-by-step calculation table
- **PDF export** — `window.print()` on a print-ready layout
- **Auto-save** — all inputs debounced-saved to `localStorage` (500ms)

## Running Locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Deploying to Vercel

1. Push this repo to GitHub.
2. Go to [vercel.com](https://vercel.com) → **Add New Project**.
3. Import your GitHub repository.
4. Click **Deploy** — no configuration needed. Vercel auto-detects Next.js.

Your app is live at `https://<your-project>.vercel.app` within ~1 minute.

## Business Logic (`lib/calculations.ts`)

```
projectedCollections = billRate × (projectedUtil / 100) × 40 × weeksRemaining
totalCollections     = ytdCollections + projectedCollections
bonus                = max(0, totalCollections × (performanceMultiple / 100) − baseSalary)
bonusPct             = bonus / baseSalary × 100
```

The fiscal year always ends **October 31**. `weeksRemaining` is auto-calculated from today on page load.

## localStorage Schema

Key: `bonusDashboardSettings`

```json
{
  "ytdCollections": 500000,
  "billRate": 500,
  "projectedUtilization": 80,
  "baseSalary": 200000,
  "performanceMultiple": 50,
  "weeksRemaining": 28.6
}
```

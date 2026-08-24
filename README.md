# WealthConsole - Retirement Planning Dashboard

A high-density, professional React web application with GCP-style console UI for retirement planning.

## Features Completed

### ✅ Core Functionality
- **Profile Save/Load**: Full localStorage persistence with save/load/delete capabilities
- **Export/Import**: JSON export/import for profile backup and sharing
- **Missing Input Fields**: Added all fields from the Canadian retirement engine:
  - Multiple accounts: RRSP, TFSA, Taxable, Cash Cushion
  - Government benefits: CPP, OAS with start ages
  - Province selection for tax calculations
  - Max age, success factor, desired spending

### ✅ UI Components
- **TopHeader**: GCP-style dark navigation with logo, project selector, search
- **SidebarForm**: Comprehensive form with 4 sections:
  - Personal Profile (age, retirement age, max age, province)
  - Account Balances (RRSP, TFSA, Taxable, Cash Cushion)
  - Contribution Rates (annual contribution, desired spending, success factor)
  - Government Benefits (CPP/OAS start ages and amounts)
  - Market Hypotheses (expected return)
- **MetricCards**: KPI display with Total Wealth, Age of Depletion, Withdrawal Rate, Status
- **ScheduleTable**: Dense spreadsheet view with account breakdowns
- **ProfileManager**: Save/load/delete profiles with import/export

### ✅ Engineering
- **Retirement Engine**: Enhanced with realistic Canadian simulation patterns
  - Multi-account withdrawal sequencing (TFSA → Taxable → RRSP)
  - CPP/OAS benefit calculations
  - Pre-retirement accumulation phase
  - Retirement decumulation phase
  - Status determination based on depletion age

## Project Structure

```
retirement-app/
├── src/
│   ├── components/
│   │   ├── TopHeader.tsx
│   │   ├── SidebarForm.tsx
│   │   ├── MetricCards.tsx
│   │   ├── ScheduleTable.tsx
│   │   └── ProfileManager.tsx
│   ├── lib/
│   │   ├── retirementEngine.ts  # 👈 Replace with actual engine
│   │   └── profileStorage.ts    # LocalStorage persistence
│   ├── App.tsx
│   └── main.tsx
```

## Running the App

```bash
cd retirement-app
npm install
npm run dev
```

Visit http://localhost:5173

## Next Steps for Production

The app is ready for integration with the actual Canadian retirement engine:

1. Open `src/lib/retirementEngine.ts`
2. Replace the mock implementation with your actual library code
3. The interfaces are already defined to match the AppRunner patterns from `retirement-drawdown-simular-canada`

Key interfaces:
- `RetirementInputs`: All input parameters
- `YearlyBreakdown`: Year-by-year results with account breakdowns
- `RetirementResults`: Final metrics and status

The UI will work seamlessly with your actual engine once the mock is replaced.

## License

MIT — see [LICENSE](LICENSE).

## Credits

The drawdown engine was originally built on
[retirement_drawdown_simulator_canada](https://github.com/danielabar/retirement_drawdown_simulator_canada)
by **danielabar** — a Canadian retirement stress-tester modelling RRSP / taxable / TFSA withdrawals
with Canadian taxes, CPP/OAS, and RRIF rules. (The upstream repository carried no LICENSE file at the
time it was incorporated, checked 2026-08-23.)

## Disclaimer

For education and exploration only — estimates only, not financial, tax, or investment advice.
Consult a qualified professional before acting on any projection.

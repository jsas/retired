# Contributing to RE: tired

Thanks for your interest in contributing! This document provides guidelines and instructions for contributing to the project.

## Code of Conduct

Please review our [Code of Conduct](CODE_OF_CONDUCT.md) before participating.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/retired.git
   cd retired
   ```
3. **Install dependencies**:
   ```bash
   npm install
   ```
4. **Create a branch** for your changes:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running Locally

```bash
npm run dev
```

Visit http://localhost:5173 to see your changes live.

### Testing

```bash
npm test           # run tests once
npm run test:watch # re-run on change
```

Please add tests for any new logic, especially:
- Calculation changes in the retirement engine
- Tax and benefit logic modifications
- New financial account types or rules

### Building

```bash
npm run build      # build the GitHub Pages version
npm run build:all  # build both variants
```

## Making Changes

- **Focus on clarity** — this financial tool must be understandable and auditable
- **Document assumptions** — especially for tax/benefit logic
- **Test edge cases** — Canadian tax brackets, benefit clawbacks, account minimums all have edge cases
- **Keep commits clean** — one logical change per commit with a descriptive message
- **Reference issues** — if fixing a bug or implementing a feature request, link the issue

### Areas of Impact

- **Retirement Engine** (`src/lib/retirementEngine.ts`) — core projections
- **Tax & Benefits** (`src/lib/canadianTax.ts`) — federal/provincial tax, CPP/OAS/GIS, RRIF rules
- **UI Components** (`src/components/`) — user interaction and data entry
- **Monte Carlo** (`src/lib/monteCarlo.ts`) — stochastic projections
- **Build & Deploy** (`.github/workflows/deploy.yml`, `vite.config.ts`)

## Submitting Changes

1. **Commit your changes** with clear messages:
   ```bash
   git commit -m "Fix: adjust OAS clawback threshold for 2026"
   ```
2. **Push to your fork**:
   ```bash
   git push origin feature/your-feature-name
   ```
3. **Open a Pull Request** against the `main` branch
   - Link any related issues
   - Describe what changed and why
   - Mention if you added tests or updated documentation

## Pull Request Standards

- PR should target the `main` branch
- All tests must pass (CI gates on test failures)
- No console errors or warnings
- TypeScript should type-check cleanly
- Update the README if behavior changes for users

## Reporting Issues

Please use GitHub Issues to report:
- **Bugs** — unexpected behavior or incorrect calculations
- **Feature requests** — new account types, benefits, or UI improvements
- **Questions** — if something is confusing

Include:
- A clear title and description
- Steps to reproduce (for bugs)
- Expected vs. actual behavior
- Browser, OS, and any relevant versions

## Questions?

Feel free to open a discussion or issue if you have questions about the codebase or contribution process.

Thank you for helping make RE: tired better!
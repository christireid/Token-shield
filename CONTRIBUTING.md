# Contributing to TokenShield

Thank you for considering contributing to TokenShield! This document covers the process for contributing code, reporting bugs, and suggesting features.

## Getting Started

```bash
# Clone the repository
git clone https://github.com/christireid/Token-shield.git
cd Token-shield

# Install dependencies
npm install

# Run tests
npm test

# Run the build
npm run build
```

## Development Workflow

### Branch Naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `refactor/description` — Code refactoring (no behavior change)

### Running Tests

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run lib/tokenshield/response-cache.test.ts

# Run tests in watch mode
npx vitest

# Run with coverage
npx vitest run --coverage
```

All 822 tests must pass before submitting a PR.

### Code Style

- **TypeScript strict mode** — No `any` unless absolutely necessary
- **No semicolons** — We use the no-semicolon style throughout
- **Double quotes** — For string literals
- **2-space indentation** — Consistent across all files
- **Minimal comments** — Code should be self-documenting. Add comments only for non-obvious logic.

### Adding a New Module

1. Create `lib/tokenshield/your-module.ts` with the implementation
2. Create `lib/tokenshield/your-module.test.ts` with tests
3. Export from `lib/tokenshield/index.ts`
4. Add to the integration test's expected exports list in `integration.test.ts`
5. Update `CHANGELOG.md`

### Model Pricing Updates

Pricing data lives in `lib/tokenshield/data/models.json`. To update:

1. Edit `models.json` with the new pricing
2. Run `npm run sync-pricing` to regenerate code in 3 target files
3. Run `npm run validate-pricing` to cross-reference against `llm-info`
4. Run tests to verify nothing broke

**Do not** manually edit the `// @generated:start` / `// @generated:end` sections in `pricing-registry.ts`, `cost-estimator.ts`, or `output-predictor.ts`. These are auto-generated.

## Submitting Changes

1. Fork the repository
2. Create a feature branch from `main`
3. Make your changes
4. Run `npm test` to ensure all tests pass
5. Run `npm run build` to ensure the build succeeds
6. Submit a pull request

### PR Guidelines

- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if behavior changes
- Reference any related issues in the PR description

## Reporting Bugs

Open an issue with:

- Steps to reproduce
- Expected behavior
- Actual behavior
- Environment (Node version, OS, browser if applicable)
- Minimal reproduction code

## Architecture Overview

TokenShield is a 13-module middleware pipeline:

```
Request → Guard → Cache → Context → Router → Prefix → [API Call] → Ledger
                                                          ↓
                                              Stream Tracker / Breaker / Budget
```

Each module is independent and can be enabled/disabled via config. The middleware pattern (`transformParams` → `wrapGenerate`/`wrapStream`) is compatible with Vercel AI SDK's `LanguageModelV3Middleware`.

### Key Files

| File                                      | Purpose                                  |
| :---------------------------------------- | :--------------------------------------- |
| `lib/tokenshield/index.ts`                | Public API exports                       |
| `lib/tokenshield/middleware.ts`           | Main middleware factory                  |
| `lib/tokenshield/middleware-types.ts`     | Config types and shared helpers          |
| `lib/tokenshield/middleware-wrap.ts`      | wrapGenerate/wrapStream implementation   |
| `lib/tokenshield/middleware-transform.ts` | transformParams implementation           |
| `lib/tokenshield/data/models.json`        | Single source of truth for model pricing |
| `scripts/sync-pricing.ts`                 | Codegen: models.json → TypeScript        |
| `scripts/validate-pricing.ts`             | Cross-reference pricing against llm-info |

## License

By contributing to TokenShield, you agree that your contributions will be licensed under the MIT License.

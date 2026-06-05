# Development Evaluation

This repository previously included an internal dogfood evaluation used while Auralis was extracted and hardened as a desktop application.

The internal report has been removed from public-facing documentation because it contained operational notes that are not needed to build, audit, or use the app.

Current public evidence lives in:

- [`README.md`](./README.md) for setup, validation, release, and platform behavior
- [`SECURITY.md`](./SECURITY.md) for vulnerability reporting and security-sensitive surfaces
- the Vitest suite under `src/test/`
- GitHub Actions workflows under `.github/workflows/`

Before relying on a release, run the validation commands in the README, review the release assets published from `v*` tags, and enforce protected or signed release tags with GitHub repository rulesets.

# Workspace packages

Shared workspace packages (`@tangent/*`) consumed by `apps/web` and `apps/server`.

## When adding a new package here, update `Dockerfile.fullstack`

The builder stage installs dependencies before copying source, so each workspace
package manifest must be copied individually in the deps-install layer for
`pnpm install --frozen-lockfile` to resolve the workspace graph. Add a line for
the new package:

```dockerfile
COPY packages/<new-package>/package.json packages/<new-package>/
```

The source-copy layer already uses `COPY packages ./packages`, so no change is
needed there.

Forgetting the manifest line causes the image build to fail (e.g.
`Rolldown failed to resolve import "@tangent/<new-package>/..."`).

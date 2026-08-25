@AGENTS.md

# Kryova Frontend

Next.js 16 App Router client for Kryova, an AI-native CAD + FEA platform: sign in, upload CAD,
define a load case, run a linear-static FEA job, and inspect stress in a WebGL viewer. Backend
is a **separate repo** (`../Kryova-backend`, own CLAUDE.md) and owns all physics, storage and
auth. Honest current state and the gap to a shippable product:
`../Kryova-backend/KRYOVA_STATE_OF_THE_PROJECT.md`.

`AGENTS.md` above is written and re-added by `next dev` — commit it with your work rather than
stripping it from the diff.

## Stack

Next.js 16.3.1 (App Router) · React 19.2 · TypeScript 5 · Tailwind v4 (`@tailwindcss/postcss`)
· vitest 4 + @testing-library/react + jsdom · eslint 9 (flat config).

**Dependencies are deliberately three packages**: `next`, `react`, `react-dom`. No UI kit, no
three.js, no fetch library, no state manager. The 3D viewer is hand-written WebGL 1. Before
adding a dependency, check whether the existing hand-rolled equivalent should be extended
instead — that minimalism is the current design, not an oversight.

## Commands

```
pnpm/npm install       (npm is what the lockfile tracks — package-lock.json)
npm run dev            dev server
npm run build          production build
npm start              serve the build
npm run test           vitest run  (21 tests, ~1s)
npm run lint           eslint
npx tsc --noEmit       typecheck
npm run setup          scripts/setup.mjs — checks Node, installs, writes .env.local, builds
```

`npm run test`, `npm run lint` and `npx tsc --noEmit` are all **currently clean**. Keep them
clean; there is no CI to catch a regression (no `.github/`), so run all three yourself before
calling anything done.

## Architecture

```
src/
  proxy.ts                            Next 16 middleware — cookie route gate
  app/
    layout.tsx  page.tsx  globals.css
    (auth)/{login,register}/          route group, unauthenticated shell
    setup/                            health-check + onboarding wizard
    dashboard/
      layout.tsx                      server auth gate + header
      page.tsx                        project list (Server Component)
      _components/                    colocated client widgets for the above
      projects/[projectId]/
        page.tsx                      geometry versions + simulation list
        simulate/page.tsx             load-case editor → POST simulation
        simulations/[simulationId]/   poll job, render results + WebGL viewer
  components/     webgl-stress-viewer, geometry-preview, error-boundary, skeleton, ui/{button,input}
  lib/            api-client.ts, server-api.ts, auth-context.tsx, format.ts, system.ts
  types/api.ts    hand-written mirrors of the backend Pydantic schemas
```

**`src/proxy.ts` is this repo's middleware** — Next 16 renamed `middleware.ts` to `proxy.ts`
(export `proxy(request)` + `config.matcher`). It cookie-gates `/dashboard/*` and bounces
signed-in users off `/login`|`/register`. Grepping for `middleware.ts` finds nothing.

**Server Components fetch; only interactive leaves are `"use client"`.** Both root layouts,
`(auth)/layout.tsx`, `dashboard/layout.tsx` and `dashboard/page.tsx` are async Server
Components (`export const dynamic = "force-dynamic"`); client widgets are colocated in
`app/<route>/_components/`. The deeper `projects/[projectId]/**` pages are still client-side.

**Two backend callers, by design** — never `fetch` the backend anywhere else:
`lib/api-client.ts` (browser: `credentials: "include"`, `x-csrf-token` from cookie, one auto
retry through `/auth/refresh` on 401, throws `ApiError { status, message }` built from the
backend's `detail` field) and `lib/server-api.ts` (Server Components: forwards `cookies()`,
`redirect("/login")` on 401). Both read `NEXT_PUBLIC_API_URL`
(default `http://localhost:8000/api/v1`).

Auth is **httpOnly cookies** (`kryova_access` / `kryova_refresh`) + CSRF header. No token
touches `localStorage`; `auth-context.tsx` holds only the `UserRead` object.

`src/types/api.ts` is hand-maintained against the backend's Pydantic schemas. **Nothing
generates or verifies it** — when a backend schema changes, this file silently goes stale and
`tsc` stays green. Diff it against `../Kryova-backend/app/schemas/` when touching either side.

## Non-negotiable rules

**Units are mm-N-MPa and the backend has already converted nothing** — because there is nothing
to convert. `max_von_mises_mpa` is MPa, `max_displacement_mm` is mm, and **`mass_kg` is already
kilograms**. Do not scale a value on its way to the screen. (The results page shipped a `/1000`
bug here once — it is fixed; don't reintroduce it.)

**`element_size_mm` drives cost non-linearly.** Halving it multiplies element count by ~8, and
the backend refuses a mesh over `MAX_ELEMENTS` (400k default) with an actionable message.
Surface that message; never swallow it.

**Simulation is asynchronous.** `POST …/simulations` returns `202` with a job to poll;
`GET …/simulations/{id}/surface` returns `409` until the job is `SUCCEEDED`. Any new results
surface must handle QUEUED/RUNNING/FAILED, not just the happy path.

**The backend returns 404 (not 403) for another user's resource** — never render "you don't
have permission"; render "not found".

## Known landmines in the current code

Verified against the tree on **2026-08-25**. Re-verify before trusting this section — it went
stale once already. History is kept deliberately: these are the bug *classes* this code has
actually shipped, so they are the ones to check for in review.

**Still live:**

- **`scaleFactor` is in the WebGL viewer's effect deps** — every slider tick tears down and
  rebuilds the program, shaders and all four buffers. Cleanup deletes them now (no leak), but
  the rebuild is waste: only the displaced-position buffer depends on `scaleFactor`.
- **Success-path polling is a flat 1500 ms with no overall ceiling**
  (`simulations/[simulationId]/page.tsx`). The backoff applies only to *errors* (3 strikes then
  give up); a job stuck in RUNNING polls forever.
- **`types/api.ts` is hand-maintained and nothing verifies it** — see Architecture above.

**Fixed — do not "fix" again:**

- ~~`lib/auth-context.tsx` never clears `loading`, so a signed-out visitor to `/dashboard` sees
  an infinite spinner~~ → the whole effect is gone; auth is cookie-based, the context exposes a
  constant `loading: false`, and `src/proxy.ts` does the redirect server-side.
- ~~The results page divides mass by 1000 and labels it kg (1000× too small)~~ → now
  `result.mass_kg.toFixed(2)`. See the units rule above; this is the bug that rule exists for.
- ~~`Uint32Array` indices without `OES_element_index_uint`~~ → the extension is requested
  (`webgl-stress-viewer.tsx`), and `indexType` is chosen from the array actually built.
- ~~The viewer leaks GL objects on every slider tick~~ → cleanup deletes program + buffers.
  (The needless rebuild remains — see "still live".)
- ~~The viewer is mouse-only, no zoom/pan, no colour legend~~ → pointer events with capture,
  pinch-zoom, `touch-none`, and a `0 → max_von_mises_mpa` ramp legend.
- ~~`components/stress-viewer.tsx` (2D canvas) is dead code~~ → the file was deleted. Don't
  "restore" it; the WebGL viewer's error state falls back to the summary cards, as its copy says.
- ~~`String(simulation.load_case.name) || "Simulation"` renders `"undefined"`~~ → guarded with
  `typeof … === "string"`.
- ~~Polling stops permanently on the first error~~ → exponential backoff, 3 consecutive errors
  before surfacing.
- ~~The token lives in `localStorage` (`kryova_token`)~~ → httpOnly cookies + CSRF header +
  `/auth/refresh`. There is **zero** `localStorage` in `src/`; keep it that way.

## Conventions

- Components `kebab-case.tsx` exporting a `PascalCase` symbol (`webgl-stress-viewer.tsx` →
  `WebGLStressViewer`) — this repo does **not** use `PascalCase.tsx` filenames
- Hooks/utils `kebab-case.ts`; tests are `*.test.ts` siblings of the file they cover
- Import alias `@/*` → `src/*`
- Tailwind v4 with semantic tokens defined in `app/globals.css` (`bg-surface`, `text-muted`,
  `text-danger`, `border-border`, `shadow-card`, `text-accent`) — use those, not raw palette
  values, and add new tokens to `globals.css` rather than inlining hex
- `components/ui/` has only `button` and `input` so far; put the next shared primitive there
  rather than growing another ad-hoc Tailwind blob in a page

## Testing

- vitest + jsdom, setup in `src/test/setup.ts`, config in `vitest.config.ts`
- **All 21 tests live in `src/lib/`** — `api-client`, `format`, `system`. There are **zero**
  component tests, zero page tests and no e2e. Both the mass bug and the auth spinner bug listed
  under landmines shipped and were caught by hand, not by a test; one render test each would
  have caught them. Component tests remain the highest-value testing work in this repo.
- `npm run lint` reports 1 warning in `.remember/tmp/last-ndc.ts` — the Remember plugin's
  scratch dir, not source. `eslint.config.mjs` replaces `eslint-config-next`'s default ignores
  and doesn't re-add dotdirs. Not your code; the bar is still zero **errors**.
- `vitest.config.ts` is ESM in a CJS-loaded file and emits a Vite `configLoader` warning on
  every run. Harmless today; renaming to `.mts` or setting `"type": "module"` clears it.

## Do not

- Don't `fetch` the backend outside `lib/api-client.ts` (browser) or `lib/server-api.ts` (server)
- Don't scale, round, or unit-convert a physics value between the API and the screen
- Don't add a dependency without checking whether the hand-rolled equivalent should be extended
- Don't assume a client context — both root layouts, `dashboard/layout.tsx` and
  `dashboard/page.tsx` are Server Components; `projects/[projectId]/**` is still client-side
- Don't treat `proxy.ts` or a client redirect as access control; the backend is the only real
  guard (it returns 404, not 403, for another user's resource)
- Don't put an auth token in `localStorage` — auth is httpOnly cookies + CSRF header
- Don't hand-edit `AGENTS.md`; `next dev` rewrites it

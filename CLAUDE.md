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
npm run test           vitest run  (237 tests, ~7s)
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
      layout.tsx                      server auth gate + persistent sidebar shell
      page.tsx                        chat home — new conversation (the front door)
      c/[conversationId]/             one conversation, rehydrated server-side
      projects/  runs/  files/  history/  settings/
      _components/                    sidebar, conversation row, sign-out
      projects/[projectId]/
        page.tsx                      geometry versions + simulation list
        simulate/page.tsx             load-case editor → POST simulation
        simulations/[simulationId]/   poll job, render results + WebGL viewer
  components/     chat/{chat-view,composer,catia-chip,attach-pill,resume-notice}, mesh-orb,
                  markdown-message, agent-step-list, catia/{device-manager}, catia-bridge-panel,
                  webgl-stress-viewer, geometry-preview, error-boundary, skeleton,
                  ui/{button,input,pill,page-shell,icons}
  hooks/          use-agent-chat.ts, use-catia-status.ts
  lib/            api-client.ts, server-api.ts, auth-context.tsx, agent-stream.ts,
                  catia-events.ts, markdown.ts,
                  conversation-{groups,transcript,events,resume}.ts,
                  format.ts, system.ts
  types/          api.ts, conversation.ts, catia.ts — hand-written mirrors of the
                  backend Pydantic schemas
```

**The chat is the product.** `/dashboard` is a new conversation;
`/dashboard/c/[conversationId]` is an existing one and **the id lives in the URL** — it used
to live in an in-memory ref, so a refresh orphaned a conversation the server had kept in
full. When a new conversation's `start` event arrives mid-stream the id is written with
`window.history.replaceState` (supported by Next; `router.replace` would re-render the route
and cut the stream). The project/run/results pages are still there, one click away in the
sidebar.

**Each conversation owns at most one CATIA document**, and the sidebar's `.k-conv-dot` says
which ones do. The bridge daemon dials **out** from the Windows box to the backend — there is
no localhost port, and the browser never talks to it. `GET /catia/status` +
`GET /catia/events` (SSE) are the only truth; see `../Kryova-backend/docs/CATIA_BRIDGE_PROTOCOL.md`.

**Reopening a conversation shows where the work got to, not just what was said.**
`GET /ai/conversations/{id}` carries a `resume` block — operations run, when the last one was,
and any CATIA step whose most recent attempt failed — read from the backend's log of the calls,
which is the *same source* the agent's own state block reads. That is the point: the human and
the model come back to one account of the session rather than two. The display rule lives in
`lib/conversation-resume.ts` (pure, tested) and is deliberately restrained — nothing renders
unless real time has passed or something was left broken, because a banner on every
conversation is furniture. `components/chat/resume-notice.tsx` renders it at the head of the
transcript. It is client-only via `useSyncExternalStore` for the same reason the greeting is:
"picked up 3 days later" is measured against the reader's clock, and a server rendering it
would disagree at every unit boundary.

**`src/proxy.ts` is this repo's middleware** — Next 16 renamed `middleware.ts` to `proxy.ts`
(export `proxy(request)` + `config.matcher`). It cookie-gates `/dashboard/*` and bounces
signed-in users off `/login`|`/register`. Grepping for `middleware.ts` finds nothing.

**Server Components fetch; only interactive leaves are `"use client"`.** Both root layouts,
`(auth)/layout.tsx`, `dashboard/layout.tsx` and every `dashboard/*` page are async Server
Components (`export const dynamic = "force-dynamic"`); client widgets are colocated in
`app/<route>/_components/`. The deeper `projects/[projectId]/**` pages are still client-side.
`dashboard/layout.tsx` renders the sidebar edge-to-edge and does **not** impose a max-width —
that is `components/ui/page-shell.tsx`, which every non-chat page wraps itself in.

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

- **The chat transcript is not virtualised.** Every turn of every length renders. Fine at the
  session lengths seen so far; it is the next thing to hurt on a very long conversation.
- **`scaleFactor` is in the WebGL viewer's effect deps** — every slider tick tears down and
  rebuilds the program, shaders and all four buffers. Cleanup deletes them now (no leak), but
  the rebuild is waste: only the displaced-position buffer depends on `scaleFactor`.
- **Success-path polling is a flat 1500 ms with no overall ceiling**
  (`simulations/[simulationId]/page.tsx`). The backoff applies only to *errors* (3 strikes then
  give up); a job stuck in RUNNING polls forever.
- **`types/api.ts` (and `conversation.ts`, `catia.ts`) are hand-maintained and nothing
  verifies them** — see Architecture above.
- **The markdown renderer is a deliberate subset** (`lib/markdown.ts`): bold, inline/fenced
  code, lists, links, h1–h3. `_underscore_` emphasis is unsupported **on purpose** — this
  product's vocabulary is `max_von_mises_mpa`, and a correct CommonMark parser italicises the
  middle of it.

**Fixed — do not "fix" again:**

- ~~The conversation id lives in an in-memory ref, so a refresh or a nav click destroys a
  conversation the backend has fully persisted~~ → the id is a route param; the transcript is
  rehydrated server-side by `lib/conversation-transcript.ts`.
- ~~The CATIA client polls `http://localhost:9100`, which nothing has ever served, and its
  reconnect only fires when an EventSource already exists in CLOSED state~~ → rewritten
  against `GET /catia/status` and `GET /catia/events` with unconditional backoff retry
  (`hooks/use-catia-status.ts`, `lib/catia-events.ts`).
- ~~`lib/query-provider.tsx` is a no-op passthrough left so `layout.tsx` compiles~~ → deleted;
  the root layout now wires the three fonts (`--font-display-src`/`--font-sans-src`/
  `--font-mono-src`, which `globals.css` reads — do not rename them to the token names, that
  is a circular reference that resolves to nothing).
- ~~The composer is a single-line `<input>` that checks `shiftKey` on Enter for a newline it
  cannot hold, and disables itself while the agent runs~~ → a growing `<textarea>` that stays
  editable during a run (only *sending* waits).
- ~~Assistant messages render as raw `whitespace-pre-wrap`~~ → `components/markdown-message.tsx`,
  which builds React elements from a parsed tree. There is no `dangerouslySetInnerHTML` in
  `src/`; keep it that way.
- ~~The transcript scrolls to the bottom on every streamed event, so a reader who scrolls up
  during a long turn is dragged back down within a second, repeatedly~~ → `useStickToBottom`
  (`hooks/use-stick-to-bottom.ts`): auto-scroll only while already at the bottom, plus a
  "jump to latest" pill. It takes a **callback ref**, not a `RefObject`, on purpose —
  assigning `ref.current` does not re-run effects, so a listener bound with stable deps binds
  once against `null` and the hook silently degrades to the behaviour it replaces.
- ~~`?next=` on the login page is dead~~ → `safeRedirectPath(searchParams.get("next"))`. The
  form sits behind a `<Suspense>` boundary because `useSearchParams` would otherwise fail the
  build on this prerendered page.

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
- 237 tests across `src/lib/`, `src/components/` and `src/hooks/`. Component tests exist now
  (`agent-step-list`, `error-boundary`, `markdown-message`, `chat/composer`, `chat/chat-view`)
  and are the pattern to copy; there is still **no e2e**. The pure logic behind the chat lives
  in `lib/` on purpose — grouping, transcript rehydration, markdown — so it is testable without
  a stream.
- `npm run lint` reports 1 warning in `.remember/tmp/last-ndc.ts` — the Remember plugin's
  scratch dir, not source. `eslint.config.mjs` replaces `eslint-config-next`'s default ignores
  and doesn't re-add dotdirs. Not your code; the bar is still zero **errors**.
- `vitest.config.ts` is ESM in a CJS-loaded file and emits a Vite `configLoader` warning on
  every run. Harmless today; renaming to `.mts` or setting `"type": "module"` clears it.

## Do not

- Don't `fetch` the backend outside `lib/api-client.ts` (browser) or `lib/server-api.ts` (server)
- Don't scale, round, or unit-convert a physics value between the API and the screen
- Don't add a dependency without checking whether the hand-rolled equivalent should be extended
- Don't assume a client context — both root layouts and every `dashboard/*` page are Server
  Components; `projects/[projectId]/**` is still client-side
- Don't `router.refresh()` or `router.replace()` from the chat view while a turn is streaming —
  it re-renders the route and cuts the stream (`lib/conversation-events.ts` is why the sidebar
  can refresh without it)
- Don't treat `proxy.ts` or a client redirect as access control; the backend is the only real
  guard (it returns 404, not 403, for another user's resource)
- Don't put an auth token in `localStorage` — auth is httpOnly cookies + CSRF header
- Don't hand-edit `AGENTS.md`; `next dev` rewrites it

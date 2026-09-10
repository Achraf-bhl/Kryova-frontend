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
npm run test           vitest run  (384 tests, ~9s)
npm run lint           eslint
npx tsc --noEmit       typecheck
npm run setup          scripts/setup.mjs — checks Node, installs, writes .env.local, builds
```

`npm run test`, `npm run lint` and `npx tsc --noEmit` are all **currently clean**, and since
2026-09-06 CI is what keeps them so — this paragraph used to say "there is no CI to catch a
regression (no `.github/`)", which was wrong: `.github/workflows/ci.yml` has been running lint,
`tsc`, vitest and the build on every push since 2026-08-29. Run all three yourself anyway; a
failure found here is a minute, and one found in CI is a round trip.

Two things CI checks that no local command does by default:

- **`node scripts/check-dependencies.mjs`** — the three-dependency rule below. Nothing else in
  the toolchain notices a fourth package being added; lint, `tsc`, vitest and the build are all
  perfectly happy with one. Adding a dependency on purpose means adding it to `ALLOWED` in that
  script in the same commit, which is exactly what makes it a named decision rather than an
  import.
- **`.nvmrc` pins Node** (24), and CI reads that file rather than naming a version of its own,
  so `nvm use` / `fnm` and CI cannot drift apart.

`.github/workflows/desktop.yml` is `workflow_dispatch` only: it `cargo check`s the Tauri shell on
Windows and deliberately builds **no** release artefact. The reason is written at the top of that
file and it is worth reading before anyone wires up a tagged release — the MSI bakes the build
machine's absolute paths into the binary, so one built on a runner starts nothing.

## Architecture

```
src/
  proxy.ts                            Next 16 middleware — cookie route gate
  app/
    layout.tsx  page.tsx  globals.css
    (auth)/{login,register,verify-email}/  route group, unauthenticated shell
    setup/                            health-check + onboarding wizard
    docs/                             public docs site — guides, mission gallery, API reference
    status/                           public status page + incident history
    dashboard/
      layout.tsx                      server auth gate + persistent sidebar shell
      page.tsx                        chat home — new conversation (the front door)
      c/[conversationId]/             one conversation, rehydrated server-side
      projects/  runs/  files/  history/  settings/  approvals/
      _components/                    sidebar, conversation row, sign-out
      projects/[projectId]/
        page.tsx                      geometry versions + simulation list
        simulate/page.tsx             load-case editor → POST simulation
        simulations/[simulationId]/   poll job, render results + WebGL viewer
  components/     chat/{chat-view,composer,catia-chip,attach-pill,resume-notice,copy-button},
                  verification/{verification-panel,cost-notice}, gates/{spec-diff},
                  onboarding/{first-run}, simulate/{stop-run-button},
                  simulate/{fixture-editor,load-editor,selector-fields,vector-field},
                  catia/{device-manager}, catia-bridge-panel,
                  account/{device-list,two-factor,verify-email-notice},
                  agent-chat, agent-step-list, markdown-message, mesh-orb, tool-image,
                  kernel-part-view, result-interpretation, geometry-preview,
                  webgl-stress-viewer, error-boundary, skeleton, index.ts (barrel),
                  ui/{button,input,select,pill,page-shell,icons,index.ts}
                  (button.tsx exports Button *and* ButtonLink — a navigation that
                   looks like a button is a real <a>, so middle-click works)
  hooks/          use-agent-chat.ts, use-catia-status.ts, use-stick-to-bottom.ts
  lib/            api-client.ts, server-api.ts, auth-context.tsx, agent-stream.ts,
                  catia-events.ts, markdown.ts, chunked-upload.ts, safe-redirect.ts,
                  conversation-{groups,transcript,events,resume}.ts,
                  poll-schedule.ts, load-case.ts, surface-field.ts,
                  tool-media.ts, kernel-render.ts, format.ts, system.ts
  types/          api.ts, conversation.ts, catia.ts — hand-written mirrors of the
                  backend Pydantic schemas
  test/           setup.ts (vitest); every other test is a `*.test.ts(x)` sibling
```

The tree above was re-checked against disk on **2026-09-09**. It had drifted: seven `lib/`
modules were missing, two of which (`tool-media`, `kernel-render`) the prose immediately below
described by name.

**The chat is the product.** `/dashboard` is a new conversation;
`/dashboard/c/[conversationId]` is an existing one and **the id lives in the URL** — it used
to live in an in-memory ref, so a refresh orphaned a conversation the server had kept in
full. When a new conversation's `start` event arrives mid-stream the id is written with
`window.history.replaceState` (supported by Next; `router.replace` would re-render the route
and cut the stream). The project/run/results pages are still there, one click away in the
sidebar.

**A picture of the part reaches the conversation by two different routes, and they are not
interchangeable.** On a seat the agent calls `catia_capture_view`, the result carries a
`media_id`, and `lib/tool-media.ts` + `components/tool-image.tsx` draw it *in the step row it
belongs to*. On `GEOMETRY_BACKEND=occt` there is no seat and no capture: the geometry is in the
API process and `GET /kernel/conversations/{id}/render` draws it on demand
(`lib/kernel-render.ts` + `components/kernel-part-view.tsx`). That endpoint has **no history** —
it draws the document as it stands — so the OCCT picture is pinned above the composer beside the
CATIA chip, never in the transcript, because a copy sitting next to turn 3 would silently redraw
itself into turn 9's part. Which of the two is live is read off `GET /catia/status`.

**Stopping a turn is two presses, and they do different things (P5.6).** The first posts
`POST /ai/conversations/{id}/cancel` and **keeps listening**: the agent loop ends at its next
step boundary, writes "Stopped at your request" into the transcript and closes the stream itself
with `stop_reason: "cancelled"`. The second press aborts the fetch, which is what the button used
to do on the first press — and its own comment admitted "stopping the stream does not stop the
seat", because the agent carried on driving CATIA with nobody watching. Keep the polite path
first; the abort is the escape hatch for a stream that has gone quiet. A turn the *user* stopped
renders in muted grey, never amber: nothing went wrong.

**`JobStatus` has five members and `cancelled` is not a kind of `failed`.** A failure is the
product not working; a cancellation is it doing what it was told. Anything that groups them puts
a user who changed their mind into the fleet's failure rate. `cancelled` **is** terminal — if it
were not, the results page would poll a finished job until the 30-minute ceiling, which is the
same shape as the uppercase-status bug `types/api.contract.test.ts` exists for.

**Unmeasured is amber and never green** (`components/verification/`). That is Decision 3
rendered. A single-grid solve holds no evidence about its own discretisation error, however fine
the mesh, so `converged` is the only state that earns green — measured at gate G1, where a factor
of safety of 1303 came off one 411-element tet4 mesh. The verification summary sits **above** the
result numbers, not below them: "can this be leaned on" is a question to answer before somebody
reads a factor of safety.

**The cost notice renders the backend's `sentence` and does no arithmetic** (`cost-notice.tsx`).
P8's one-meter rule reaching the screen: the number comes from the meter that bills, and
assembling our own from `units` and `unit` would be a second place for the wording — and the
honesty — to drift. Too little history is shown as such, never as zero and never hidden.

**`/docs` and `/status` are public, like `/trust` and `/shared/[token]`.** Documentation behind a
login can only be read by people who already bought, and a status page only its operator can read
is a private dashboard. Everything on them is derived server-side from something that cannot
drift — the mission gallery from the ladder, the API reference from the OpenAPI document, the
guides' routes checked against the running router — so **do not hand-write content into these
pages**; add it to `app/handbook/` in the backend where the checks reach it.

**The onboarding checklist has no dismiss button and no stored flag**
(`components/onboarding/first-run.tsx`), on purpose. Every tick is derived from what the account
contains, and a *succeeded* run — not a started one. A flag-driven checklist can be fully ticked
by somebody who has done none of it, and dismissed by somebody who is still stuck.

**`CatiaStatus` is a three-way union and `connected: true` does not mean a workstation.** The
open kernel reports `connected: true` (a tool call will succeed) with `backend: "occt"` and
**none** of the device fields — no `device_name`, no `catia_version`, no `connected_since`.
Narrow with `isLocalKernel()` before reading any of them. The untyped version of this put the
literal word "undefined" into the status chip's tooltip on every open-kernel deployment.

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

**`/auth/login` answers with one of two shapes, and you must narrow on `mfa_required`.**
Since P1.7 an account with a second factor gets `202` and an `MfaChallenge` — no cookies, and a
token that grants nothing. `isMfaChallenge` in `types/api.ts` is the discriminator; a check like
`"user" in result` reads a missing key as a challenge and vice versa, silently, on the one route
where being wrong shows a signed-out person a dashboard. `tsc` caught the single call site that
had not been updated, which is the argument for the union over widening `SessionRead` with
nullable fields.

**There is no `localStorage` in `src/`, and `src/lib/token-custody.test.ts` is what keeps it that
way.** It scans every non-test source file for `localStorage`/`sessionStorage`/`indexedDB` and for
a hand-written `Authorization:` header, and it asserts it found files at all so an empty pass
cannot be a vacuous one. The desktop client is covered by the same test because it is the same
client: Tauri renders this frontend in a webview and the cookie flow works there unchanged, so
`src-tauri/` handles no credential and needs no keychain.

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

Verified against the tree on **2026-09-09**. Re-verify before trusting this section — it has gone
stale twice now, and the second time two entries in *Still live* had been fixed for days, which
costs a session re-fixing what works. History is kept deliberately: these are the bug *classes*
this code has actually shipped, so they are the ones to check for in review.

**Still live:**

- **The chat transcript is not virtualised.** Every turn of every length renders. Fine at the
  session lengths seen so far; it is the next thing to hurt on a very long conversation.
- **`types/api.ts` (and `conversation.ts`, `catia.ts`) are hand-maintained and nothing
  verifies them** — see Architecture above.
- **The markdown renderer is a deliberate subset** (`lib/markdown.ts`): bold, inline/fenced
  code, lists, links, h1–h3. `_underscore_` emphasis is unsupported **on purpose** — this
  product's vocabulary is `max_von_mises_mpa`, and a correct CommonMark parser italicises the
  middle of it.

**Fixed — do not "fix" again:**

- ~~`scaleFactor` is in the WebGL viewer's effect deps, so every slider tick tears down and
  rebuilds the program, shaders and all four buffers~~ → the GL setup effect's deps are
  `[data, contextLost, glGeneration]`; `scaleFactor` feeds a three-line effect that writes
  `scaleFactorRef` and calls `refreshGeometryRef.current?.(scaleFactor)`, so a tick refreshes
  the one buffer that depends on it (`webgl-stress-viewer.tsx:389-391`).
- ~~Success-path polling is a flat 1500 ms with no overall ceiling; a job stuck in RUNNING polls
  forever~~ → `lib/poll-schedule.ts`, a pure timer-free state machine: 1.5 s growing 1.35× to a
  15 s ceiling, `POLL_GIVE_UP_MS` of 30 minutes measured from the **first** poll (not the last,
  so backoff cannot stretch the deadline), 3 consecutive errors before surfacing. Tested by
  driving it directly — keep it free of React and timers, that is why it is testable.
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
- `components/ui/` holds `button`, `input`, `select`, `pill`, `page-shell` and `icons`, exported
  through `ui/index.ts` — **check it before hand-rolling a primitive** (this line claimed "only
  `button` and `input`" until 2026-09-09, which is exactly how a page grows its own select). Put
  the next shared primitive there and add it to the barrel, rather than growing another ad-hoc
  Tailwind blob in a page

## Testing

- vitest + jsdom, setup in `src/test/setup.ts`, config in `vitest.config.ts`
- 384 tests across `src/lib/`, `src/components/`, `src/hooks/` and `src/app/`. Component tests exist now
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
- Don't render `cancelled` as a failure, or group it with `failed` in any count
- Don't paint an unmeasured assertion or an unconverged number green
- Don't write docs content into `/docs` — it is derived from `app/handbook/`, where the guides'
  routes are checked against the running router

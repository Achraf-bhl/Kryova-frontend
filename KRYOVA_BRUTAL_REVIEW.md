# Kryova — Brutal Honest Review

**Date:** 2026-08-29
**Scope:** Full audit of `Kryova-frontend` + `Kryova-backend`, every critical claim verified by hand against the actual tree, plus internet research on CATIA automation, AI-CAD competitors, LLM-agent engineering, AI+FEA products, and agent security.
**Method:** Two deep code audits (one per repo) + a research sweep, cross-checked. Every damning claim below was re-verified by running the code or reading the exact lines cited.

---

## OVERALL SCORE: 42 / 100

Your own `KRYOVA_STATE_OF_THE_PROJECT.md` says 74/100. That number is fiction at the current HEAD.

Here is the honest split:

| Dimension | Score | One-line verdict |
|---|---|---|
| **Code craft** (line-by-line quality) | 65/100 | Genuinely above average — the solver, blob store, auth core, and prompts are real engineering |
| **Product that actually runs** | 30/100 | Backend HEAD does not boot; two flagship features are façades |
| **Security posture** | 35/100 | Good session layer undermined by a live leaked production credential |
| **CATIA integration** (the pitch) | 8/100 | Three disconnected artifacts; zero working end-to-end path, even mocked |
| **AI layer** | 50/100 | Strong loop + prompts; flagship tool is a no-op; no context/cost management |
| **FEA/physics** | 70/100 | The most defensible part — verified, honest, correctly limited |
| **Ops/CI/deploy** | 15/100 | CI is red and copy-pasted wrong; no deploy story; tests hit prod DB |

**The defining problem is not skill — it's honesty of state.** The gap between what the READMEs/state-doc/UI claim and what actually executes is the single biggest risk to this project. The last backend commit shipped without ever being run. The CATIA panel ships to every user's project page and can only ever show an error. The AI tells users their simulation is running when nothing was queued.

---

## 🔥 THE FIVE THINGS THAT MUST HAPPEN BEFORE ANYTHING ELSE

### 1. ROTATE THE NEON DATABASE PASSWORD. TODAY.

Verified this morning: the production Neon connection string
`postgresql://neondb_owner:npg_Jcu8…@ep-twilight-dust….neon.tech/neondb`
was committed in `c26428c`, modified in `c77e1ba`, untracked in `74b1733` — **all three commits are pushed to GitHub**. `git show c26428c:.env` returns the full password today, and **the identical password is still the live one in your working `.env`**. Untracking the file did not un-leak it. Anyone with repo access (or a scraped clone) owns your database.

Fix: rotate in the Neon console now → update `.env` → optionally scrub history (`git filter-repo`) → delete the contradictory ".env is intentionally tracked" comment from `.gitignore`.

### 2. The backend does not boot. At all.

Verified: `venv/bin/python -c "import app.main"` → `ModuleNotFoundError: No module named 'asyncpg'`.
`app/core/database.py:38` creates an async engine (`postgresql+asyncpg://`) that **zero routes use** — dead code added in the last commit `74b1733` — and `asyncpg` is in neither `requirements.txt` nor the venv. Consequences: the server cannot start, **none of the 182 tests can run** (`conftest.py` imports `app.main`), and CI cannot have been green since that commit. The last commit was pushed without running anything.

Fix: delete the async engine (or add `asyncpg` to requirements if you actually intend to use it). One line. Then run the suite.

### 3. The AI's `run_simulation` tool is a lie.

`app/ai/tools.py:397` returns `{"ready_to_submit": True, "note": "Validated but NOT yet submitted — the API layer submits it"}`. Verified by grep: **nothing anywhere consumes `ready_to_submit`** — the string exists only in that file. Meanwhile the tool's own description (`tools.py:188-194`) tells the model it "Returns immediately with a job id — poll get_simulation for the outcome."

So the model is *engineered* to tell the user their analysis is running — and plausibly to hallucinate a job id — when nothing was ever queued. This is your headline demo flow. Either submit from the tool (it already has the session; the queue is injectable) or rewrite the contract.

### 4. The CATIA integration does not exist. Anywhere. At any layer.

See the dedicated CATIA section below — this is the product's whole pitch and it is currently three artifacts that have never spoken to each other, one of which crashes on invocation **even in mock mode**.

### 5. CI is red and structurally wrong; there is no CI at all on the frontend.

Backend `.github/workflows/ci.yml` contains a `frontend` job (`npm ci`, `package-lock.json` cache) **in a repo with no `package.json`** — copy-pasted from the other repo — and the backend job dies on the asyncpg crash above. The frontend repo has no `.github/` at all (verified). Both repos' clean lint/test/typecheck states are enforced by nothing but discipline, and the docs in both repos have already gone stale twice.

---

# PART 1 — BACKEND REVIEW (4/10)

## 1.1 Architecture — 5/10

**Genuinely good (verified):**
- Real seams as ABCs: `Solver` (`app/solve/base.py`), `JobQueue` (`app/jobs/queue.py:21`), `MediaStore`/`MediaService`, `LLMProvider` (`app/ai/provider.py`). DI via `Depends` throughout.
- The content-addressed blob store is the best code in either repo: SHA-256 keyed, sharded dirs, streaming hash-while-write to temp + atomic `os.replace`, dedup, orphan sweep (`app/media/store.py:78-127`). Resumable chunked uploads with per-chunk retry and checksum verification (`service.py:150-263`).
- Job model: `POST …/simulations` → 202, row committed first, closure to a 2-worker `ThreadPoolExecutor`; worker owns its own session; orphaned RUNNING jobs failed at startup (`app/main.py:48-71`) — thoughtful for an in-process queue.
- Neon-specific care: psycopg3 URL rewrite, `schema_translate_map` (PgBouncer-safe), migrations forced to the non-pooler endpoint, `pool_recycle=280`.

**Broken:**
- **BLOCKER:** dead async engine → app won't import (see item 2 above).
- **The Celery option is fiction.** `celery` isn't in requirements, and `CeleryJobQueue.submit` (`queue.py:74-87`) looks for a `simulation_id` attribute the caller never sets — so `job_queue_backend="celery"` would **silently run the full mesh+solve inline on the request thread**, exactly what the docstring calls unacceptable. Remove the option or build it.
- Single-machine by construction: Neon rows + local-disk blobs + in-process queue. There is no path to a second API node. That's fine for a desktop-ish deployment — but it contradicts the "Cloud FEA Platform" branding.
- `GET /media` is unpaginated (`app/api/routes/media.py:134-142`).

## 1.2 Security — 3/10

**The good — the session core is competent:**
- httpOnly cookies (15-min access / 30-day refresh, refresh path-scoped to `/auth`), CSRF double-submit verified with `secrets.compare_digest` on every non-GET (`app/api/deps.py:76-85`), token `type` claim enforced (a refresh token can't act as an access token), refresh rotation storing only the SHA-256 of the newest token, bcrypt with SHA-256 pre-hash, timing-safe compares, production boot refusing default SECRET_KEY / insecure cookies / http CORS origins (`config.py:134-164`).

**The bad:**
- **Credential leak, unrotated** — see item 1. This alone caps the score.
- **Password-reset tokens are logged at INFO in every environment** (`app/api/routes/auth.py:191-195`), and there is **no email sender anywhere** — so production password reset is either non-functional or an account-takeover primitive for anyone with log access.
- **Mesh-bomb DoS:** `MAX_ELEMENTS` is enforced only **after** gmsh finishes (`app/simulation/runner.py:92-97`); `element_size_mm` has no lower bound relative to geometry; and `POST /simulations` has **no per-user running-job quota** (the agent tool checks; the HTTP route doesn't). A 0.01 mm element size on a large part makes gmsh eat unbounded CPU/RAM before your limit ever fires.
- **Upload memory DoS:** `chunk_size` has no upper bound (`app/schemas/media.py`, `gt=0` only) and `upload_chunk` buffers the entire body with `await request.body()` (`routes/media.py:74-92`) — a client can make the server buffer ~2 GiB of RAM per request. Cap chunk_size (≤64 MiB) and stream to disk.
- Rate limiting keys on client-supplied `X-Forwarded-For` verbatim (`auth.py:70-74`) — spoofable both to bypass your own bucket and to poison others'. The Redis fallback catches bare `Exception` silently.
- OpenAPI docs served unconditionally in production (`main.py:74-78`).
- One `refresh_token_hash` column per user = exactly one session; logging in on a second device silently kills the first. Legitimate design, but undocumented.

**Agent authorization — mostly right, credit where due:** every tool is constructed with the authenticated user and filters `owner_id == self.user.id` (`tools.py:83-95`); the model never supplies an owner id; mutating tools are schema-hidden AND dispatch-blocked without `allow_mutations` (`tools.py:410-427`). Two caveats: the frontend's `allow_mutations` is a sticky checkbox (consent is per-mode, not per-action), and the module docstring advertises a `delete_simulation` tool that doesn't exist.

## 1.3 Performance / Scalability — 4/10

- **gmsh is a process-global singleton behind a module lock** (`gmsh_mesher.py:24`): exactly one meshing operation per process, ever, regardless of `JOB_WORKERS=2`. Your queue has two workers and a one-lane bridge.
- `GET …/surface` materialises the whole `.npz` into Python lists + JSON on every request, no caching/ETag (`simulations.py:126-139`). The new `/surface/binary` endpoint (packed float32/uint32, ~8× smaller) is the right idea — but JSON remains the default path.
- The solver itself is well-optimised: vectorised assembly (`einsum`, coo→csr), `spsolve` under 100k DOF, ILU-preconditioned CG above, equilibrium residual check post-solve.
- Indexes are right (composite `(project_id, created_at)` on hot lists, unique `(conversation_id, sequence)`); no N+1 found.
- No caching layer of any kind; Redis only used for rate limiting.
- Conversation replay grows O(n) tokens per turn forever — see AI section.

## 1.4 AI layer — 5/10

**Strong:**
- Provider abstraction is clean: one ABC (`complete` schema-constrained + `chat` tool loop), three implementations (Ollama/Anthropic/OpenAI), one vendor-aware factory, `strictify()` correctly closing schemas on a deep copy. Error taxonomy maps to 503/422/502.
- Agent loop design is right: `MAX_STEPS=8`, per-result truncation at 6,000 chars, tool exceptions become `is_error` results the model can read, **every step persisted before execution** so a crash leaves an honest transcript, tools-withdrawn closing call when the budget runs out (`agent.py:224-343`).
- **Conversations ARE persisted** — real tables with an explicit `sequence` column; a session can resume by id and replay everything including failures. (The frontend throws this away — see Part 2.)
- **The prompts are the best part of the AI layer** (`app/ai/prompts.py`): frozen system prompts for cache stability, a numbered integrity hierarchy ("never compute a physics number"; the one permitted arithmetic step is kg→N with a required recorded assumption), singularity-vs-real-peak guidance, assumption/unresolved separation in load-case drafts, `_result_payload` whitelisting exactly which numbers the model may discuss. This is real prompt engineering, better than most production apps.
- SSE streaming is solid: lifecycle events (`thinking`/`narration`/`tool_start`/`tool_end`/`message`/`done`), conversation id emitted **first** so a dropped stream is resumable, `x-accel-buffering: no`, same cookie+CSRF auth as everything else.

**Broken / missing:**
- **`run_simulation` never submits** — item 3 above. Fatal to the flagship flow.
- **No context-window management.** `_transcript()` (`agent.py:156-181`) replays the entire conversation every turn, forever. No cap, no summarisation, no token counting, no code path for hitting the model's context limit. A long design session will simply die.
- **No token/cost tracking.** All three providers discard the `usage` block. You have no per-user LLM metering at all — the compute you charge for has a limit (`MAX_ELEMENTS`); the compute that costs you money per token has none.
- **The Anthropic provider has likely never made a successful real call.** `complete()` passes `output_config={"format": …, "effort": …}` to `client.messages.create` (`anthropic.py:127-146`) — the SDK isn't installed, no test exercises it. `chat()` also ignores `stop_reason == "max_tokens"` (silently truncated turns).
- **Load-case drafting is broken for STEP/IGES** — the formats real CAD users actually export. Drafting 409s without `stats.bounding_box`, and `inspect()` computes a bounding box **only for STL** (`geometry/inspect.py:30-35`). Your CATIA-adjacent users are exactly the ones locked out.
- No evals of model output quality. The 16 agent tests assert loop invariants against a scripted provider (good!) but nothing would catch `output_config` being wrong or `ready_to_submit` going nowhere.

## 1.5 FEA / Physics — 7/10

The most defensible part of the codebase.

- Units: mm-N-MPa consistently, documented at every boundary. `mass_kg = volume_mm3 * 1e-9 * density_kg_m3` — correct.
- Hand-rolled tet4 linear static on scipy sparse, vectorised; degenerate-element detection; `MatrixRankWarning` promoted to an "under-constrained" error; **explicit equilibrium residual check post-solve** — a discipline most hobby solvers skip.
- Tributary-area force distribution (mesh-independent loads) with an honest warning on fallback; face selectors with tolerance bands.
- gmsh STL classify/reconstruct pipeline including a genuinely clever workaround for gmsh's NUL-header STL sniffing bug.
- Verification: 22 solver + 17 mesh tests against structured meshes with closed-form checks — the right methodology. (Currently unrunnable; see item 2.)

Deductions: ~110 lines of **dead tet10 code** whose docstring falsely claims it's "selected automatically" (the mesher only extracts tet4); tet4 CST elements are stiff in bending and singular peaks drive FoS directly with no convergence assist — mitigated only by prompt-level caveats; `MAX_ELEMENTS` post-hoc (see security).

## 1.6 Testing & Ops — 3/10

- **182 test functions** (your 162+ claim is met) with above-average structure: savepoint-rollback DB fixtures tuned for Neon, scripted-provider agent tests, physics tests needing no DB. **And none of them can run at HEAD.**
- **Tests target the production Neon database** — same `DATABASE_URL`, isolated only by a `kryova_test` schema with `DROP SCHEMA … CASCADE` teardown. One typo and tests are eating production data. CI requires the production connection string as a repo secret. Use a Neon branch — they're free and instant.
- The production "JSON" log formatter uses `%(message)r` → Python repr quotes → **invalid JSON on every line** (`main.py:26-31`). Any log pipeline will reject everything.
- No Dockerfile, no compose, no deploy story. `/health` is a static `{"status":"ok"}` that checks nothing.
- **249 MiB git pack** because 266 MB of copyrighted Dassault CATIA training PDFs were committed then untracked — still fully in history, alongside the `.env`. A `git filter-repo` pass solves both.

---

# PART 2 — FRONTEND REVIEW (5.5/10)

Meta-finding: **your CLAUDE.md "Known landmines" section is stale in the flattering direction** — both "still live" items are actually fixed (`scaleFactor` now uses `bufferSubData` on slider ticks; polling backs off 1.5s→15s with a 30-min ceiling). Also stale: "dependencies are deliberately three packages" (react-query shipped), "21 tests" (28 actual). Your docs drift within days, in both repos, and nothing catches it.

## 2.1 Architecture — 7/10

**Good:** clean Server/Client split (`dashboard/layout.tsx`, `dashboard/page.tsx`, `projects/[projectId]/page.tsx` are Server Components; interactivity in colocated `_components/`); the two-caller rule (browser `api-client.ts` / server `server-api.ts`) is respected with zero stray fetches; `tsc` clean, lint 0 errors, 28/28 tests pass.

**Findings:**
- **HIGH — `@tanstack/react-query` is a dead dependency mounted in the root layout** (`src/app/layout.tsx:26`): not a single `useQuery`/`useMutation` in `src/`. Ships client JS to every route, does nothing, contradicts your own minimalism doctrine.
- **HIGH — no `error.tsx`, `not-found.tsx`, or `global-error.tsx` anywhere.** Backend 500/network-down → Next's unstyled default error page. The client `ErrorBoundary` renders `error.message`, which in production is React's redacted digest.
- **MEDIUM — `catch { notFound() }` around three parallel fetches** (`projects/[projectId]/page.tsx:30-32`): backend down renders as "project not found."
- **MEDIUM — `types/api.ts` drift is already real:** backend `UserRead.is_active` missing client-side; `SimulationRead.result` is `dict[str, Any]` server-side but confidently `StaticResult | null` client-side. Nothing verifies the mirror — exactly the documented risk, already happening.
- **MEDIUM — dashboard header nav uses raw `<a>` tags, not `<Link>`** (`dashboard/layout.tsx:16-30`): every nav click is a full document reload — which, combined with 2.4 below, destroys in-flight AI conversations.
- LOW: dead `GeometryPreview` component; unused delete API methods; create-next-app boilerplate SVGs still in `public/`.

## 2.2 Security — 6.5/10

**Good:** zero `localStorage`, zero `dangerouslySetInnerHTML`/`innerHTML` (all AI output renders as text nodes), security headers exist (nosniff, X-Frame-Options DENY, frame-ancestors 'none'), env hygiene correct (internal URLs stay server-side).

**Findings:**
- **HIGH — no single-flight on token refresh, against a backend that rotates single-use refresh tokens.** `api-client.ts:73-91` fires `/auth/refresh` per-request on 401 with no mutex. `Promise.all` pages (e.g. `simulate/page.tsx:75`) can 401 twice in parallel → two racing refreshes → second one presents a dead token → **user randomly logged out by a timing accident**. Classic rotating-refresh bug class.
- **HIGH — `uploadRequest` has no 401-refresh-retry at all** (`api-client.ts:107-124`). A chunked CAD upload crossing the 15-min token expiry fails on the next chunk. The longest-running requests are the least protected.
- **MEDIUM — `/api/catia/events` is an unauthenticated proxy** to `CATIA_BRIDGE_INTERNAL_URL` — `proxy.ts` only gates `/dashboard/*`, and the route checks nothing.
- **MEDIUM — CSP allows `'unsafe-inline' 'unsafe-eval'` in `script-src`** with no nonce (neuters the CSP), and `connect-src` hardcodes `http://localhost:8000 http://localhost:9100` — any real deployment breaks or gets loosened to `*`.
- LOW: the `?next=` deep-link param is set by the gate and ignored by login; sign-out clears cookies but doesn't navigate (residual data on screen on shared machines).

## 2.3 Performance — 6/10

- **MEDIUM — the WebGL viewer renders every frame, forever**: unconditional rAF loop with a `getBoundingClientRect()` forced-layout read at 60 fps, even when nothing changed (`webgl-stress-viewer.tsx:239-287`). Your own `geometry-preview.tsx:76-84` already implements the dirty-flag pattern — copy it.
- **MEDIUM — the binary surface format's benefit dies at the parse boundary**: `parseBinarySurfaceField` explodes clean `Float32Array`s into millions of boxed `[x,y,z]` tuples, which the viewer immediately `.flat()`s back. Near the 400k-element cap that's several redundant full copies + GC churn. Flow typed arrays end-to-end.
- MEDIUM: every route `force-dynamic` + `no-store` + raw `<a>` nav = full refetch of everything on every navigation.
- LOW: slider `onChange` recomputes normals for the whole mesh per tick on the main thread, unthrottled.

## 2.4 AI / Agent UI — 5.5/10

The streaming pipeline is the best-crafted part of the app — a correct hand-rolled SSE reader (frame buffering across chunk splits, malformed-frame tolerance, an honest comment on why EventSource can't carry the CSRF header), event names verified to match the backend exactly.

- **CRITICAL (product) — conversations are persisted server-side and irrecoverable client-side.** The backend stores every turn including tool calls and exposes `GET /ai/conversations/{id}`. The frontend keeps the conversation id **in a ref, in memory** (`use-agent-chat.ts:32`) — never in the URL, never listed, never re-fetched. A refresh, a header-nav click (full reload!), or a mis-tap on Stop ends the relationship permanently. The backend even emits `start` first specifically so a dying stream "leaves a resumable conversation rather than an orphan" — and the frontend orphans it anyway. There's also no conversation-list endpoint, so history is write-only. **This is your "conversation continuity" answer: the backend has it, the frontend throws it away.**
- **MEDIUM — an `error` event strands the live steps** stuck on "running" with no retry affordance; only `done` folds steps into a turn.
- **MEDIUM — `done` folds steps into "the last assistant turn" by scanning backwards** — a turn with no message attaches its steps to the *previous* exchange. Also a `setTurns` nested inside a `setLiveSteps` updater (impure updater anti-pattern).
- LOW: single-line `<input>` with an `e.shiftKey` check that can never matter in an `<input>`; field disabled while busy (can't compose the next message); assistant markdown renders raw as plain text; array indices as React keys.
- **Credit:** the result-interpretation panel is well done — on-demand (no silent model call on page view), verdict/severity maps, trade-offs deliberately never hidden, schema matches backend field-for-field.

## 2.5 CATIA bridge panel — 2/10

See Part 3. The UI itself (state machine, event list capped at 50, honest error copy) is good work — for a service that exists nowhere.

## 2.6 Testing — 4/10

- 28 real passing tests in 4 files; `agent-step-list.test.tsx` is genuinely good.
- **HIGH — the riskiest logic is untested:** the polling/backoff state machine, the `useAgentChat` event-folding reducer, `parseBinarySurfaceField` (one wrong byte-stride renders garbage stress fields), the chunked-upload loop, `proxy.ts`, both auth pages. Your own history (mass ×1000 bug, auth spinner bug) proves these ship.
- **HIGH — no CI** (`.github/` absent — verified). **MEDIUM — zero e2e.**

## 2.7 UX / Product — 5/10

- **HIGH — solver warnings are never shown.** `StaticResult.warnings: string[]` is fetched and dropped; the results page renders 8 stat cards and no warnings. For an FEA product, hiding solver warnings is a trust problem, not a nicety. (`volume_mm3` and `mesh_stats` likewise never rendered.)
- **HIGH — the onboarding wizard is unreachable.** `/setup` (137 lines: platform detect, WebGL + API health checks, retry, install hints) has **zero inbound links**. A first-run user with a dead backend sees a failed login, never the page built to diagnose exactly that.
- MEDIUM: no delete/rename anywhere in the UI (API methods exist, unused); everything fetches `page_size=50` with no pager — the 51st project silently doesn't exist; no `aria-live` anywhere (streamed agent messages and status flips are invisible to screen readers); canvases have no role/label and are pointer-only.
- Good marks: real empty states, skeletons that mirror final layout, upload progress, `element_size_mm` cost warning surfaced, mm-N-MPa discipline respected everywhere.

---

# PART 3 — THE CATIA INTEGRATION: REALITY vs. CLAIM (1/10)

**Direct answer to "how does a chat prompt become a real-time CATIA update": it doesn't. There is no connection between the agent and CATIA at all.** No CATIA tool in the agent's toolbox. No CATIA endpoint in `app/api`. Grep for "catia" in backend `app/` hits only the *format-rejection* messages (the backend actively refuses `.CATPart` uploads).

What exists is three disconnected artifacts:

### Artifact 1 — `scripts/catia_bridge/catia_bridge.py` (backend, 213 lines)
A CLI wrapping `win32com` `CATIA.Application` (the COM/VBA automation surface — the right choice, incidentally). But:
- **It crashes on invocation, even in mock mode.** `get_active_document()` (line 67) and `read_parameters()` (line 78) are instance methods defined **without `self`** — verified by reading the file. `params --read` and `daemon` mode die with `TypeError` every time. This code has never been run once.
- The `daemon` subcommand accepts `--api-url` and the README promises it "posts new geometry versions to Kryova API endpoints" — **the loop body contains no HTTP call whatsoever.** It reads parameters and sleeps.
- No design-table code exists despite the README's "Design Table Automation" bullet.
- Mock `export_cad` fabricates a one-point STEP file.

### Artifact 2 — the frontend panel
`catia-bridge-panel.tsx` + `use-catia-bridge.ts` + `catia-bridge.ts` + `/api/catia/events/route.ts` + `types/catia.ts`: polls `GET http://localhost:9100/status`, subscribes to an SSE relay of `:9100/events`, renders four typed event kinds (`geometry_exported`, `parameters_changed`, `design_table_updated`, `simulation_requested`), version badge, last-activity. **Nothing in either repo serves port 9100** (verified by grep across both trees). The Python script has no HTTP server. The panel sits in **the top slot of every project page**, above geometry and simulations — a permanent error banner in your primary workflow. And its "reconnect" logic only retries when an EventSource exists in CLOSED state; on the guaranteed failure path (status fetch fails, no EventSource ever created) **it never retries at all**.

### Artifact 3 — the Tauri shell
A WebView around the Next app whose CSP allows `localhost:3000/8000/11434` — **not 9100**. So even the desktop wrapper that would plausibly host the bridge doesn't permit talking to it. No CATIA-specific commands.

### Also: 266 MB of copyrighted Dassault CATIA training PDFs
committed to git (now untracked, still in history — the 249 MiB pack), presumably RAG fodder for the FAISS layer in `app/media/vectors.py`, which is itself built and wired to nothing.

### What the research says you should build instead (this is the actual good news)

The pattern is **solved** and you're closer than you think — the frontend already defines the protocol; nobody built the server for it.

1. **Right API surface: COM Automation on CATIA V5 via [pycatia](https://github.com/evereux/pycatia)** (typed Python over the whole Automation model). Not CAA RADE (licensing + partner agreement + C++), not Knowledgeware-first (extra licenses), and **not 3DEXPERIENCE REST** — those web APIs are PLM data-plane (search, lifecycle, STEP export), not live feature creation. Note: V5 macros do NOT port to 3DEXPERIENCE unmodified; treat 3DX as a separate adapter later.
2. **Right topology: the bridge dials OUT.** A Windows tray daemon (Python+pycatia, optionally hosted in your existing Tauri shell) opens a persistent **outbound authenticated WebSocket** to your backend. The LLM stays server-side; the bridge executes a fixed tool vocabulary against the local CATIA session. No inbound ports, no VPN. AWS documented this exact cloud-agent→local-tools bridge pattern ([AgentCore MCP bridge](https://aws.amazon.com/blogs/machine-learning/how-we-built-an-mcp-bridge-to-give-our-agentcore-hosted-ai-agent-access-to-local-mcp-tools/)).
3. **CATIA is effectively single-threaded** (COM STA; the core doesn't parallelise) — plan for exactly **one agent driving one CATIA instance**, serialize every call through one queue, add per-call timeouts and a watchdog for the classic killer: a modal dialog blocking the session.
4. **Don't invent the tool taxonomy.** Open-source CATIA MCP servers already exist and prove feasibility: [daiemon12/catia-v5-mcp-server](https://github.com/daiemon12/catia-v5-mcp-server) (78 tools: documents/sketching/part design/GSD/assembly/measure/export) and [tongriyaotxt/catia-mcp](https://github.com/tongriyaotxt/catia-mcp) (V5+V6). Borrow the taxonomy; they're single-user desktop toys with no cloud story, no security model, no FEA loop — which is precisely your differentiation.
5. **Prefer semantic, high-leverage tools** — `create_pad(sketch, length_mm)`, `set_parameter(name, value_mm)`, `instantiate_udf(...)` — never raw XYZ coordinate emission (the #1 documented LLM-CAD failure mode: models are bad at sketch-plane origins, 3D transforms, reference frames; keep coordinate math *inside* tools). PowerCopy/UDF instantiation is the classic way to give an agent high-leverage building blocks.
6. **Close the loop with perception:** after every mutating op, capture a CATIA viewport screenshot (COM can) + measurements and feed them back. The [FEA-as-feedback paper](https://arxiv.org/html/2605.17448v2) found visual self-inspection was one of the biggest single wins — and found frontier models meet only **~20% of typed engineering requirements** on realistic briefs, so build the repair loop, not one-shot generation.
7. **Real-time updates in the UI:** your bridge daemon publishes events upstream over its WebSocket; the backend fans out to the browser over the SSE plumbing you already have for chat. The event types in `types/catia.ts` are a perfectly good starting schema — they just need a server.

### The bridge security model (before you build it, not after)
- **Never expose an "eval VBScript" tool** (pycatia's `SystemService.Evaluate` is an arbitrary-code-execution primitive — prompt injection would turn it into RCE on an engineer's workstation).
- Fixed allowlisted tool vocabulary, **re-validated at the bridge** — the LLM's output is untrusted input to the bridge, always.
- Pair the daemon to an account with a one-time code → per-device token; every tool-call message carries user/session/device identity.
- **Treat CATIA-derived text (part names, parameter comments, file metadata) as untrusted** — indirect prompt injection via tool results succeeds 24–47% of the time against ReAct-style agents (OWASP LLM01:2025).
- If the bridge ever serves localhost HTTP: bind 127.0.0.1, validate `Host`/`Origin`, require auth even on localhost — DNS-rebinding against localhost bridges is real and recent (CVE-2025-66414, MCP TypeScript SDK).
- Tiered confirmation enforced **at the bridge**, not just the UI: auto-approve reads/measures; notify-and-undoable for add-feature/set-parameter; hard-block pending a signed user approval for delete/overwrite/batch.
- Checkpointing: don't trust CATIA's undo stack — snapshot documents (save-as versioned / STEP export) at op boundaries, keep the op transcript as a replayable script, offer "restore to checkpoint" in the UI.

---

# PART 4 — WHAT THE MARKET SAYS YOU'RE MISSING

### 4.1 The competitive window is real — and open
The incumbents' shipping AI mostly **doesn't drive geometry**: Onshape AI Advisor is a documentation/guidance chatbot (FeatureScript generation is roadmap), Siemens NX "Design Copilot" and SolidWorks AURA are the same chat-panel pattern. Autodesk announced neural-CAD foundation models (AU 2025) but that's Fusion/Forma. [Zoo](https://zoo.dev/machine-learning-api) is the closest architectural cousin (text-to-CAD as code generation in their KCL language, WebSocket copilot endpoints, a per-response feedback endpoint — copy that feedback idea day one; it's your eval data). **An agent that actually models in a live CATIA seat is genuinely differentiated. Nobody ships the full loop you're pitching: interpret FEA → propose geometry change → apply in CATIA → re-run.** The academic frontier says that loop is exactly where the value is. But a differentiated pitch with a non-functional implementation is worse than no pitch — it burns trust with the exact buyer (engineers) who will test it.

### 4.2 AI + FEA interpretation — table stakes you're missing (all cheap, no ML needed)
1. Max von Mises **with location** (hotspot on the part) and margin vs material yield — a verdict ("FoS 1.4 against 250 MPa yield"), not a stat dump. *(Your interpretation prompt partially does this — good.)*
2. **Singularity awareness**: flag peaks at point constraints/re-entrant corners as artifacts. *(Your prompt has this — genuinely ahead of the curve. But the UI hides `warnings[]`, which undercuts it completely.)*
3. **Mesh-convergence caveat**: state element size, offer a refinement re-run; never present a single-mesh peak as truth.
4. Sanity checks: reaction forces ≈ applied loads (you compute the residual — surface it!), rigid-body-mode detection.
5. Next-action suggestions (thicken rib X, add fillet Y) — the natural bridge back to the CATIA agent.

SimScale (Physics AI + agentic setup assistants), Ansys SimAI, Altair PhysicsAI, Neural Concept all sell surrogate speed + multi-physics; you can't compete on breadth. Interpretation honesty + the CATIA loop is your lane. Note their universal caveat discipline: "AI prediction ≠ validated physics" — mirror it.

### 4.3 Agent engineering best practices you're not following yet
- **Context management** (you have none): keep a canonical "model state" doc (feature tree, parameters, named selections) re-injected fresh each turn; compact at logical breakpoints; don't trust the transcript as state ([Anthropic: effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)).
- **Tool results should return rich post-state** (updated feature-tree summary + bounding box + mass), not "OK" ([Anthropic: writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)).
- **Eval harness before scaling tool count**: fixed prompt suite → execute → invalidity rate, Chamfer distance, voxel IoU, plus FEA spot checks (the field-standard metrics from Text2CAD-Bench/CADTests). You currently have zero output-quality evals.
- **Token/cost accounting per user** — you meter FEA compute (`MAX_ELEMENTS`) but not LLM spend. Backwards.
- ~15–30 semantic tools is the sweet spot; one giant `run_script` is ungateable, 100 micro-tools is token burn.

---

# PART 5 — SCORE RECONCILIATION & ROADMAP

### Why 42/100 when your state-doc says 74
The state-doc's 74 was written before the last commits and graded the *design*. This review grades the *product*: an unbootable backend HEAD (−), a live leaked credential (−), a flagship AI tool that no-ops (−), a CATIA integration that is UI-only (−), red/copy-pasted CI (−). The craft is real — the solver, blob store, session layer, and prompts would pass review at a good company. The state is not. Fix the five fires and this jumps to ~60 in a week without writing a single new feature.

### Week 1 — stop the bleeding (all one-liners or near)
1. Rotate the Neon password; `git filter-repo` the `.env` + 266 MB PDFs out of history.
2. Delete the dead async engine (or add asyncpg). Run the 182 tests. Fix what's red.
3. Make `run_simulation` actually submit, or change its contract honestly.
4. Feature-flag the CATIA panel off (or move it behind "experimental"), fix its non-retrying reconnect.
5. Fix backend CI (delete the phantom frontend job), add frontend CI (lint+tsc+vitest), point tests at a Neon **branch**, not prod.
6. Stop logging password-reset tokens; fix the invalid-JSON log formatter.

### Weeks 2–3 — make what exists trustworthy
7. Frontend: persist conversation id in the URL (`?c=<id>`), rehydrate from `GET /ai/conversations/{id}`, add a conversation-list endpoint + sidebar. The backend already did the hard part.
8. Single-flight mutex on token refresh; add 401-retry to `uploadRequest`/`requestBuffer`.
9. Show `StaticResult.warnings` on the results page. Add `error.tsx`/`not-found.tsx`. Link `/setup` from the login error path.
10. Cap `chunk_size`; pre-estimate element count from bbox before meshing; per-user running-job quota on `POST /simulations`.
11. Context-window management + usage tracking in the agent loop; verify the Anthropic provider against the real SDK; bounding boxes for STEP/IGES (locks out your target users today).
12. Component tests for the polling state machine, agent event reducer, and binary parser.

### Weeks 4–8 — build the actual product
13. The bridge daemon: Python + pycatia, outbound WSS, the `types/catia.ts` event schema as the wire protocol, one serialized CATIA call queue, ~15 semantic tools borrowed from daiemon12's taxonomy, screenshot+measure feedback, document-snapshot checkpoints, tiered approvals enforced at the bridge.
14. Wire bridge events → backend → existing SSE → the panel that's been waiting for it.
15. Close the loop: FEA interpretation → proposed parameter change → user approves → bridge applies in CATIA → re-export → re-mesh → re-run. That demo is the company.
16. Eval harness (prompt suite + invalidity/CD/IoU + FEA checks) + Zoo-style thumbs-up/down feedback capture.

---

## Final word

You have the skeleton of something genuinely differentiated — real physics with honest limits, a well-designed agent loop with the best prompt engineering layer I've seen in a project this size, and a persistence model built for exactly the conversation continuity you asked about. What you don't have is a product that runs, a secret that's safe, or a CATIA integration that exists. The pattern across both repos is the same: **beautifully engineered components, shipped without ever being executed, described by documentation that flatters them.** The fix isn't more features. It's: run what you ship, ship what runs, and make the docs tell the truth.

**42/100 — with a clear, cheap path to 60, and a real (currently empty) moat at 80.**

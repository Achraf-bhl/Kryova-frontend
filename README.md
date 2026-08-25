<div align="center">

<img src="src-tauri/icons/128x128.png" width="96" alt="Kryova" />

# Kryova

**AI-native CAD + FEA.** Upload a part, describe how it is loaded, run a
linear-static analysis, and read the stress in a 3D viewer.

Desktop app for Windows, macOS and Linux · Runs its AI locally by default

</div>

---

## What it does

1. **Upload CAD** — STEP, IGES or STL.
2. **Describe the load case** — either fill in the form, or write it in plain
   English and let the AI draft it ("clamp the base, hang 40 kg off the top").
3. **Solve** — a real linear-static FE run, meshed with gmsh, verified against
   closed-form solutions.
4. **Read the result** — von Mises stress on a WebGL viewer, plus an AI
   interpretation of what the numbers mean and what to change.

Units are **mm-N-MPa** end to end. Nothing is converted anywhere, because in a
self-consistent unit system there is nothing to convert.

## Your AI, your machine

The AI features run against **whatever model you choose**. The default is a
local one:

| `AI_PROVIDER` | What it uses | API key | Data leaves your machine |
|---|---|---|---|
| `ollama` *(default)* | Any model you have pulled locally | none | **No** |
| `openai_compatible` | LM Studio, vLLM, llama.cpp, Groq, OpenRouter, OpenAI | depends | depends |
| `anthropic` | Hosted Claude | yes | yes |

CAD geometry is proprietary engineering IP, so the shipping default keeps it on
your machine. Switching provider is one environment variable — see
[`../Kryova-backend/.env.example`](../Kryova-backend/.env.example).

The AI is deliberately fenced in: it may **explain** solver output, never
produce its own. It cannot compute, convert or adjust a physics number, and
every figure it quotes has to appear in the solver result verbatim.

---

## Install

### Windows — the installer

Download `Kryova_0.1.0_x64_en-US.msi` from
[Releases](https://github.com/Achraf-bhl/Kryova-frontend/releases) and run it.

> **Status:** the MSI is configured (WiX bundle, upgrade code, branded icon)
> but **has not been built or install-tested yet** — that needs a Windows
> machine and there is no Windows runner in CI. Build it yourself with
> `npm run desktop:msi` on Windows, or use the source install below.

### Build the desktop app from source

Prerequisites: **Node 20+**, **Rust** (`rustup`), and the platform webview:

| OS | Extra prerequisite |
|---|---|
| Windows | [WebView2](https://developer.microsoft.com/microsoft-edge/webview2/) (preinstalled on Win 11) + Visual Studio C++ Build Tools |
| macOS | Xcode Command Line Tools |
| Linux | `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev` |

```bash
git clone https://github.com/Achraf-bhl/Kryova-frontend.git
cd Kryova-frontend
npm install

npm run desktop:dev      # run it
npm run desktop:build    # bundle for the current OS
npm run desktop:msi      # Windows only: just the .msi
```

Installers land in `src-tauri/target/release/bundle/`.

### Run it as a web app instead

```bash
npm install && npm run dev   # http://localhost:3000
```

The backend is a **separate repo** — [`../Kryova-backend`](../Kryova-backend) —
and has to be running for anything past the login screen. Its README covers
Postgres and the AI provider.

---

## Development

```bash
npm run dev          # dev server
npm run build        # production build
npm run test         # vitest
npm run lint         # eslint
npx tsc --noEmit     # typecheck
npm run setup        # checks Node, installs, writes .env.local, builds
```

`npm run test`, `npm run lint` and `npx tsc --noEmit` are all clean. Keep them
that way — CI runs all three on every push.

### Layout

```
src/
  proxy.ts                 Next 16 middleware (renamed from middleware.ts) —
                           cookie-gates /dashboard/*
  app/                     App Router. Layouts and the dashboard page are
                           Server Components; interactive leaves are
                           "use client" under _components/
  components/              webgl-stress-viewer, geometry-preview, ui/
  lib/api-client.ts        browser → backend (cookies + CSRF + refresh retry)
  lib/server-api.ts        Server Components → backend (forwards cookies)
  types/api.ts             hand-written mirrors of the backend Pydantic schemas
src-tauri/                 desktop shell (Rust) + installer config + icons
```

### Deliberately three dependencies

`next`, `react`, `react-dom`. No UI kit, no three.js, no fetch library, no
state manager — the 3D viewer is hand-written WebGL 1. Before adding a
dependency, check whether the hand-rolled equivalent should be extended
instead. The minimalism is the design, not an oversight.

---

## Contributing

Run `npm run lint`, `npx tsc --noEmit` and `npm run test` before opening a PR.
`AGENTS.md` is written by `next dev` — commit it, don't strip it.

## License

[MIT](LICENSE)

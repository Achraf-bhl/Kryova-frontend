#!/usr/bin/env node

import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { platform } from "node:os";

const isWindows = platform() === "win32";
const isMacOS = platform() === "darwin";
const isLinux = platform() === "linux";

console.log("╔══════════════════════════════════╗");
console.log("║        Kryova — Setup            ║");
console.log("╚══════════════════════════════════╝");
console.log("");

// Detect platform
const platformName = isWindows ? "Windows" : isMacOS ? "macOS" : isLinux ? "Linux" : platform();
console.log(`Platform: ${platformName}`);
console.log("");

// Check Node.js
let nodeVersion;
try {
  nodeVersion = execSync("node --version", { encoding: "utf8" }).trim();
  console.log(`✅ Node.js ${nodeVersion}`);
} catch {
  console.error("❌ Node.js is not installed.");
  console.error("");
  if (isWindows) {
    console.error("Install with: winget install OpenJS.NodeJS.LTS");
  } else if (isMacOS) {
    console.error("Install with: brew install node");
    console.error("Or download from https://nodejs.org/en/download/");
  } else {
    console.error("Install with your package manager:");
    console.error("  sudo apt install nodejs npm   # Ubuntu/Debian");
    console.error("  sudo dnf install nodejs npm   # Fedora");
    console.error("Or download from https://nodejs.org/en/download/");
  }
  process.exit(1);
}

// Check npm
try {
  const npmVersion = execSync("npm --version", { encoding: "utf8" }).trim();
  console.log(`✅ npm ${npmVersion}`);
} catch {
  console.error("❌ npm not found. It should come bundled with Node.js.");
  process.exit(1);
}

console.log("");

// The backend sets itself up, and this script asks it to rather than doing it again.
//
// It used to repeat that work, and the copy had gone wrong three ways at once: it made
// `.venv` where the desktop shell (`src-tauri/src/lib.rs`) looks for `venv`, it wrote a
// `DATABASE_URL=sqlite:///…` that the backend refuses at startup (`_require_postgres`),
// and it asked for Python 3.11 where the backend needs 3.12. A second implementation of
// "set up the backend" is a second thing to keep correct, and it is always the one that
// rots. The backend's own script is idempotent, never overwrites `.env`, and says what
// to set; `docs/LOCAL_POSTGRES.md` there says how to get the database it needs.
const backendDir = resolve(process.cwd(), "..", "Kryova-backend");
if (existsSync(backendDir)) {
  console.log("\nSetting up the backend with its own setup script…");
  const backendSetup = isWindows
    ? `powershell -ExecutionPolicy Bypass -File "${resolve(backendDir, "scripts", "setup.ps1")}"`
    : `bash "${resolve(backendDir, "scripts", "setup.sh")}"`;
  try {
    execSync(backendSetup, { stdio: "inherit", cwd: backendDir });
  } catch {
    console.error("❌ The backend setup did not finish. Its output above says why;");
    console.error("   fix that and run it again from the Kryova-backend folder.");
  }
} else {
  console.log("\nNo Kryova-backend folder next to this one, so the backend was not set up.");
  console.log("The frontend needs a running backend: clone it beside this folder and run its");
  console.log("scripts/setup.sh (scripts\\setup.ps1 on Windows).");
}

console.log("");
console.log("Installing frontend dependencies…");
try {
  execSync("npm install", { stdio: "inherit" });
} catch {
  console.error("❌ Failed to install dependencies.");
  process.exit(1);
}

// .env.local setup
const envPath = resolve(".env.local");
if (!existsSync(envPath)) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => {
    rl.question("Enter the backend API URL [http://127.0.0.1:8000/api/v1]: ", res);
    rl.close();
  });
  const apiUrl = answer.trim() || "http://127.0.0.1:8000/api/v1";
  writeFileSync(envPath, `NEXT_PUBLIC_API_URL=${apiUrl}\n`, "utf-8");
  console.log("✅ Created .env.local");
} else {
  console.log("✅ .env.local already exists — skipping.");
}

console.log("");
console.log("Building the frontend…");
try {
  execSync("npm run build", { stdio: "inherit" });
} catch {
  console.error("❌ Build failed.");
  process.exit(1);
}

console.log("");
console.log("╔═══════════════════════════════════╗");
console.log("║          Setup complete!          ║");
console.log("╚═══════════════════════════════════╝");
console.log("");
console.log("To start the app:");
console.log("  npm run dev        (development)");
console.log("  npm start          (production, after build)");
console.log("");
console.log("Open http://127.0.0.1:3000 in your browser. Use the numeric address, not");
console.log("localhost: a browser resolves localhost to ::1 first, and the backend listens");
console.log("on IPv4 only, so the page would load and every API call would fail.");

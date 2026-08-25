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

// Check Python (for backend)
let pythonCmd = isWindows ? "python" : "python3";
let pythonVersion;
try {
  pythonVersion = execSync(`${pythonCmd} --version`, { encoding: "utf8" }).trim();
  console.log(`✅ ${pythonVersion}`);
} catch {
  pythonCmd = "python";
  try {
    pythonVersion = execSync(`${pythonCmd} --version`, { encoding: "utf8" }).trim();
    console.log(`✅ ${pythonVersion}`);
  } catch {
    console.error("❌ Python 3.11+ not found.");
    if (isWindows) console.error("Install with: winget install Python.Python.3.12");
    else if (isMacOS) console.error("Install with: brew install python@3.12");
    else console.error("Install with: sudo apt install python3 python3-pip");
  }
}

// Backend setup
const backendDir = resolve(process.cwd(), "..", "Kryova-backend");
if (existsSync(backendDir)) {
  console.log("\nSetting up backend…");
  const venvDir = resolve(backendDir, ".venv");
  if (!existsSync(venvDir)) {
    try {
      execSync(`${pythonCmd} -m venv "${venvDir}"`, { stdio: "inherit", cwd: backendDir });
      console.log("✅ Created virtual environment");
    } catch {
      console.error("❌ Failed to create virtual environment.");
    }
  } else {
    console.log("✅ Virtual environment already exists");
  }

  const pipPath = isWindows
    ? resolve(venvDir, "Scripts", "pip")
    : resolve(venvDir, "bin", "pip");
  if (existsSync(pipPath) || isWindows) {
    const pipCmd = isWindows ? `"${resolve(venvDir, 'Scripts', 'pip')}"` : `"${resolve(venvDir, 'bin', 'pip')}"`;
    try {
      execSync(`${pipCmd} install -q -r requirements.txt -r requirements-dev.txt`, {
        stdio: "inherit",
        cwd: backendDir,
      });
      console.log("✅ Installed backend dependencies");
    } catch {
      console.error("❌ Failed to install backend dependencies.");
    }
  }

  const envPath = resolve(backendDir, ".env");
  if (!existsSync(envPath)) {
    writeFileSync(envPath, "DATABASE_URL=sqlite:///./kryova_dev.db\nSECRET_KEY=dev-only-change-in-production\n", "utf-8");
    console.log("✅ Created .env with SQLite for local development");
  }
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
    rl.question("Enter the backend API URL [http://localhost:8000/api/v1]: ", res);
    rl.close();
  });
  const apiUrl = answer.trim() || "http://localhost:8000/api/v1";
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
console.log("Open http://localhost:3000 in your browser.");

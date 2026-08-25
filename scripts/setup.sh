#!/usr/bin/env bash
set -euo pipefail

echo "╔══════════════════════════════════╗"
echo "║   Kryova — Setup (Linux/macOS)   ║"
echo "╚══════════════════════════════════╝"
echo ""

# Check Node.js
if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version)
  echo "✅ Node.js ${NODE_VERSION}"
else
  echo "❌ Node.js is not installed."
  echo ""
  echo "Install it with one of:"
  echo "  macOS:    brew install node"
  echo "  Linux:    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install nodejs"
  echo "            or: sudo apt install nodejs npm"
  echo "  Or visit: https://nodejs.org/en/download/"
  exit 1
fi

# Check npm
if command -v npm &>/dev/null; then
  echo "✅ npm $(npm --version)"
else
  echo "❌ npm not found. It should come bundled with Node.js."
  exit 1
fi

echo ""
echo "Installing frontend dependencies…"
npm install

if [ ! -f ".env.local" ]; then
  echo ""
  read -rp "Enter the backend API URL [http://localhost:8000/api/v1]: " API_URL
  API_URL="${API_URL:-http://localhost:8000/api/v1}"
  echo "NEXT_PUBLIC_API_URL=${API_URL}" > .env.local
  echo "✅ Created .env.local"
fi

echo ""
echo "Building the frontend…"
npm run build

echo ""
echo "╔═══════════════════════════════════╗"
echo "║          Setup complete!          ║"
echo "╚═══════════════════════════════════╝"
echo ""
echo "To start the app:"
echo "  npm run dev        (development)"
echo "  npm start          (production, after build)"
echo ""
echo "Open http://localhost:3000 in your browser."

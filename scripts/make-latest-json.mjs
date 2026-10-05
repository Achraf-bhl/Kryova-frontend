/**
 * Write the `latest.json` the Tauri updater reads (ROAD_TO_10 4.6).
 *
 * The updater's endpoint serves a small static document naming the newest version and, for
 * each platform, the artefact's URL and its signature. This builds it from a signed MSI.
 *
 * **Signing is not done here, and not in CI.** The private key is the one thing whose loss
 * ends updates for every installed copy for ever: an installed app trusts one public key and
 * has no other way to learn another. It stays offline (`Kryova-backend/docs/DESKTOP_RELEASE.md`), the MSI is
 * signed by a person with `tauri signer sign`, and this script only assembles what that
 * produced. It never reads a private key.
 *
 * **It performs, at publish time, the check each customer's app would perform at install
 * time.** The app is built with `requireSignedVersion`, so it refuses an update whose
 * signature does not record the version the endpoint announces. Finding that out from a
 * customer's machine is the expensive way to learn it, so this refuses to write a file whose
 * signature was made for a different version.
 *
 *   node scripts/make-latest-json.mjs --msi <file.msi> --version 0.3.0 --channel stable \
 *        --url https://updates.example.com/kryova/0.3.0/Kryova_0.3.0_x64_en-US.msi \
 *        [--sig <file>] [--notes "..."] [--out latest.json]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { CHANNELS } from "./desktop-config.mjs";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** The version recorded in a signature's trusted comment, or null. `sig` is the .sig file's text. */
export function signedVersion(sig) {
  let decoded;
  try {
    decoded = Buffer.from(sig.trim(), "base64").toString("utf8");
  } catch {
    return null;
  }
  const comment = decoded.split("\n").find((line) => line.startsWith("trusted comment:"));
  if (!comment) return null;
  // Tab-separated `key:value` pairs: `timestamp:...\tfile:...\tversion:...`.
  for (const field of comment.slice("trusted comment:".length).trim().split("\t")) {
    if (field.startsWith("version:")) return field.slice("version:".length);
  }
  return null;
}

/**
 * @param {{ version: string, channel: string, url: string, signature: string, notes?: string, now?: Date }} input
 */
export function latestJson({ version, channel, url, signature, notes = "", now = new Date() }) {
  const match = SEMVER.exec(version);
  if (!match) throw new Error(`"${version}" is not a semantic version (1.2.3, or 1.2.3-beta.1).`);
  if (!CHANNELS.includes(channel)) {
    throw new Error(`Channel must be one of ${CHANNELS.join(", ")}; got "${channel}".`);
  }
  const prerelease = match[4] !== undefined;
  // A beta build on the stable channel reaches every customer who never opted in.
  if (channel === "stable" && prerelease) {
    throw new Error(`${version} is a pre-release and cannot be published on the stable channel.`);
  }
  if (channel === "beta" && !prerelease) {
    throw new Error(`${version} has no pre-release tag; a beta channel version is 1.2.3-beta.N.`);
  }
  if (!url.startsWith("https://")) throw new Error(`The artefact URL must be https; got ${url}.`);

  const sig = signature.trim();
  if (!sig) throw new Error("The signature file is empty. Sign the MSI with `tauri signer sign` first.");
  const recorded = signedVersion(sig);
  if (recorded === null) {
    throw new Error(
      "The signature does not record a version in its trusted comment. An app built with " +
        "requireSignedVersion refuses it. Sign with a Tauri CLI recent enough to record one.",
    );
  }
  if (recorded.replace(/^v/, "") !== version) {
    throw new Error(
      `The MSI was signed for version ${recorded}, not ${version}. Publishing it would have every ` +
        "installed app refuse the update; sign the right file.",
    );
  }

  return {
    version,
    notes,
    pub_date: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
    platforms: { "windows-x86_64": { signature: sig, url } },
  };
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--") || argv[index + 1] === undefined) throw new Error(`Bad argument near ${key}`);
    values[key.slice(2)] = argv[index + 1];
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ["msi", "version", "channel", "url"]) {
    if (!args[required]) throw new Error(`--${required} is required.`);
  }
  const document = latestJson({
    version: args.version,
    channel: args.channel,
    url: args.url,
    notes: args.notes ?? "",
    signature: readFileSync(args.sig ?? `${args.msi}.sig`, "utf8"),
  });
  const out = args.out ?? "latest.json";
  writeFileSync(out, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`wrote ${out} for ${args.version} on the ${args.channel} channel`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

/**
 * The Tauri configuration that differs between a developer's build and a release (ROAD_TO_10
 * 4.1, 4.6), as a JSON object handed to `tauri build --config`.
 *
 * `tauri.conf.json` is what every `tauri dev` and `cargo check` reads, so nothing in it may
 * need a staged bundle or a signing key to exist: a resource path that is missing fails the
 * build script, and an updater with no public key fails the app at startup. What a release
 * adds therefore lives here, computed from the environment, and is merged over the file at
 * build time.
 *
 * **Nothing is defaulted that someone else owns.** The update host is where the release
 * manager publishes, and the public key belongs to whoever holds the signing key; inventing
 * either would build an updater that trusts, or asks, the wrong party. Both are refused when
 * missing. There is deliberately no default URL.
 *
 * **Signing (4.5) is configured here and performed by the certificate.** The overlay names a
 * certificate by thumbprint; the key never leaves the Windows store (or a hardware token behind
 * it), and nothing in this repository can sign without one. Buying the certificate is the
 * owner's; this is the half that does not need it.
 */

export const CHANNELS = ["stable", "beta"];

/** A certificate's SHA-1 thumbprint as the Windows store shows it. */
const THUMBPRINT = /^[0-9A-Fa-f]{40}$/;

/** A minisign public key as Tauri carries it: base64, a few dozen characters at least. */
const PUBKEY = /^[A-Za-z0-9+/]{40,}={0,2}$/;

/**
 * @param {{ bundled?: boolean, env?: Record<string, string | undefined> }} options
 * @returns {Record<string, unknown>} the overlay, `{}` when nothing differs
 */
export function releaseOverlay({ bundled = false, env = process.env } = {}) {
  const overlay = {};

  if (bundled) {
    // The staged tree, `bundle/` -> the resource directory's root, so the installed app has
    // `frontend/`, `runtime/`, `backend/` and `postgres/` beside the executable
    // (`src-tauri/src/layout.rs` goes looking for exactly those).
    overlay.bundle = { resources: { "bundle/": "" } };
  }

  const pubkey = (env.KRYOVA_UPDATER_PUBKEY ?? "").trim();
  const base = (env.KRYOVA_UPDATE_BASE_URL ?? "").trim().replace(/\/+$/, "");
  const channel = (env.KRYOVA_UPDATE_CHANNEL ?? "stable").trim();

  if (pubkey || base) {
    if (!pubkey || !base) {
      throw new Error(
        "An updater needs both KRYOVA_UPDATER_PUBKEY and KRYOVA_UPDATE_BASE_URL; one was set " +
          "and not the other. Set both, or neither for a build with no updater.",
      );
    }
    if (!PUBKEY.test(pubkey)) {
      throw new Error(
        "KRYOVA_UPDATER_PUBKEY is not a base64 public key. It is the contents of the .pub " +
          "file `tauri signer generate` wrote, not the private key and not a path.",
      );
    }
    if (!base.startsWith("https://")) {
      throw new Error(
        `KRYOVA_UPDATE_BASE_URL must be https (got ${base}). The updater refuses a plain ` +
          "http endpoint, and an app built to use one would never update.",
      );
    }
    if (!CHANNELS.includes(channel)) {
      throw new Error(`KRYOVA_UPDATE_CHANNEL must be one of ${CHANNELS.join(", ")}; got ${channel}.`);
    }
    overlay.plugins = {
      updater: {
        pubkey,
        // One endpoint per channel, and a build belongs to one channel: moving between them
        // is installing the other build, which is honest, and cannot be done by accident.
        endpoints: [`${base}/${channel}/latest.json`],
        // The endpoint's JSON is not signed -- only the artefact is -- so without this a
        // crafted response can pair a new version number with an older release's valid
        // signature and downgrade the app. With it the client compares the announced
        // version to the one recorded in the signature itself.
        requireSignedVersion: true,
        windows: { installMode: "passive" },
      },
    };
  }

  const thumbprint = (env.KRYOVA_SIGN_THUMBPRINT ?? "").trim().replace(/\s+/g, "");
  const timestamp = (env.KRYOVA_SIGN_TIMESTAMP_URL ?? "").trim();
  const command = (env.KRYOVA_SIGN_COMMAND ?? "").trim();
  if (command && (thumbprint || timestamp)) {
    throw new Error(
      "KRYOVA_SIGN_COMMAND and KRYOVA_SIGN_THUMBPRINT are two ways to sign and a build uses " +
        "one. Set the command (a cloud or token signer) or the thumbprint (a certificate in " +
        "the Windows store), not both.",
    );
  }
  if (command) {
    // A certificate issued today lives in a hardware module or a vendor's cloud, not in a
    // file, so what signs is often a vendor's tool. Tauri calls it once per binary with the
    // binary's path in place of `%1`; a command without the placeholder would "sign" nothing
    // and the build would carry on. Tauri splits the string on single spaces (read from
    // tauri-utils 2.9.3's `CustomSignCommandConfig::Command`), so an argument that itself
    // holds a space -- a path under `Program Files` -- cannot be written this way; put the
    // signer on a path without one, or in a small wrapper script.
    if (!command.includes("%1")) {
      throw new Error(
        "KRYOVA_SIGN_COMMAND must contain %1, where Tauri puts the path of the file to sign. " +
          "Without it the command runs on nothing and every binary ships unsigned.",
      );
    }
    overlay.bundle = {
      ...(overlay.bundle ?? {}),
      windows: { signCommand: command },
    };
  } else if (thumbprint || timestamp) {
    if (!thumbprint || !timestamp) {
      throw new Error(
        "Signing needs both KRYOVA_SIGN_THUMBPRINT and KRYOVA_SIGN_TIMESTAMP_URL; one was set " +
          "and not the other. A signature with no timestamp stops being valid the day the " +
          "certificate expires, and every installed copy would then read as unsigned.",
      );
    }
    if (!THUMBPRINT.test(thumbprint)) {
      throw new Error(
        "KRYOVA_SIGN_THUMBPRINT is not a SHA-1 certificate thumbprint (40 hex characters). " +
          "It names a certificate already imported into the Windows certificate store, not a " +
          "file and not a password.",
      );
    }
    if (!/^https?:\/\//.test(timestamp)) {
      throw new Error(`KRYOVA_SIGN_TIMESTAMP_URL must be an http(s) URL; got ${timestamp}.`);
    }
    overlay.bundle = {
      ...(overlay.bundle ?? {}),
      windows: {
        certificateThumbprint: thumbprint,
        digestAlgorithm: "sha256",
        timestampUrl: timestamp,
        // RFC 3161 (signtool /tr), which is what a current timestamp authority serves; the
        // older Authenticode protocol (/t) is the other reading of the same URL.
        tsp: true,
      },
    };
  }

  return overlay;
}

/** Deep-merge-free JSON for `--config`: Tauri merges it over `tauri.conf.json` (RFC 7396). */
export function overlayArgument(overlay) {
  return Object.keys(overlay).length === 0 ? [] : ["--config", JSON.stringify(overlay)];
}

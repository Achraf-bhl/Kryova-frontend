fn main() {
    // `src/lib.rs` bakes these in with `option_env!`, so they are read at
    // *compile* time. Cargo does not know that on its own: without these lines
    // it happily reuses a cached build of this crate when the variables change,
    // and the binary silently keeps whatever paths it was first compiled with
    // -- or none, in which case the installed app starts neither the backend
    // nor the frontend nor the CATIA bridge, and shows an empty window.
    //
    // That is not hypothetical; it shipped once. `scripts/desktop-build.mjs`
    // now sets all three, and these lines make cargo notice.
    println!("cargo:rerun-if-env-changed=KRYOVA_FRONTEND_DIR");
    println!("cargo:rerun-if-env-changed=KRYOVA_BACKEND_DIR");
    println!("cargo:rerun-if-env-changed=KRYOVA_NODE");
    tauri_build::build()
}

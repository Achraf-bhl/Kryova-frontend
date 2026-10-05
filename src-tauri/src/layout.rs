//! Where the shell finds what it starts, and which of two layouts it is running in.
//!
//! Until ROAD_TO_10 4.1-4.3 the shell could only start servers from two checkouts whose
//! paths `scripts/desktop-build.mjs` baked into the binary, so an installer built anywhere
//! started nothing anywhere else. An installed app now carries what it runs beside its
//! executable -- a Next standalone server, a Node runtime, an embedded CPython with every
//! wheel, and the PostgreSQL binaries -- and this module decides which situation the
//! process is in and where each piece is.
//!
//! **Three answers, in this order, and the order is the design:**
//!
//! 1. `KRYOVA_FRONTEND_DIR` / `KRYOVA_BACKEND_DIR` in the environment name a checkout, and
//!    that wins over everything. A developer pointing an installed build at their own tree
//!    is asking for exactly that, and nothing else is a way to test a fix without
//!    rebuilding the installer.
//! 2. A complete bundle in the resource directory. It beats the paths baked in at build
//!    time, because those name the *build* machine: on any other machine they do not exist,
//!    and on the build machine they point at a checkout the installer was meant to replace.
//! 3. The baked checkout paths, which is the only layout there was before this module.
//!
//! **Something half there is reported, not skipped.** `Detection::Broken` lists what is
//! wrong -- the files a bundle lacks, or a checkout variable that names nothing -- because
//! falling through to "no layout" turns a broken install into the shell's old failure: a
//! 90-second wait and a window that failed to load, with nothing naming the cause.
//!
//! No Tauri in this file, so the rules can be tested with a bare `rustc --test
//! src/layout.rs` on any machine; the crate itself needs a webview toolchain to link.

use std::path::{Path, PathBuf};

/// Everything an installed app ships, relative to the resource directory. The staging
/// script (`scripts/stage-desktop.mjs`) and `src/lib/desktop-bundle.test.ts` read these
/// same names, so a rename in one place cannot leave the other shipping a file nobody finds.
pub const FRONTEND_DIR: &str = "frontend";
pub const FRONTEND_SERVER: &str = "frontend/server.js";
pub const BACKEND_DIR: &str = "backend";
pub const BACKEND_ENTRY: &str = "backend/app/desktop.py";
pub const POSTGRES_DIR: &str = "postgres";

/// An installed app: every piece beside the executable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Bundle {
    pub root: PathBuf,
    pub node: PathBuf,
    pub frontend_dir: PathBuf,
    pub frontend_server: PathBuf,
    pub python: PathBuf,
    pub backend_dir: PathBuf,
    pub postgres_bin: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Layout {
    Bundled(Bundle),
    /// Two sibling checkouts, as on a developer machine.
    Checkout { frontend: PathBuf, backend: PathBuf },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Detection {
    Found(Layout),
    /// Something was asked for or partly installed and cannot be used. Each entry is a
    /// sentence a person can act on.
    Broken(Vec<String>),
    Nothing,
}

fn exe(os: &str, stem: &str) -> String {
    if os == "windows" {
        format!("{stem}.exe")
    } else {
        stem.to_owned()
    }
}

/// The bundle's files that must exist, as paths relative to the resource directory.
fn required(os: &str) -> Vec<String> {
    let python = if os == "windows" {
        "backend/python/python.exe".to_owned()
    } else {
        "backend/python/bin/python3".to_owned()
    };
    vec![
        FRONTEND_SERVER.to_owned(),
        format!("runtime/node/{}", exe(os, "node")),
        python,
        BACKEND_ENTRY.to_owned(),
        format!("{POSTGRES_DIR}/bin/{}", exe(os, "pg_ctl")),
    ]
}

/// The bundle's `pg_ctl`, which the shell runs once more on the way out.
pub fn pg_ctl(bundle: &Bundle, os: &str) -> PathBuf {
    bundle.postgres_bin.join(exe(os, "pg_ctl"))
}

/// What a resource directory is missing of a bundle. Empty means complete.
pub fn missing(root: &Path, os: &str) -> Vec<String> {
    required(os)
        .into_iter()
        .filter(|relative| !root.join(relative).is_file())
        .collect()
}

fn bundle_at(root: &Path, os: &str) -> Bundle {
    let python = if os == "windows" {
        root.join("backend").join("python").join("python.exe")
    } else {
        root.join("backend").join("python").join("bin").join("python3")
    };
    Bundle {
        root: root.to_path_buf(),
        node: root.join("runtime").join("node").join(exe(os, "node")),
        frontend_dir: root.join(FRONTEND_DIR),
        frontend_server: root.join(FRONTEND_SERVER),
        python,
        backend_dir: root.join(BACKEND_DIR),
        postgres_bin: root.join(POSTGRES_DIR).join("bin"),
    }
}

/// A resource directory is "trying to be a bundle" when any of its pieces exists, so a
/// plain checkout-mode run, whose resource directory holds neither, is not told that a
/// bundle it never had is broken.
fn looks_like_a_bundle(root: &Path) -> bool {
    root.join(FRONTEND_DIR).is_dir()
        || root.join(BACKEND_DIR).is_dir()
        || root.join(POSTGRES_DIR).is_dir()
}

/// One checkout directory, or the reason there is not one.
///
/// The environment variable if it is set, otherwise the path baked in when the shell was
/// compiled. A variable that names something that is not a directory is **not** "or"-ed
/// with the baked path: it is a typo, and falling back would start a different tree than
/// the one the person pointed at, who would then debug the tree they meant.
fn checkout_dir(
    get: &impl Fn(&str) -> Option<String>,
    var: &str,
    baked: Option<&str>,
) -> Result<Option<PathBuf>, String> {
    if let Some(named) = get(var).filter(|value| !value.is_empty()) {
        let dir = PathBuf::from(&named);
        return if dir.is_dir() {
            Ok(Some(dir))
        } else {
            Err(format!("{var} is set to {named}, which is not a directory"))
        };
    }
    Ok(baked.map(PathBuf::from).filter(|dir| dir.is_dir()))
}

pub fn detect(
    resource_dir: Option<&Path>,
    get: impl Fn(&str) -> Option<String>,
    baked_frontend: Option<&str>,
    baked_backend: Option<&str>,
    os: &str,
) -> Detection {
    let named = |var: &str| get(var).filter(|value| !value.is_empty()).is_some();
    let frontend = checkout_dir(&get, "KRYOVA_FRONTEND_DIR", baked_frontend);
    let backend = checkout_dir(&get, "KRYOVA_BACKEND_DIR", baked_backend);

    // 1. A checkout somebody named. An unusable name is an error, not a hint to look elsewhere.
    if named("KRYOVA_FRONTEND_DIR") || named("KRYOVA_BACKEND_DIR") {
        let problems: Vec<String> =
            [&frontend, &backend].into_iter().filter_map(|r| r.as_ref().err().cloned()).collect();
        if !problems.is_empty() {
            return Detection::Broken(problems);
        }
        if let (Ok(Some(frontend)), Ok(Some(backend))) = (frontend, backend) {
            return Detection::Found(Layout::Checkout { frontend, backend });
        }
        return Detection::Broken(vec![
            "KRYOVA_FRONTEND_DIR and KRYOVA_BACKEND_DIR must both name a checkout; \
             one of them is missing"
                .to_owned(),
        ]);
    }

    // 2. A bundle beside the executable.
    if let Some(root) = resource_dir {
        if looks_like_a_bundle(root) {
            let absent = missing(root, os);
            return if absent.is_empty() {
                Detection::Found(Layout::Bundled(bundle_at(root, os)))
            } else {
                Detection::Broken(
                    absent
                        .into_iter()
                        .map(|file| format!("the installed app is missing {file}"))
                        .collect(),
                )
            };
        }
    }

    // 3. The checkouts this build was made from.
    match (frontend, backend) {
        (Ok(Some(frontend)), Ok(Some(backend))) => {
            Detection::Found(Layout::Checkout { frontend, backend })
        }
        _ => Detection::Nothing,
    }
}

/// Where the application keeps what must survive an upgrade: the database cluster, the
/// uploaded files, the credentials. `%LOCALAPPDATA%\Kryova` on Windows, beside the
/// `logs` directory the support notes already name.
///
/// Never the install directory: `C:\Program Files` is read-only to the person running the
/// app, and replaced wholesale by an upgrade.
pub fn data_home_from(get: impl Fn(&str) -> Option<String>, os: &str) -> Option<PathBuf> {
    let nonempty = |key: &str| get(key).filter(|value| !value.is_empty());
    if let Some(explicit) = nonempty("KRYOVA_HOME") {
        return Some(PathBuf::from(explicit));
    }
    match os {
        "windows" => {
            let base = nonempty("LOCALAPPDATA").map(PathBuf::from).or_else(|| {
                nonempty("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("Local"))
            })?;
            Some(base.join("Kryova"))
        }
        "macos" => {
            let home = nonempty("HOME")?;
            Some(PathBuf::from(home).join("Library").join("Application Support").join("Kryova"))
        }
        _ => {
            let data = nonempty("XDG_DATA_HOME").map(PathBuf::from).or_else(|| {
                nonempty("HOME").map(|home| PathBuf::from(home).join(".local").join("share"))
            })?;
            Some(data.join("kryova"))
        }
    }
}

/// The environment a bundled backend is started with. A pure function so the contract with
/// `app/desktop.py` is pinned by a test rather than by two files agreeing by luck.
///
/// `PYTHONDONTWRITEBYTECODE` because the install directory is not writable and the
/// staging step precompiled everything already; `PYTHONNOUSERSITE` so a package the user
/// happens to have installed cannot shadow one the bundle was tested with; `PYTHONUTF8`
/// because Python on Windows otherwise reads text files as cp1252.
pub fn backend_env(bundle: &Bundle, home: &Path, port: u16) -> Vec<(String, String)> {
    vec![
        ("KRYOVA_HOME".into(), home.display().to_string()),
        ("KRYOVA_POSTGRES_BIN_DIR".into(), bundle.postgres_bin.display().to_string()),
        ("KRYOVA_API_PORT".into(), port.to_string()),
        ("PYTHONDONTWRITEBYTECODE".into(), "1".into()),
        ("PYTHONNOUSERSITE".into(), "1".into()),
        ("PYTHONUTF8".into(), "1".into()),
    ]
}

/// The environment the bundled Next server is started with. `HOSTNAME` is how a standalone
/// `server.js` is told which interface to bind: unset it listens on every one, which would
/// put the shell's own server -- and the diagnostics route -- on the LAN.
pub fn frontend_env(port: u16, api_port: u16) -> Vec<(String, String)> {
    vec![
        ("PORT".into(), port.to_string()),
        ("HOSTNAME".into(), "127.0.0.1".into()),
        ("NODE_ENV".into(), "production".into()),
        ("KRYOVA_DESKTOP".into(), "1".into()),
        // Read by the server components, which call the API from the Next process. The
        // browser-side URL was inlined at build time (`NEXT_PUBLIC_API_URL`).
        ("API_INTERNAL_URL".into(), format!("http://127.0.0.1:{api_port}/api/v1")),
    ]
}

/// Where the backend keeps its database cluster, and what marks one as made. Both are
/// `app/core/local_cluster.py`'s: `<home>/pgdata` and the `PG_VERSION` file `initdb` writes
/// last. Drift between the two would show as a first launch that is never recognised as
/// one, so the backend's `tests/test_desktop.py` reads this file and holds both names.
pub fn postgres_data(home: &Path) -> PathBuf {
    home.join("pgdata")
}

/// Whether this launch has to make the database. It is the slow one -- `initdb`, then every
/// migration, on a machine whose antivirus is also scanning a fresh install -- and is the
/// difference between a window in a few seconds and a window in a few minutes.
pub fn is_first_run(home: &Path) -> bool {
    !postgres_data(home).join("PG_VERSION").is_file()
}

/// How long to wait for the servers before giving up on them. A launch after the first
/// opens an existing database, so a minute and a half is generous; the first has a database
/// to create, and a machine that is slow at that must not be told its install is broken
/// while it is still working.
pub fn startup_secs(first_run: bool) -> u64 {
    if first_run {
        600
    } else {
        90
    }
}

/// The page the window shows while the backend is still starting. It is served by the
/// frontend, which is up in a fraction of a second, and it polls the API itself and moves
/// on to the app when the API answers -- so the first launch shows a message rather than a
/// hidden window that looks like a double-click that did nothing.
pub const STARTING_PAGE: &str = "/setup?starting=1";

/// `pg_ctl stop` for the cluster this install owns. The postmaster that `pg_ctl start`
/// leaves running outlives the backend that started it, and on Windows a running
/// `postgres.exe` holds the install directory open, so the next upgrade or uninstall fails
/// on "files in use" with nothing saying a database is why.
pub fn postgres_stop_args(data: &Path) -> Vec<String> {
    vec![
        "stop".into(),
        "-D".into(),
        data.display().to_string(),
        "-m".into(),
        "fast".into(),
        "-t".into(),
        "20".into(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("kryova-layout-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn touch(root: &Path, relative: &str) {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"").unwrap();
    }

    fn full_bundle(os: &str) -> PathBuf {
        let root = scratch();
        for relative in required(os) {
            touch(&root, &relative);
        }
        root
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn a_complete_bundle_is_found_on_windows() {
        let root = full_bundle("windows");

        let found = detect(Some(&root), no_env, None, None, "windows");

        match found {
            Detection::Found(Layout::Bundled(bundle)) => {
                assert_eq!(bundle.node, root.join("runtime/node/node.exe"));
                assert_eq!(bundle.python, root.join("backend/python/python.exe"));
                assert_eq!(bundle.postgres_bin, root.join("postgres/bin"));
                assert_eq!(bundle.frontend_server, root.join("frontend/server.js"));
            }
            other => panic!("expected a bundle, got {other:?}"),
        }
    }

    #[test]
    fn a_bundle_missing_its_python_says_so_instead_of_being_skipped() {
        let root = full_bundle("windows");
        fs::remove_file(root.join("backend/python/python.exe")).unwrap();

        let found = detect(Some(&root), no_env, None, None, "windows");

        assert_eq!(
            found,
            Detection::Broken(vec!["the installed app is missing backend/python/python.exe".to_owned()])
        );
    }

    #[test]
    fn a_bundle_missing_everything_but_one_folder_lists_every_missing_file() {
        let root = scratch();
        fs::create_dir_all(root.join("frontend")).unwrap();

        match detect(Some(&root), no_env, None, None, "windows") {
            Detection::Broken(absent) => {
                assert_eq!(absent.len(), required("windows").len());
                assert!(absent
                    .contains(&"the installed app is missing postgres/bin/pg_ctl.exe".to_owned()));
            }
            other => panic!("expected Broken, got {other:?}"),
        }
    }

    #[test]
    fn a_resource_directory_with_no_bundle_in_it_is_not_called_broken() {
        // A checkout-mode run has a resource directory too. Reporting a bundle it never
        // had as broken would send a developer looking for a file they do not need.
        let root = scratch();
        let frontend = scratch();
        let backend = scratch();

        let found = detect(
            Some(&root),
            no_env,
            Some(frontend.to_str().unwrap()),
            Some(backend.to_str().unwrap()),
            "windows",
        );

        assert_eq!(found, Detection::Found(Layout::Checkout { frontend, backend }));
    }

    #[test]
    fn a_named_checkout_beats_a_complete_bundle() {
        let root = full_bundle("windows");
        let frontend = scratch();
        let backend = scratch();
        let (f, b) = (frontend.display().to_string(), backend.display().to_string());
        let env = move |key: &str| match key {
            "KRYOVA_FRONTEND_DIR" => Some(f.clone()),
            "KRYOVA_BACKEND_DIR" => Some(b.clone()),
            _ => None,
        };

        let found = detect(Some(&root), env, None, None, "windows");

        assert_eq!(found, Detection::Found(Layout::Checkout { frontend, backend }));
    }

    #[test]
    fn a_complete_bundle_beats_the_paths_baked_in_at_build_time() {
        // The baked paths name the build machine. On a customer's machine they do not
        // exist; on the build machine they are the checkout the installer replaces.
        let root = full_bundle("windows");
        let frontend = scratch();
        let backend = scratch();

        let found = detect(
            Some(&root),
            no_env,
            Some(frontend.to_str().unwrap()),
            Some(backend.to_str().unwrap()),
            "windows",
        );

        assert!(matches!(found, Detection::Found(Layout::Bundled(_))), "got {found:?}");
    }

    #[test]
    fn a_misspelled_checkout_variable_is_an_error_not_a_hint_to_look_elsewhere() {
        // Falling back to the baked path -- or to a complete bundle -- would start a
        // different tree than the one the person pointed at, and they would debug the
        // tree they meant.
        let baked_frontend = scratch();
        let baked_backend = scratch();
        let root = full_bundle("windows");
        let typo = |key: &str| match key {
            "KRYOVA_FRONTEND_DIR" => Some("/this/does/not/exist".to_owned()),
            _ => None,
        };

        let found = detect(
            Some(&root),
            typo,
            Some(baked_frontend.to_str().unwrap()),
            Some(baked_backend.to_str().unwrap()),
            "windows",
        );

        assert_eq!(
            found,
            Detection::Broken(vec![
                "KRYOVA_FRONTEND_DIR is set to /this/does/not/exist, which is not a directory"
                    .to_owned()
            ])
        );
    }

    #[test]
    fn naming_only_one_checkout_when_the_other_is_unknown_is_an_error() {
        let frontend = scratch();
        let f = frontend.display().to_string();
        let only_frontend = move |key: &str| match key {
            "KRYOVA_FRONTEND_DIR" => Some(f.clone()),
            _ => None,
        };

        match detect(None, only_frontend, None, None, "windows") {
            Detection::Broken(reasons) => assert!(reasons[0].contains("must both name a checkout")),
            other => panic!("expected Broken, got {other:?}"),
        }
    }

    #[test]
    fn nothing_anywhere_is_nothing() {
        assert_eq!(detect(None, no_env, None, None, "windows"), Detection::Nothing);
    }

    #[test]
    fn the_unix_layout_uses_bin_python3_and_no_exe_suffix() {
        let root = full_bundle("linux");

        match detect(Some(&root), no_env, None, None, "linux") {
            Detection::Found(Layout::Bundled(bundle)) => {
                assert_eq!(bundle.python, root.join("backend/python/bin/python3"));
                assert_eq!(bundle.node, root.join("runtime/node/node"));
            }
            other => panic!("expected a bundle, got {other:?}"),
        }
    }

    #[test]
    fn user_data_lives_under_localappdata_never_beside_the_executable() {
        let env = |key: &str| match key {
            "LOCALAPPDATA" => Some(r"C:\Users\ana\AppData\Local".to_owned()),
            _ => None,
        };

        let home = data_home_from(env, "windows").unwrap();

        assert_eq!(home, PathBuf::from(r"C:\Users\ana\AppData\Local").join("Kryova"));
    }

    #[test]
    fn an_explicit_home_wins_on_every_platform() {
        let env = |key: &str| match key {
            "KRYOVA_HOME" => Some("/srv/kryova".to_owned()),
            "HOME" => Some("/home/ana".to_owned()),
            _ => None,
        };

        assert_eq!(data_home_from(env, "linux"), Some(PathBuf::from("/srv/kryova")));
        assert_eq!(data_home_from(env, "windows"), Some(PathBuf::from("/srv/kryova")));
    }

    #[test]
    fn the_unix_data_home_follows_xdg_then_home() {
        let xdg = |key: &str| match key {
            "XDG_DATA_HOME" => Some("/x".to_owned()),
            "HOME" => Some("/home/ana".to_owned()),
            _ => None,
        };
        let home_only = |key: &str| match key {
            "HOME" => Some("/home/ana".to_owned()),
            _ => None,
        };

        assert_eq!(data_home_from(xdg, "linux"), Some(PathBuf::from("/x/kryova")));
        assert_eq!(
            data_home_from(home_only, "linux"),
            Some(PathBuf::from("/home/ana/.local/share/kryova"))
        );
    }

    #[test]
    fn the_backend_is_told_where_everything_is_and_to_leave_the_install_directory_alone() {
        let root = full_bundle("windows");
        let Detection::Found(Layout::Bundled(bundle)) = detect(Some(&root), no_env, None, None, "windows")
        else {
            panic!("no bundle");
        };

        let env: std::collections::HashMap<_, _> =
            backend_env(&bundle, Path::new("/data/Kryova"), 8000).into_iter().collect();

        assert_eq!(env["KRYOVA_HOME"], "/data/Kryova");
        assert_eq!(env["KRYOVA_API_PORT"], "8000");
        assert_eq!(env["KRYOVA_POSTGRES_BIN_DIR"], root.join("postgres/bin").display().to_string());
        // The install directory is read-only to the user.
        assert_eq!(env["PYTHONDONTWRITEBYTECODE"], "1");
        assert_eq!(env["PYTHONNOUSERSITE"], "1");
        assert_eq!(env["PYTHONUTF8"], "1");
    }

    #[test]
    fn the_bundled_frontend_binds_loopback_only() {
        let env: std::collections::HashMap<_, _> = frontend_env(3000, 8000).into_iter().collect();

        assert_eq!(env["HOSTNAME"], "127.0.0.1");
        assert_eq!(env["PORT"], "3000");
        assert_eq!(env["KRYOVA_DESKTOP"], "1");
        assert_eq!(env["API_INTERNAL_URL"], "http://127.0.0.1:8000/api/v1");
    }

    #[test]
    fn the_first_launch_is_the_one_with_no_cluster_and_waits_longer() {
        let home = scratch();
        assert!(is_first_run(&home));

        let data = postgres_data(&home);
        fs::create_dir_all(&data).unwrap();
        // A folder `initdb` started and did not finish is still a first run: PG_VERSION is
        // written last, and a cluster without it cannot be started.
        assert!(is_first_run(&home));

        fs::write(data.join("PG_VERSION"), b"17\n").unwrap();
        assert!(!is_first_run(&home));

        assert_eq!(startup_secs(false), 90);
        assert!(startup_secs(true) >= 300, "a first run has a database to create");
        assert!(startup_secs(true) > startup_secs(false));
    }

    #[test]
    fn pg_ctl_is_the_bundles_own_and_carries_the_platforms_suffix() {
        let windows = full_bundle("windows");
        let Detection::Found(Layout::Bundled(bundle)) = detect(Some(&windows), no_env, None, None, "windows")
        else {
            panic!("no bundle");
        };
        assert_eq!(pg_ctl(&bundle, "windows"), windows.join("postgres/bin/pg_ctl.exe"));
        assert_eq!(pg_ctl(&bundle, "linux"), windows.join("postgres/bin/pg_ctl"));
    }

    #[test]
    fn the_cluster_is_where_the_backend_makes_it() {
        assert_eq!(postgres_data(Path::new("/h")), PathBuf::from("/h/pgdata"));
    }

    #[test]
    fn the_database_is_stopped_fast_and_by_name_of_its_directory() {
        let args = postgres_stop_args(Path::new("/h/pgdata"));

        assert_eq!(args[0], "stop");
        let at = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].as_str());
        assert_eq!(at("-D"), Some("/h/pgdata"));
        assert_eq!(at("-m"), Some("fast"));
        assert_eq!(at("-t"), Some("20"));
    }

    #[test]
    fn the_starting_page_is_a_page_the_frontend_serves() {
        assert!(STARTING_PAGE.starts_with("/setup"));
        assert!(STARTING_PAGE.contains("starting=1"));
    }
}

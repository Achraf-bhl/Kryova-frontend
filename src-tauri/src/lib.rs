//! Kryova desktop shell.
//!
//! Thin on purpose: the application is the Next.js frontend talking to the
//! Kryova backend over HTTP. This crate exists to give that a native window,
//! a taskbar identity and an installer, not to hold product logic.
//!
//! It does own one thing a browser cannot: starting the two local servers the
//! app needs (FastAPI on 8000, Next on 3000) and stopping them again on exit,
//! so launching Kryova is a single click rather than two terminals.
//!
//! Where those servers come from is `layout.rs`'s decision: an installed app carries them
//! beside the executable (a Node runtime, the Next standalone server, an embedded CPython
//! and PostgreSQL), and a developer machine runs them from two checkouts.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, RunEvent};
use tauri_plugin_deep_link::DeepLinkExt;

mod layout;
mod links;
mod logs;
mod status;

use layout::{Detection, Layout};

const BACKEND_PORT: u16 = 8000;
const FRONTEND_PORT: u16 = 3000;

/// The event the page listens for. It carries **nothing**: links wait in `PendingLinks` and
/// the page collects them with `take_deep_links`, so a link is delivered once however many
/// ways it arrived (a second launch, the OS's own open-url, the first launch's argv) and
/// whether or not the page had loaded when it did.
const DEEP_LINK_EVENT: &str = "kryova:deep-link";

/// Only the servers *this* process started. An already-running `npm run dev`
/// keeps its port and must survive our exit, so it never lands in here.
#[derive(Default)]
struct Servers(Mutex<Vec<Child>>);

/// `kryova://` links received and not yet collected by the page (`links.rs`).
#[derive(Default)]
struct PendingLinks(Mutex<links::Pending>);

/// What to run on the way out to stop the database this install started: `(pg_ctl, data)`.
/// Only set for an installed app, which owns its cluster; a developer's Postgres is theirs.
#[derive(Default)]
struct DatabaseToStop(Mutex<Option<(PathBuf, PathBuf)>>);

/// Where the backend lives. Overridable so a desktop build can point at a
/// remote deployment instead of a local one.
///
/// The numeric address, never `localhost`: WebView2 is Chromium, which resolves
/// `localhost` to `::1` first, and uvicorn is started below on `127.0.0.1` only,
/// so the window loads and every API call then fails with a bare "Failed to
/// fetch". Measured in a browser on the Windows seat (CLAUDE.md, *Driving the
/// GUI* 2a); the installed app is not yet re-measured, which is why this is
/// recorded as unverified on the seat.
fn api_base_url() -> String {
    std::env::var("KRYOVA_API_URL").unwrap_or_else(|_| format!("http://127.0.0.1:{BACKEND_PORT}/api/v1"))
}

#[tauri::command]
fn backend_url() -> String {
    api_base_url()
}

/// Bring the main window forward. A second launch, a click on the tray and a `kryova://`
/// link all end here: there is one Kryova window, and every way of asking for it shows
/// that one.
fn focus_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Hold links and tell the page there is something to collect. A link also brings the window
/// forward: someone who clicked it wants to see the result, not a tray icon.
fn receive_links(app: &AppHandle, received: impl IntoIterator<Item = String>) {
    let mut kept = false;
    if let Ok(mut pending) = app.state::<PendingLinks>().0.lock() {
        for link in received {
            kept |= pending.push(&link);
        }
    }
    if kept {
        let _ = app.emit(DEEP_LINK_EVENT, ());
        focus_main_window(app);
    }
}

/// The page asks what arrived. Whatever it gets is handed back to it for judging: the shell
/// only checked the shape of the argument (`links.rs`); what a link may do is the page's
/// allow-list (`desktop-powers.ts::parseDeepLink`).
#[tauri::command]
fn take_deep_links(app: AppHandle) -> Vec<String> {
    app.state::<PendingLinks>()
        .0
        .lock()
        .map(|mut pending| pending.take())
        .unwrap_or_default()
}

/// Stop the database this install started. Best effort and bounded: it runs on the way out,
/// and a database that will not stop in `-t 20` seconds is not a reason to hold the quit.
fn stop_database(handle: &AppHandle) {
    let target = handle
        .state::<DatabaseToStop>()
        .0
        .lock()
        .ok()
        .and_then(|mut guard| guard.take());
    let Some((pg_ctl, data)) = target else { return };
    let mut command = Command::new(pg_ctl);
    command.args(layout::postgres_stop_args(&data));
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    match command.output() {
        Ok(output) if output.status.success() => {}
        Ok(output) => shell_note(&format!(
            "pg_ctl stop exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )),
        Err(error) => shell_note(&format!("could not run pg_ctl stop: {error}")),
    }
}

/// The page reports what it knows -- the bridge connected, runs going -- and the tray shows
/// it. The shell does not ask the API itself, because that would mean it held a session
/// (`status.rs`). Cleaned before it reaches the OS.
#[tauri::command]
fn set_tray_status(app: AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(status::tooltip(&text)));
    }
}

fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Kryova", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Kryova", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &quit])?;
    let mut tray = TrayIconBuilder::with_id("main")
        .tooltip(status::DEFAULT)
        .menu(&menu)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

fn detect_layout(resource_dir: Option<PathBuf>) -> Detection {
    layout::detect(
        resource_dir.as_deref(),
        |key| std::env::var(key).ok(),
        option_env!("KRYOVA_FRONTEND_DIR"),
        option_env!("KRYOVA_BACKEND_DIR"),
        std::env::consts::OS,
    )
}

fn port_is_open(port: u16) -> bool {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
}

/// Wait until every port is accepting connections, or the deadline passes.
///
/// One shared deadline, not one each: these start in parallel, so waiting for
/// them in sequence would let a slow backend eat the frontend's whole budget.
///
/// Both ports have to be waited on, and that is the point of this function.
/// Showing the window as soon as *Next* was listening is what put a
/// "Something went wrong" card in front of the user on a cold start: Next is
/// ready in about 200 ms, uvicorn needs several seconds to import numpy, scipy
/// and gmsh and to run its database lifespan, and every dashboard page is a
/// server component that calls the API while it renders. Rendering one in that
/// gap throws, and React reports it as the deliberately opaque minified error
/// #441 -- which says nothing about the backend still starting.
///
/// A listening socket is a sound readiness signal here: uvicorn binds only
/// after its lifespan has completed, so nothing answers the port early.
fn wait_for_ports(ports: &[u16], timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if ports.iter().all(|port| port_is_open(*port)) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Spawn detached from any console, so a packaged launch never flashes a
/// terminal window behind the app.
fn spawn(mut command: Command, log_name: &str) -> Option<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    if let Some((out, err)) = log_targets(log_name) {
        command.stdout(out).stderr(err);
    }
    command.spawn().ok()
}

/// Where a child's output goes, or None if the log file cannot be opened.
///
/// Without this the children are spawned with `CREATE_NO_WINDOW` and no
/// redirect, which sends every line they write to the void. That is fine right
/// up until something breaks: the backend logs its tracebacks to stdout, and
/// when a user asks "what went wrong", the honest answer was that nothing had
/// been kept. Each process gets its own file.
///
/// **Rotated, not truncated** (`logs.rs`). Every launch used to start the file
/// afresh, so relaunching to see whether a crash was a one-off erased the only
/// record of it. The last five launches are kept beside the current one.
fn log_dir() -> Option<PathBuf> {
    let dir = logs::log_dir_from(|key| std::env::var(key).ok(), std::env::consts::OS)?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn log_targets(name: &str) -> Option<(std::fs::File, std::fs::File)> {
    let dir = log_dir()?;
    // Best effort: a failed rotation must never be the reason a window does not open.
    let _ = logs::rotate(&dir, name, logs::KEEP_PREVIOUS);
    let file = std::fs::File::create(dir.join(format!("{name}.log"))).ok()?;
    let clone = file.try_clone().ok()?;
    Some((file, clone))
}

/// A line in `shell.log`, for the failures that happen before any child exists to write
/// its own. Best effort and unrotated: it is written only when something is wrong, so it
/// stays small, and a failure to write it must never be the reason a window does not open.
fn shell_note(message: &str) {
    use std::io::Write;
    if let Some(dir) = log_dir() {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(dir.join("shell.log"))
        {
            let _ = writeln!(file, "{message}");
        }
    }
}

/// The backend. Installed: the embedded interpreter runs `app.desktop`, which creates the
/// database on the first launch, migrates it and then serves. From a checkout: uvicorn from
/// the project venv. Either way the interpreter is invoked directly rather than through a
/// shell so the child stays a single killable process.
fn start_backend(layout: &Layout) -> Option<Child> {
    let mut command = match layout {
        Layout::Bundled(bundle) => {
            let Some(home) = layout::data_home_from(|key| std::env::var(key).ok(), std::env::consts::OS)
            else {
                shell_note("no data directory: neither LOCALAPPDATA nor HOME is set, so the backend has nowhere to keep its database");
                return None;
            };
            let mut command = Command::new(&bundle.python);
            command
                .current_dir(&bundle.backend_dir)
                .arg("-m")
                .arg("app.desktop");
            for (key, value) in layout::backend_env(bundle, &home, BACKEND_PORT) {
                command.env(key, value);
            }
            command
        }
        Layout::Checkout { backend, .. } => {
            let venv_python = backend.join("venv").join("Scripts").join("python.exe");
            let python = if venv_python.is_file() {
                venv_python
            } else {
                PathBuf::from("python")
            };
            let port = BACKEND_PORT.to_string();

            let mut command = Command::new(python);
            command
                .current_dir(backend)
                .arg("-m")
                .arg("uvicorn")
                .arg("app.main:app")
                .arg("--host")
                .arg("127.0.0.1")
                .arg("--port")
                .arg(&port);
            command
        }
    };
    // The same for both: nothing here may widen what the backend listens on.
    command.stdin(std::process::Stdio::null());
    spawn(command, "backend")
}

/// The frontend. Installed: the Next standalone server under the bundled Node. From a
/// checkout: `next start` against the production build, with next's entry script invoked
/// by node directly -- the npm shim would leave an orphan on kill.
fn start_frontend(layout: &Layout) -> Option<Child> {
    let mut command = match layout {
        Layout::Bundled(bundle) => {
            let mut command = Command::new(&bundle.node);
            command.current_dir(&bundle.frontend_dir).arg(&bundle.frontend_server);
            // A standalone `server.js` is told which interface to bind through HOSTNAME
            // (`frontend_env`); unset, it listens on every one.
            for (key, value) in layout::frontend_env(FRONTEND_PORT, BACKEND_PORT) {
                command.env(key, value);
            }
            command
        }
        Layout::Checkout { frontend, .. } => {
            let next_bin = frontend
                .join("node_modules")
                .join("next")
                .join("dist")
                .join("bin")
                .join("next");
            if !next_bin.is_file() {
                return None;
            }
            let node = option_env!("KRYOVA_NODE")
                .map(PathBuf::from)
                .filter(|p| p.is_file())
                .unwrap_or_else(|| PathBuf::from("node"));
            let port = FRONTEND_PORT.to_string();

            let mut command = Command::new(node);
            command
                .current_dir(frontend)
                .arg(next_bin)
                .arg("start")
                .arg("-p")
                .arg(&port)
                // Loopback only. `next start` listens on every interface by default, so
                // without this anything on the LAN could reach the shell's own server,
                // including the diagnostics route below. 127.0.0.1 rather than `localhost`
                // for the usual reason: Chromium resolves `localhost` to ::1 and the rest
                // of the stack is IPv4.
                .arg("-H")
                .arg("127.0.0.1")
                // The setup page's "Copy diagnostics" reads these logs through the Next
                // server (`src/app/api/diagnostics`), which stays up when the backend does
                // not. Both variables are the opt-in: the route answers 404 without them,
                // so a web deployment never serves its host's files.
                .env("KRYOVA_DESKTOP", "1");
            command
        }
    };
    if let Some(dir) = log_dir() {
        command.env("KRYOVA_LOG_DIR", dir);
    }
    spawn(command, "frontend")
}

// The CATIA bridge daemon is deliberately NOT started here.
//
// It used to be, unconditionally, and that is now actively harmful. The
// backend supervises its own daemon (`app/catia/local_bridge.py`): it
// provisions the device row, derives the token and spawns the process on
// demand, for whichever account is signed in. Only one daemon may run per
// machine — `catia_bridge/config.py` holds an exclusive lock on
// `bridge.lock` — so a second one started here can only take that lock away
// from the supervised one.
//
// On a machine nobody ever ran `kryova-catia-bridge pair` on, the daemon
// started here exits immediately (no stored credential, and it loads the
// config before touching the lock), so it was merely a wasted process per
// launch. On a hand-paired machine it wins the lock, the backend's own
// daemon then dies with "already running", and the backend reports the
// bridge as unavailable — then sits out its retry cooldown before trying
// again. That is precisely the "no CATIA bridge is connected" the whole
// local-bridge mechanism exists to prevent, reintroduced by the launcher.
//
// A hand-paired workstation is still supported: the backend spawns that
// daemon too, with `--wait-for-catia`, so nothing here is lost.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // First, as the plugin's own documentation requires: a second launch is answered
        // here -- by showing the window that is already open -- before anything else starts
        // a second pair of servers on the same two ports.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // A second launch -- from the Start menu, or because a `kryova://` link was
            // clicked and Windows starts a process per link -- ends here, in the one
            // instance that is already open.
            receive_links(app, links::from_args(&args));
            focus_main_window(app);
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Servers::default())
        .manage(PendingLinks::default())
        .manage(DatabaseToStop::default())
        .invoke_handler(tauri::generate_handler![backend_url, set_tray_status, take_deep_links])
        .setup(|app| {
            // The updater refuses to initialise without a public key in the config, and the
            // key belongs to whoever holds the signing key -- it is injected at build time
            // (`scripts/desktop-config.mjs`) or it is absent. An app built without one has no
            // updater, and says so in `shell.log` rather than failing to start.
            if app.config().plugins.0.contains_key("updater") {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
            } else {
                shell_note("no updater: this build carries no update public key");
            }
            // A tray that fails to build must not stop the app: it is a convenience.
            if let Err(error) = build_tray(app) {
                shell_note(&format!("no tray icon: {error}"));
            }
            // Links this launch was started with (Windows and Linux pass one as an argument;
            // macOS delivers it afterwards, through `on_open_url`, which is registered next).
            let launch_args: Vec<String> = std::env::args().collect();
            receive_links(app.handle(), links::from_args(&launch_args));
            let for_links = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                receive_links(&for_links, event.urls().into_iter().map(|url| url.to_string()));
            });
            let detection = detect_layout(app.path().resource_dir().ok());
            let layout = match detection {
                Detection::Found(layout) => Some(layout),
                Detection::Broken(reasons) => {
                    for reason in &reasons {
                        shell_note(reason);
                    }
                    None
                }
                Detection::Nothing => {
                    shell_note(
                        "nothing to start: this is neither an installed app (no bundled \
                         frontend, backend and database beside the executable) nor a build \
                         made from two checkouts (KRYOVA_FRONTEND_DIR / KRYOVA_BACKEND_DIR)",
                    );
                    None
                }
            };

            // An installed app owns its database and so stops it; and the first launch is the
            // one that has to make it, which changes how long the window may wait.
            let mut first_run = false;
            if let Some(Layout::Bundled(bundle)) = &layout {
                if let Some(home) =
                    layout::data_home_from(|key| std::env::var(key).ok(), std::env::consts::OS)
                {
                    first_run = layout::is_first_run(&home);
                    if let Ok(mut slot) = app.state::<DatabaseToStop>().0.lock() {
                        *slot = Some((
                            layout::pg_ctl(bundle, std::env::consts::OS),
                            layout::postgres_data(&home),
                        ));
                    }
                }
            }

            if let Some(layout) = &layout {
                let servers = app.state::<Servers>();
                if let Ok(mut children) = servers.0.lock() {
                    if !port_is_open(BACKEND_PORT) {
                        if let Some(child) = start_backend(layout) {
                            children.push(child);
                        }
                    }
                    if !port_is_open(FRONTEND_PORT) {
                        if let Some(child) = start_frontend(layout) {
                            children.push(child);
                        }
                    }
                    // No CATIA bridge is started here on purpose -- the backend
                    // owns that daemon. See the note above `start_backend`'s
                    // neighbours.
                };
            }

            // The window is configured hidden: wait off the main thread so the
            // event loop keeps running, then reveal it once Next is serving. With no
            // layout there is nothing to wait for, and a 90-second blank wait is the
            // failure this branch exists to end -- the window opens at once and
            // `shell.log` says why.
            //
            // On the very first launch the backend has a database to make, which takes
            // minutes on a slow machine, and a hidden window for minutes reads as a
            // double-click that did nothing. So: as soon as the frontend answers (it takes
            // a moment) the window opens on the starting page, which polls the API itself
            // and moves on when it answers; the shell then waits on for the backend, up to
            // a deadline that is longer for a first run (`layout::startup_secs`).
            let can_start = layout.is_some();
            let handle = app.handle().clone();
            let budget = Duration::from_secs(layout::startup_secs(first_run));
            std::thread::spawn(move || {
                let started = Instant::now();
                let frontend_up = can_start && wait_for_ports(&[FRONTEND_PORT], budget);
                let show = |path: &str| {
                    if let Some(window) = handle.get_webview_window("main") {
                        // The webview was created before the server was listening, so its
                        // first load failed; point it at the live server.
                        if let Ok(url) = format!("http://127.0.0.1:{FRONTEND_PORT}{path}").parse() {
                            let _ = window.navigate(url);
                        }
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                };
                if frontend_up && !port_is_open(BACKEND_PORT) {
                    show(layout::STARTING_PAGE);
                }
                let ready = frontend_up
                    && wait_for_ports(
                        &[BACKEND_PORT, FRONTEND_PORT],
                        budget.saturating_sub(started.elapsed()),
                    );
                if ready {
                    show("/");
                } else if let Some(window) = handle.get_webview_window("main") {
                    // Nothing answered in time. The window opens anyway: a visible error
                    // (the setup page, with its diagnostics) beats a missing window.
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Kryova");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            // Drain into an owned Vec inside its own scope so both the state
            // guard and the mutex guard are released before the kills run.
            let children: Vec<Child> = {
                let servers = handle.state::<Servers>();
                let mut guard = servers.0.lock().unwrap_or_else(|e| e.into_inner());
                guard.drain(..).collect()
            };
            for mut child in children {
                let _ = child.kill();
                let _ = child.wait();
            }
            // After the backend: stopping a database that is still being written to makes
            // `-m fast` roll those sessions back, which is the right answer for a quit but
            // not one to ask of a backend that is still running.
            stop_database(handle);
        }
    });
}

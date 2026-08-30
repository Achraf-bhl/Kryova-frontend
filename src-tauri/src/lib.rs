//! Kryova desktop shell.
//!
//! Thin on purpose: the application is the Next.js frontend talking to the
//! Kryova backend over HTTP. This crate exists to give that a native window,
//! a taskbar identity and an installer, not to hold product logic.
//!
//! It does own one thing a browser cannot: starting the two local servers the
//! app needs (FastAPI on 8000, Next on 3000) and stopping them again on exit,
//! so launching Kryova is a single click rather than two terminals.

use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent};

const BACKEND_PORT: u16 = 8000;
const FRONTEND_PORT: u16 = 3000;

/// How long to wait for the Next server before showing the window regardless,
/// so a failed start surfaces as a visible error instead of a missing window.
const STARTUP_TIMEOUT: Duration = Duration::from_secs(90);

/// Only the servers *this* process started. An already-running `npm run dev`
/// keeps its port and must survive our exit, so it never lands in here.
#[derive(Default)]
struct Servers(Mutex<Vec<Child>>);

/// Where the backend lives. Overridable so a desktop build can point at a
/// remote deployment instead of a local one.
fn api_base_url() -> String {
    std::env::var("KRYOVA_API_URL").unwrap_or_else(|_| "http://localhost:8000/api/v1".into())
}

#[tauri::command]
fn backend_url() -> String {
    api_base_url()
}

/// Repo locations are baked in at package time and overridable at runtime, so
/// one build can be pointed at a different checkout without a rebuild.
fn repo_dir(var: &str, baked: Option<&str>) -> Option<PathBuf> {
    let raw = std::env::var(var)
        .ok()
        .or_else(|| baked.map(str::to_owned))?;
    let dir = PathBuf::from(raw);
    dir.is_dir().then_some(dir)
}

fn frontend_dir() -> Option<PathBuf> {
    repo_dir("KRYOVA_FRONTEND_DIR", option_env!("KRYOVA_FRONTEND_DIR"))
}

fn backend_dir() -> Option<PathBuf> {
    repo_dir("KRYOVA_BACKEND_DIR", option_env!("KRYOVA_BACKEND_DIR"))
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
/// been kept. Each process gets its own file, truncated per launch so the
/// newest run is the whole file rather than the tail of a year of them.
fn log_dir() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .ok()
        .or_else(|| dirs_home().map(|home| home.join("AppData").join("Local")))?;
    let dir = base.join("Kryova").join("logs");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir)
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var("USERPROFILE").map(PathBuf::from).ok()
}

fn log_targets(name: &str) -> Option<(std::fs::File, std::fs::File)> {
    let path = log_dir()?.join(format!("{name}.log"));
    let file = std::fs::File::create(path).ok()?;
    let clone = file.try_clone().ok()?;
    Some((file, clone))
}

/// uvicorn from the project venv; the interpreter is invoked directly rather
/// than through a shell so the child stays a single killable process.
fn start_backend() -> Option<Child> {
    let dir = backend_dir()?;
    let venv_python = dir.join("venv").join("Scripts").join("python.exe");
    let python = if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python")
    };
    let port = BACKEND_PORT.to_string();

    let mut command = Command::new(python);
    command
        .current_dir(&dir)
        .arg("-m")
        .arg("uvicorn")
        .arg("app.main:app")
        .arg("--host")
        .arg("127.0.0.1")
        .arg("--port")
        .arg(&port);
    spawn(command, "backend")
}

/// `next start` against the production build. Invoking next's entry script with
/// node directly avoids the npm shim, which would leave an orphan on kill.
fn start_frontend() -> Option<Child> {
    let dir = frontend_dir()?;
    let next_bin = dir
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
        .current_dir(&dir)
        .arg(next_bin)
        .arg("start")
        .arg("-p")
        .arg(&port);
    spawn(command, "frontend")
}

/// The CATIA bridge daemon, from the backend checkout.
///
/// Kept for a workstation paired by hand, which is the only case this still
/// covers. The backend supervises its own daemon now (`app/catia/local_bridge.py`):
/// it provisions the device, mints the token and spawns the process on demand,
/// because starting one here could not work until somebody had run
/// `kryova-catia-bridge pair` — and on a single-machine install nobody ever
/// does, so the agent was permanently told CATIA was unavailable and fell back
/// to asking the user to upload a STEP file, the opposite of the product.
///
/// `--wait-for-catia` matters here. Kryova is normally up before CATIA is, and
/// without it the daemon would exit within seconds of login and never come
/// back. Waiting means the bridge attaches by itself whenever CATIA appears,
/// whether the engineer opened it or the assistant did.
///
/// Exits immediately and harmlessly if the workstation has never been paired,
/// which is now the ordinary case: the backend's own daemon takes over.
fn start_bridge() -> Option<Child> {
    let dir = backend_dir()?;
    let scripts = dir.join("scripts");
    if !scripts.join("catia_bridge").is_dir() {
        return None;
    }
    let venv_python = dir.join("venv").join("Scripts").join("python.exe");
    let python = if venv_python.is_file() {
        venv_python
    } else {
        PathBuf::from("python")
    };

    let mut command = Command::new(python);
    command
        .current_dir(&scripts)
        .arg("-m")
        .arg("catia_bridge")
        .arg("run")
        .arg("--wait-for-catia");
    spawn(command, "catia-bridge")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(Servers::default())
        .invoke_handler(tauri::generate_handler![backend_url])
        .setup(|app| {
            let servers = app.state::<Servers>();
            if let Ok(mut children) = servers.0.lock() {
                if !port_is_open(BACKEND_PORT) {
                    if let Some(child) = start_backend() {
                        children.push(child);
                    }
                }
                if !port_is_open(FRONTEND_PORT) {
                    if let Some(child) = start_frontend() {
                        children.push(child);
                    }
                }
                // No port to probe for this one: the bridge dials out and
                // listens on nothing. It is started unconditionally and, like
                // the servers above, killed on exit.
                if let Some(child) = start_bridge() {
                    children.push(child);
                }
            }

            // The window is configured hidden: wait off the main thread so the
            // event loop keeps running, then reveal it once Next is serving.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let ready = wait_for_ports(&[BACKEND_PORT, FRONTEND_PORT], STARTUP_TIMEOUT);
                if let Some(window) = handle.get_webview_window("main") {
                    // The webview was created before the server was listening,
                    // so its first load failed; point it at the live server.
                    if ready {
                        if let Ok(url) = format!("http://localhost:{FRONTEND_PORT}").parse() {
                            let _ = window.navigate(url);
                        }
                    }
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
        }
    });
}

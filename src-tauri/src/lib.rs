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

fn wait_for_port(port: u16, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if port_is_open(port) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    false
}

/// Spawn detached from any console, so a packaged launch never flashes a
/// terminal window behind the app.
fn spawn(mut command: Command) -> Option<Child> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().ok()
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
    spawn(command)
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
    spawn(command)
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
            }

            // The window is configured hidden: wait off the main thread so the
            // event loop keeps running, then reveal it once Next is serving.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let ready = wait_for_port(FRONTEND_PORT, STARTUP_TIMEOUT);
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

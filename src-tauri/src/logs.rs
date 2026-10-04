//! Where the shell's logs go, and keeping the last few launches of them.
//!
//! Until 2026-10-04 each child's log was `File::create`d on every launch, which
//! truncates it. That is fine until the app crashes: the user relaunches to see whether it
//! was a one-off, and the only record of the crash is overwritten by the first line of the
//! new run. A crash report is exactly the file somebody opens *after* restarting.
//!
//! This is its own module, with no Tauri in it, so the rules can be tested with a bare
//! `rustc --test src/logs.rs` on any machine -- the shell's own crate needs a webview
//! toolchain to compile, and the thing worth testing here does not.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

/// How many *earlier* launches are kept beside the current one: `backend.log` is this
/// launch, `backend.1.log` the one before, up to `backend.5.log`. Five restarts is long
/// enough to find the crash after a few tries to get past it, and short enough that a
/// machine that crash-loops does not fill a disk with it.
pub const KEEP_PREVIOUS: usize = 5;

/// The directory the logs live in on this platform, or None if no home can be found.
///
/// `get` reads an environment variable and `os` is `std::env::consts::OS`; both are
/// parameters so every platform's answer is testable from any of them.
///
/// Windows keeps `%LOCALAPPDATA%\Kryova\logs`, which the support notes already name and
/// which a user may have bookmarked. The other two used to fall through to a
/// `USERPROFILE` that does not exist there and so wrote no log at all.
pub fn log_dir_from(get: impl Fn(&str) -> Option<String>, os: &str) -> Option<PathBuf> {
    let nonempty = |key: &str| get(key).filter(|value| !value.is_empty());
    match os {
        "windows" => {
            let base = nonempty("LOCALAPPDATA").map(PathBuf::from).or_else(|| {
                nonempty("USERPROFILE").map(|home| PathBuf::from(home).join("AppData").join("Local"))
            })?;
            Some(base.join("Kryova").join("logs"))
        }
        "macos" => {
            let home = nonempty("HOME")?;
            Some(PathBuf::from(home).join("Library").join("Logs").join("Kryova"))
        }
        _ => {
            let state = nonempty("XDG_STATE_HOME").map(PathBuf::from).or_else(|| {
                nonempty("HOME").map(|home| PathBuf::from(home).join(".local").join("state"))
            })?;
            Some(state.join("kryova").join("logs"))
        }
    }
}

fn numbered(dir: &Path, name: &str, index: usize) -> PathBuf {
    dir.join(format!("{name}.{index}.log"))
}

/// Move `name.log` to `name.1.log`, that to `name.2.log`, and so on, dropping the oldest.
///
/// Best effort, by design: the caller starts the application whether or not this worked,
/// and a failed rename must never be the reason a window does not open. The first error
/// is returned so a test can see it; the caller ignores it.
pub fn rotate(dir: &Path, name: &str, keep: usize) -> io::Result<()> {
    let mut first_error: Option<io::Error> = None;
    let mut note = |result: io::Result<()>| {
        if let Err(error) = result {
            if error.kind() != io::ErrorKind::NotFound && first_error.is_none() {
                first_error = Some(error);
            }
        }
    };

    // Oldest first, so each rename lands on a name that has just been vacated.
    note(fs::remove_file(numbered(dir, name, keep)));
    for index in (1..keep).rev() {
        note(fs::rename(numbered(dir, name, index), numbered(dir, name, index + 1)));
    }
    note(fs::rename(dir.join(format!("{name}.log")), numbered(dir, name, 1)));

    match first_error {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn scratch() -> PathBuf {
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("kryova-logs-{}-{nanos}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn launch(dir: &Path, name: &str, text: &str) {
        rotate(dir, name, KEEP_PREVIOUS).unwrap();
        fs::write(dir.join(format!("{name}.log")), text).unwrap();
    }

    fn read(dir: &Path, file: &str) -> Option<String> {
        fs::read_to_string(dir.join(file)).ok()
    }

    #[test]
    fn a_crash_survives_the_next_launch() {
        let dir = scratch();
        launch(&dir, "backend", "run one: Traceback ...");
        launch(&dir, "backend", "run two: healthy");

        assert_eq!(read(&dir, "backend.log").as_deref(), Some("run two: healthy"));
        assert_eq!(read(&dir, "backend.1.log").as_deref(), Some("run one: Traceback ..."));
    }

    #[test]
    fn the_first_launch_has_nothing_to_rotate_and_is_not_an_error() {
        let dir = scratch();
        assert!(rotate(&dir, "backend", KEEP_PREVIOUS).is_ok());
    }

    #[test]
    fn five_earlier_launches_are_kept_and_the_sixth_is_dropped() {
        let dir = scratch();
        for run in 0..8 {
            launch(&dir, "backend", &format!("run {run}"));
        }

        assert_eq!(read(&dir, "backend.log").as_deref(), Some("run 7"));
        assert_eq!(read(&dir, "backend.1.log").as_deref(), Some("run 6"));
        assert_eq!(read(&dir, "backend.5.log").as_deref(), Some("run 2"));
        assert_eq!(read(&dir, "backend.6.log"), None);
    }

    #[test]
    fn rotating_one_process_leaves_the_other_alone() {
        let dir = scratch();
        launch(&dir, "backend", "backend run");
        launch(&dir, "frontend", "frontend run");
        launch(&dir, "backend", "backend run two");

        assert_eq!(read(&dir, "frontend.log").as_deref(), Some("frontend run"));
        assert_eq!(read(&dir, "frontend.1.log"), None);
    }

    #[test]
    fn a_gap_in_the_numbering_does_not_stop_the_rest_moving() {
        let dir = scratch();
        fs::write(dir.join("backend.log"), "current").unwrap();
        fs::write(dir.join("backend.3.log"), "old").unwrap();

        rotate(&dir, "backend", KEEP_PREVIOUS).unwrap();

        assert_eq!(read(&dir, "backend.1.log").as_deref(), Some("current"));
        assert_eq!(read(&dir, "backend.4.log").as_deref(), Some("old"));
    }

    fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |key| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| (*v).to_string())
    }

    #[test]
    fn windows_keeps_the_directory_the_support_notes_name() {
        let dir = log_dir_from(env(&[("LOCALAPPDATA", "C:\\Users\\a\\AppData\\Local")]), "windows");
        assert_eq!(
            dir,
            Some(PathBuf::from("C:\\Users\\a\\AppData\\Local").join("Kryova").join("logs"))
        );
    }

    #[test]
    fn windows_without_localappdata_falls_back_to_the_profile() {
        let dir = log_dir_from(env(&[("USERPROFILE", "C:\\Users\\a")]), "windows").unwrap();
        assert!(dir.ends_with(Path::new("AppData").join("Local").join("Kryova").join("logs")));
    }

    #[test]
    fn linux_follows_the_xdg_state_directory() {
        let dir = log_dir_from(env(&[("XDG_STATE_HOME", "/s"), ("HOME", "/h")]), "linux");
        assert_eq!(dir, Some(PathBuf::from("/s").join("kryova").join("logs")));
    }

    #[test]
    fn linux_without_xdg_uses_the_home_state_directory() {
        let dir = log_dir_from(env(&[("HOME", "/h")]), "linux");
        assert_eq!(
            dir,
            Some(PathBuf::from("/h").join(".local").join("state").join("kryova").join("logs"))
        );
    }

    #[test]
    fn macos_uses_the_library_logs_directory() {
        let dir = log_dir_from(env(&[("HOME", "/Users/a")]), "macos");
        assert_eq!(
            dir,
            Some(PathBuf::from("/Users/a").join("Library").join("Logs").join("Kryova"))
        );
    }

    #[test]
    fn an_empty_variable_is_the_same_as_an_unset_one() {
        assert_eq!(log_dir_from(env(&[("HOME", "")]), "linux"), None);
    }

    #[test]
    fn no_home_means_no_log_directory_rather_than_a_guess() {
        assert_eq!(log_dir_from(env(&[]), "linux"), None);
        assert_eq!(log_dir_from(env(&[]), "macos"), None);
        assert_eq!(log_dir_from(env(&[]), "windows"), None);
    }
}

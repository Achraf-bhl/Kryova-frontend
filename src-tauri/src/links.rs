//! The `kryova://` links the operating system hands the shell (ROAD_TO_10 4.7).
//!
//! A link arrives in an email or a CI comment, the person clicking it cannot read it first,
//! and the app it opens is already signed in. The decision about what a link may *do* is the
//! page's, and it is an allow-list (`src/lib/desktop-powers.ts::parseDeepLink`: three
//! read-only targets, one conservative id). The shell is deliberately not a second judge:
//! two parsers for one grammar drift, and the day they disagree the permissive one wins.
//!
//! What the shell owes is narrower. It is the thing that reads **an argv the OS built from an
//! attacker-influenced string**, so before anything is stored or handed to a webview it keeps
//! only entries that are the right scheme, a sane length and free of control characters, and
//! it bounds how many it will hold. Everything else is dropped silently: a launch argument
//! that is not a link is just an argument.
//!
//! Links are *held* until the page asks for them. The first launch from a link starts the
//! app, and the page is not loaded yet when the link arrives; an event emitted into a webview
//! that is still navigating is an event nobody hears. `Pending` is what makes the page's
//! first question ("anything for me?") correct whenever it is asked.
//!
//! No Tauri here, so `rustc --test src/links.rs` runs the rules on any machine.

/// The only scheme the shell passes on.
pub const SCHEME: &str = "kryova://";

/// Longest link kept. The page's id pattern allows 64 characters; this is generous around a
/// legitimate link and small enough that a hostile argument is not copied around.
pub const MAX_LEN: usize = 512;

/// Most links held at once. A burst of clicks while the app starts is a handful, not hundreds.
pub const MAX_PENDING: usize = 8;

/// Whether one argument is a link worth keeping.
pub fn is_link(argument: &str) -> bool {
    let trimmed = argument.trim();
    trimmed.len() <= MAX_LEN
        && trimmed.len() > SCHEME.len()
        // ASCII-case-insensitive on the scheme only: `KRYOVA://run/x` is the same link, and
        // Windows is known to hand over what the user typed.
        // `get`, not an index: a byte offset inside a multi-byte character is a panic, and
        // this reads an argument the operating system assembled from someone else's text.
        && trimmed
            .get(..SCHEME.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(SCHEME))
        && !trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
}

/// The links among a launch's arguments, in order, each trimmed. The first argument is the
/// program itself and is never a link.
pub fn from_args(args: &[String]) -> Vec<String> {
    args.iter()
        .skip(1)
        .filter(|argument| is_link(argument))
        .map(|argument| argument.trim().to_owned())
        .collect()
}

/// Links the page has not yet taken.
#[derive(Debug, Default)]
pub struct Pending(Vec<String>);

impl Pending {
    /// Hold a link. Returns false when it was not kept: not a link, already held, or the
    /// bound is reached -- in which case the newest is dropped, not the oldest, so a flood
    /// cannot push out the link the user actually clicked first.
    pub fn push(&mut self, link: &str) -> bool {
        if !is_link(link) {
            return false;
        }
        let link = link.trim();
        if self.0.iter().any(|held| held == link) || self.0.len() >= MAX_PENDING {
            return false;
        }
        self.0.push(link.to_owned());
        true
    }

    /// Everything held, oldest first, leaving nothing -- a link is delivered once.
    pub fn take(&mut self) -> Vec<String> {
        std::mem::take(&mut self.0)
    }

    #[cfg(test)]
    pub fn len(&self) -> usize {
        self.0.len()
    }

    #[cfg(test)]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| (*s).to_owned()).collect()
    }

    #[test]
    fn a_link_is_kept_and_the_program_name_never_is() {
        assert_eq!(
            from_args(&args(&["kryova://run/abc", "kryova://project/p1"])),
            vec!["kryova://project/p1".to_owned()],
            "argv[0] is the executable, even if it were named like a link"
        );
        assert_eq!(
            from_args(&args(&["C:\\Kryova\\kryova.exe", "kryova://run/abc"])),
            vec!["kryova://run/abc".to_owned()]
        );
    }

    #[test]
    fn other_arguments_are_not_links() {
        assert!(from_args(&args(&["kryova.exe", "--flag", "C:\\part.stp", "https://example.test/x"])).is_empty());
        assert!(!is_link("kryova:/run/abc"), "one slash is not the scheme");
        assert!(!is_link("kryova://"), "nothing after the scheme is no link");
        assert!(!is_link("xkryova://run/abc"));
    }

    #[test]
    fn the_scheme_is_matched_without_regard_to_case_and_the_link_is_kept_as_given() {
        assert!(is_link("KRYOVA://run/abc"));
        assert_eq!(from_args(&args(&["x", "  Kryova://run/abc  "])), vec!["Kryova://run/abc".to_owned()]);
    }

    #[test]
    fn control_characters_and_embedded_whitespace_are_refused() {
        assert!(!is_link("kryova://run/abc\n--evil"));
        assert!(!is_link("kryova://run/a\0bc"));
        assert!(!is_link("kryova://run/a bc"));
        assert!(!is_link("kryova://run/abc\u{7f}"));
    }

    #[test]
    fn text_that_is_not_ascii_cannot_make_the_check_panic() {
        // Byte 9 falls inside the euro sign here; slicing the string at the scheme's length
        // would abort the process before the window opened.
        assert!(!is_link("kryova:/\u{20ac}/run/abc"));
        assert!(!is_link("\u{20ac}\u{20ac}\u{20ac}\u{20ac}\u{20ac}"));
        assert!(from_args(&["x".to_owned(), "k\u{e9}ryova://run/abc".to_owned()]).is_empty());
    }

    #[test]
    fn a_link_longer_than_any_real_one_is_refused() {
        let long = format!("kryova://run/{}", "a".repeat(MAX_LEN));
        assert!(!is_link(&long));
        let at_limit = format!("kryova://run/{}", "a".repeat(MAX_LEN - "kryova://run/".len()));
        assert!(is_link(&at_limit));
    }

    #[test]
    fn a_link_is_delivered_once() {
        let mut pending = Pending::default();
        assert!(pending.push("kryova://run/abc"));

        assert_eq!(pending.take(), vec!["kryova://run/abc".to_owned()]);
        assert!(pending.take().is_empty());
        assert!(pending.is_empty());
    }

    #[test]
    fn the_same_link_clicked_twice_is_held_once() {
        let mut pending = Pending::default();

        assert!(pending.push("kryova://run/abc"));
        assert!(!pending.push("kryova://run/abc"));
        assert!(!pending.push(" kryova://run/abc "));
        assert_eq!(pending.len(), 1);
    }

    #[test]
    fn a_flood_keeps_the_first_links_not_the_last() {
        let mut pending = Pending::default();
        for n in 0..(MAX_PENDING + 5) {
            pending.push(&format!("kryova://run/r{n}"));
        }

        let held = pending.take();
        assert_eq!(held.len(), MAX_PENDING);
        assert_eq!(held[0], "kryova://run/r0", "the link clicked first survives the flood");
    }

    #[test]
    fn only_links_are_held() {
        let mut pending = Pending::default();

        assert!(!pending.push("https://example.test/run/abc"));
        assert!(!pending.push(""));
        assert!(pending.is_empty());
    }
}

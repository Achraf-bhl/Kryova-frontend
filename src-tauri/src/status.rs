//! The text the tray icon shows, from what the page tells the shell (ROAD_TO_10 4.7).
//!
//! The page knows whether the CATIA bridge is connected and how many runs are going; the
//! shell does not, and must not: answering would mean the shell holding a session and
//! calling the API, and a native process that carries the user's credentials is a larger
//! thing to defend than a tooltip is worth. So the page *tells* the shell, through one
//! command, and this is what the shell does with the string before it reaches the OS.
//!
//! The string is whatever the page sent. It is shortened and stripped of control characters
//! because a tooltip is a native widget: Windows truncates one at 127 UTF-16 units and a
//! newline or a NUL in it is at best a rendering fault.
//!
//! No Tauri here, so `rustc --test src/status.rs` runs the rules on any machine.

/// Windows truncates a tray tooltip at 127 UTF-16 code units; stay inside it.
pub const MAX_UNITS: usize = 120;

pub const DEFAULT: &str = "Kryova";

/// The tooltip for a status the page reported, or `Kryova` when it reported nothing usable.
pub fn tooltip(reported: &str) -> String {
    let cleaned: String = reported
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    if cleaned.is_empty() {
        return DEFAULT.to_owned();
    }
    let mut units = 0;
    let mut out = String::new();
    for c in cleaned.chars() {
        units += c.len_utf16();
        if units > MAX_UNITS {
            // An ellipsis in the room the cut leaves, so a clipped status says it is clipped.
            while out.encode_utf16().count() + 1 > MAX_UNITS {
                out.pop();
            }
            out.push('…');
            return out;
        }
        out.push(c);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_plain_status_passes_through() {
        assert_eq!(tooltip("Kryova — CATIA connected · 2 runs"), "Kryova — CATIA connected · 2 runs");
    }

    #[test]
    fn nothing_reported_shows_the_name_not_an_empty_tooltip() {
        assert_eq!(tooltip(""), "Kryova");
        assert_eq!(tooltip("   \n\t "), "Kryova");
    }

    #[test]
    fn control_characters_and_newlines_become_single_spaces() {
        assert_eq!(tooltip("CATIA\nconnected\u{0}\u{7}  2 runs"), "CATIA connected 2 runs");
    }

    #[test]
    fn a_long_status_is_cut_inside_the_windows_limit_and_says_so() {
        let long = "x".repeat(500);

        let shown = tooltip(&long);

        assert!(shown.encode_utf16().count() <= MAX_UNITS, "{} units", shown.encode_utf16().count());
        assert!(shown.ends_with('…'));
    }

    #[test]
    fn the_limit_counts_utf16_units_not_characters() {
        // Each of these is two UTF-16 units; counting characters would put 240 on the OS.
        let astral = "𝒦".repeat(200);

        let shown = tooltip(&astral);

        assert!(shown.encode_utf16().count() <= MAX_UNITS);
        assert!(shown.ends_with('…'));
    }

    #[test]
    fn a_status_exactly_at_the_limit_is_not_clipped() {
        let exact = "y".repeat(MAX_UNITS);

        assert_eq!(tooltip(&exact), exact);
    }
}

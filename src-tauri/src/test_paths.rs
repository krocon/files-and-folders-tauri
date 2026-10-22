//! Absolute paths for tests on every system: Unix tests write `/home/u`, which is no
//! absolute path on Windows (no drive) – there it becomes `C:\home\u`.

use std::path::PathBuf;

/// `unix` ("/a/b") as an absolute path of this system.
pub fn abs(unix: &str) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(format!("C:{}", unix.replace('/', "\\")))
    } else {
        PathBuf::from(unix)
    }
}

#[test]
fn abs_is_absolute_here() {
    assert!(abs("/home/u").is_absolute());
    assert!(abs("/").is_absolute());
}

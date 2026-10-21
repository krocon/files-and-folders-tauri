//! Danger check on servers (design 034 E4): deleting or moving the root, the login
//! folder, the profile's start folder or a folder above them needs a second
//! confirmation (`allowDangerous`), like F8 on the root or the home folder locally.

use super::RemotePath;

/// Why `path` is dangerous to delete/move – `None` if it is not.
pub fn danger_of(
    path: &RemotePath,
    home: Option<&str>,
    start: Option<&str>,
) -> Option<&'static str> {
    if path.is_root() {
        return Some("root");
    }
    for (folder, why) in [(home, "home"), (start, "startPath")] {
        let Some(f) = folder else { continue };
        if let Ok(f) = RemotePath::new(path.profile(), f)
            && f.starts_with(path)
        {
            return Some(why);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_home_start_and_above() {
        let p = |s: &str| RemotePath::parse(s).unwrap();
        assert_eq!(danger_of(&p("remote://a/"), None, None), Some("root"));
        assert_eq!(
            danger_of(&p("remote://a/home"), Some("/home/marc"), None),
            Some("home")
        );
        assert_eq!(
            danger_of(&p("remote://a/home/marc"), Some("/home/marc"), None),
            Some("home")
        );
        assert_eq!(
            danger_of(&p("remote://a/home/marc/x"), Some("/home/marc"), None),
            None
        );
        assert_eq!(
            danger_of(&p("remote://a/srv"), Some("/home/marc"), Some("/srv/www")),
            Some("startPath")
        );
        assert_eq!(
            danger_of(&p("remote://a/srv2"), Some("/home/marc"), Some("/srv/www")),
            None
        );
    }
}

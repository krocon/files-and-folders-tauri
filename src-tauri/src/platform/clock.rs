//! Local time zone offsets (design 025 E7): ZIP and RAR 4 store DOS times in
//! local time. No time zone crate – the OS knows the rules for every date.

/// Seconds the local time is ahead of UTC at the UTC instant `utc_secs`
/// (DST of that date included). 0 if the OS cannot tell.
#[cfg(unix)]
pub fn local_offset_secs(utc_secs: i64) -> i64 {
    // time_t is 64-bit on every platform we build for
    let t = utc_secs as libc::time_t;
    // SAFETY: `localtime_r` writes only into `tm`; `tm` is plain old data.
    unsafe {
        let mut tm: libc::tm = std::mem::zeroed();
        if libc::localtime_r(&t, &mut tm).is_null() {
            return 0;
        }
        // `c_long`: 64-bit on Linux and macOS
        #[allow(clippy::useless_conversion)]
        i64::from(tm.tm_gmtoff)
    }
}

#[cfg(windows)]
pub fn local_offset_secs(utc_secs: i64) -> i64 {
    use windows_sys::Win32::Foundation::{FILETIME, SYSTEMTIME};
    use windows_sys::Win32::System::Time::{
        FileTimeToSystemTime, SystemTimeToFileTime, SystemTimeToTzSpecificLocalTime,
    };
    const DIFF_SECS: i64 = 11_644_473_600;
    let Some(ticks) = utc_secs
        .checked_add(DIFF_SECS)
        .and_then(|s| s.checked_mul(10_000_000))
        .and_then(|t| u64::try_from(t).ok())
    else {
        return 0;
    };
    let ft = FILETIME {
        dwLowDateTime: ticks as u32,
        dwHighDateTime: (ticks >> 32) as u32,
    };
    // SAFETY: plain structs, out-parameters owned here; a null zone = the current one.
    unsafe {
        let mut utc: SYSTEMTIME = std::mem::zeroed();
        let mut local: SYSTEMTIME = std::mem::zeroed();
        let mut back: FILETIME = std::mem::zeroed();
        if FileTimeToSystemTime(&ft, &mut utc) == 0
            || SystemTimeToTzSpecificLocalTime(std::ptr::null(), &utc, &mut local) == 0
            || SystemTimeToFileTime(&local, &mut back) == 0
        {
            return 0;
        }
        let local_ticks = (u64::from(back.dwHighDateTime) << 32) | u64::from(back.dwLowDateTime);
        (local_ticks as i64 - ticks as i64) / 10_000_000
    }
}

#[cfg(not(any(unix, windows)))]
pub fn local_offset_secs(_utc_secs: i64) -> i64 {
    0
}

/// A local wall-clock time (seconds as if it were UTC) → UTC seconds.
pub fn local_to_utc_secs(local_secs: i64) -> i64 {
    // two steps: the offset at the guessed instant (right except within a DST switch hour)
    let guess = local_secs - local_offset_secs(local_secs);
    local_secs - local_offset_secs(guess)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_and_utc_round_trip() {
        for utc in [0i64, 1_700_000_000, 1_720_000_000, 946_684_800] {
            let local = utc + local_offset_secs(utc);
            assert_eq!(local_to_utc_secs(local), utc, "at {utc}");
        }
        // the offset is whole minutes and below a day
        let o = local_offset_secs(1_700_000_000);
        assert!(o.abs() < 86_400 && o % 60 == 0, "{o}");
    }
}

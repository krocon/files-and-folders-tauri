//! Child processes of the shell bar (design 021 E3): stdin closed, stdout/stderr
//! as pipes, and a handle on the whole process tree so cancelling ends the
//! children too.
//!
//! - Unix: the child starts a **new session** (`setsid`): its own process group
//!   (killed with `killpg`) and no controlling terminal (`ssh`/`sudo` cannot ask
//!   in the terminal the app may have been started from).
//! - Windows: the child is put into a Job Object with `KILL_ON_JOB_CLOSE`;
//!   cancelling terminates the job. No console window (`CREATE_NO_WINDOW`).

use std::io;
use std::process::{Child, Command, Stdio};

/// A started child with its process tree.
pub struct GroupChild {
    pub child: Child,
    #[cfg(windows)]
    job: Option<win::Job>,
}

/// Starts `cmd` with stdin = null and piped stdout/stderr in its own group/job.
pub fn spawn_group(mut cmd: Command) -> io::Result<GroupChild> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: `setsid` is async-signal-safe; nothing else runs between fork and exec.
        unsafe {
            cmd.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(io::Error::last_os_error());
                }
                Ok(())
            });
        }
        Ok(GroupChild {
            child: cmd.spawn()?,
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        let child = cmd.spawn()?;
        // a tiny window: grandchildren started before the assignment are not in the job
        let job = win::Job::new().and_then(|j| j.assign(&child).then_some(j));
        Ok(GroupChild { child, job })
    }
}

impl GroupChild {
    pub fn id(&self) -> u32 {
        self.child.id()
    }

    /// Asks the whole group to end (Unix SIGTERM; Windows: terminates the job).
    pub fn terminate(&mut self) {
        #[cfg(unix)]
        self.signal(libc::SIGTERM);
        #[cfg(windows)]
        self.kill();
    }

    /// Ends the whole group at once (Unix SIGKILL; Windows: terminates the job).
    pub fn kill(&mut self) {
        #[cfg(unix)]
        self.signal(libc::SIGKILL);
        #[cfg(windows)]
        {
            if let Some(job) = &self.job {
                job.terminate();
            }
            let _ = self.child.kill();
        }
    }

    #[cfg(unix)]
    fn signal(&self, sig: libc::c_int) {
        let Ok(pgid) = libc::pid_t::try_from(self.child.id()) else {
            return;
        };
        // SAFETY: plain syscall; the group id is the child's pid (`setsid`).
        unsafe {
            libc::killpg(pgid, sig);
        }
    }

    /// The command ended normally: what it started in the background keeps running.
    /// Unix: nothing to do (the group is not signalled). Windows: the job no longer
    /// kills its processes when its handle closes.
    pub fn release(&mut self) {
        #[cfg(windows)]
        if let Some(job) = self.job.take() {
            job.release();
        }
    }

    /// Whether any process of the group is still alive (Unix; Windows: the child).
    pub fn group_alive(&mut self) -> bool {
        #[cfg(unix)]
        {
            let Ok(pgid) = libc::pid_t::try_from(self.child.id()) else {
                return false;
            };
            // SAFETY: signal 0 only checks for existence.
            unsafe { libc::killpg(pgid, 0) == 0 }
        }
        #[cfg(windows)]
        {
            matches!(self.child.try_wait(), Ok(None))
        }
    }
}

/// Windows: bytes in the OEM code page (console programs) → text.
#[cfg(windows)]
pub fn decode_oem(bytes: &[u8]) -> Option<String> {
    win::decode_oem(bytes)
}

#[cfg(windows)]
mod win {
    use std::os::windows::io::AsRawHandle;
    use std::process::Child;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Globalization::{GetOEMCP, MultiByteToWideChar};
    use windows_sys::Win32::System::JobObjects::{
        AssignProcessToJobObject, CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
        SetInformationJobObject, TerminateJobObject,
    };

    pub struct Job(HANDLE);

    // SAFETY: a job handle may be used from any thread.
    unsafe impl Send for Job {}

    impl Job {
        pub fn new() -> Option<Self> {
            // SAFETY: plain Win32 calls with valid arguments; the handle is closed in Drop.
            unsafe {
                let h = CreateJobObjectW(std::ptr::null(), std::ptr::null());
                if h.is_null() {
                    return None;
                }
                let job = Job(h);
                let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
                let ok = SetInformationJobObject(
                    h,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
                if ok == 0 {
                    return None;
                }
                Some(job)
            }
        }

        pub fn assign(&self, child: &Child) -> bool {
            // SAFETY: both handles are valid for the duration of the call.
            unsafe { AssignProcessToJobObject(self.0, child.as_raw_handle() as HANDLE) != 0 }
        }

        /// Clears `KILL_ON_JOB_CLOSE`, so dropping the handle leaves the processes alone.
        pub fn release(&self) {
            let info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
            // SAFETY: valid job handle and a correctly sized structure.
            unsafe {
                SetInformationJobObject(
                    self.0,
                    JobObjectExtendedLimitInformation,
                    &info as *const _ as *const core::ffi::c_void,
                    std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                );
            }
        }

        pub fn terminate(&self) {
            // SAFETY: valid job handle.
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }

    impl Drop for Job {
        fn drop(&mut self) {
            // SAFETY: the handle is owned; KILL_ON_JOB_CLOSE ends what is left.
            unsafe {
                CloseHandle(self.0);
            }
        }
    }

    pub fn decode_oem(bytes: &[u8]) -> Option<String> {
        if bytes.is_empty() {
            return Some(String::new());
        }
        let len = i32::try_from(bytes.len()).ok()?;
        // SAFETY: the buffers have the lengths passed.
        unsafe {
            let cp = GetOEMCP();
            let n = MultiByteToWideChar(cp, 0, bytes.as_ptr(), len, std::ptr::null_mut(), 0);
            if n <= 0 {
                return None;
            }
            let mut wide = vec![0u16; n as usize];
            let n = MultiByteToWideChar(cp, 0, bytes.as_ptr(), len, wide.as_mut_ptr(), n);
            if n <= 0 {
                return None;
            }
            Some(String::from_utf16_lossy(&wide[..n as usize]))
        }
    }
}

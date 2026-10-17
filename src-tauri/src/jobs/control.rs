//! Steering of one running job: cancel, pause and the answer to a conflict.
//! Every wait wakes up on cancel, so a job reacts within the wait slice
//! (100 ms) even while it is paused or waiting for a decision.

use super::Decision;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::Duration;

const WAIT_SLICE: Duration = Duration::from_millis(100);

#[derive(Default)]
struct Steer {
    paused: bool,
    /// `(conflict id, decision, apply to all)` sent by the frontend.
    answer: Option<(u64, Decision, bool)>,
}

#[derive(Default)]
pub struct Control {
    cancelled: AtomicBool,
    steer: Mutex<Steer>,
    wake: Condvar,
}

impl Control {
    fn lock(&self) -> MutexGuard<'_, Steer> {
        self.steer.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
        let _guard = self.lock();
        self.wake.notify_all();
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }

    /// The flag itself, for loops that only need to poll it (folder size).
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancelled
    }

    pub fn set_paused(&self, paused: bool) {
        self.lock().paused = paused;
        self.wake.notify_all();
    }

    pub fn is_paused(&self) -> bool {
        self.lock().paused
    }

    /// Blocks while paused. Returns `false` if the job was cancelled.
    pub fn wait_while_paused(&self) -> bool {
        let mut steer = self.lock();
        while steer.paused && !self.is_cancelled() {
            steer = self
                .wake
                .wait_timeout(steer, WAIT_SLICE)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
        !self.is_cancelled()
    }

    /// Waits for the answer to conflict `id`. `None` = the job was cancelled.
    pub fn wait_for_decision(&self, id: u64) -> Option<(Decision, bool)> {
        let mut steer = self.lock();
        loop {
            if self.is_cancelled() {
                return None;
            }
            if let Some((cid, decision, all)) = steer.answer.take()
                && cid == id
            {
                return Some((decision, all));
            }
            steer = self
                .wake
                .wait_timeout(steer, WAIT_SLICE)
                .unwrap_or_else(|e| e.into_inner())
                .0;
        }
    }

    pub fn answer(&self, id: u64, decision: Decision, apply_to_all: bool) {
        self.lock().answer = Some((id, decision, apply_to_all));
        self.wake.notify_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::thread;
    use std::time::Instant;

    #[test]
    fn cancel_wakes_a_paused_job_quickly() {
        let c = Arc::new(Control::default());
        c.set_paused(true);
        let c2 = c.clone();
        let t = thread::spawn(move || c2.wait_while_paused());
        thread::sleep(Duration::from_millis(30));
        let start = Instant::now();
        c.cancel();
        assert!(!t.join().unwrap());
        assert!(start.elapsed() < Duration::from_millis(200));
    }

    #[test]
    fn resume_continues() {
        let c = Arc::new(Control::default());
        c.set_paused(true);
        let c2 = c.clone();
        let t = thread::spawn(move || c2.wait_while_paused());
        c.set_paused(false);
        assert!(t.join().unwrap());
    }

    #[test]
    fn decision_for_the_right_conflict_and_cancel_while_asking() {
        let c = Arc::new(Control::default());
        let c2 = c.clone();
        let t = thread::spawn(move || c2.wait_for_decision(7));
        c.answer(6, Decision::Skip, false); // stale answer is dropped
        thread::sleep(Duration::from_millis(20));
        c.answer(7, Decision::Overwrite, true);
        assert_eq!(t.join().unwrap(), Some((Decision::Overwrite, true)));

        let c3 = c.clone();
        let t = thread::spawn(move || c3.wait_for_decision(8));
        thread::sleep(Duration::from_millis(20));
        c.cancel();
        assert_eq!(t.join().unwrap(), None);
    }
}

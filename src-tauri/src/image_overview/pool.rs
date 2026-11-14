//! Work pool for thumbnails (design 074 E5, like Comic Commander 003 E9).
//!
//! **LIFO**: after fast scrolling the tiles now on screen were asked for last – they are
//! made first. The same key asked for twice is made once and every caller gets the
//! result. Pure std, no Tauri – testable.

use std::collections::HashMap;
use std::hash::Hash;
use std::sync::{Arc, Condvar, Mutex};

type Callback<V> = Box<dyn FnOnce(V) + Send>;

struct State<K, V> {
    stack: Vec<K>,
    waiting: HashMap<K, Vec<Callback<V>>>,
}

struct Shared<K, V> {
    state: Mutex<State<K, V>>,
    ready: Condvar,
    work: Box<dyn Fn(&K) -> V + Send + Sync>,
}

/// A fixed number of worker threads taking keys from a stack.
pub struct Pool<K, V> {
    shared: Arc<Shared<K, V>>,
}

impl<K, V> Pool<K, V>
where
    K: Eq + Hash + Clone + Send + 'static,
    V: Clone + Send + 'static,
{
    /// Starts `threads` workers (at least one) that run `work` for each key.
    pub fn new(threads: usize, work: impl Fn(&K) -> V + Send + Sync + 'static) -> Self {
        let shared = Arc::new(Shared {
            state: Mutex::new(State {
                stack: Vec::new(),
                waiting: HashMap::new(),
            }),
            ready: Condvar::new(),
            work: Box::new(work),
        });
        for i in 0..threads.max(1) {
            let s = shared.clone();
            let _ = std::thread::Builder::new()
                .name(format!("fnf-thumbs-{i}"))
                .spawn(move || worker(&s));
        }
        Pool { shared }
    }

    /// Asks for `key`; `done` runs on a worker thread with the result.
    pub fn request(&self, key: K, done: impl FnOnce(V) + Send + 'static) {
        let mut s = self.shared.state.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(w) = s.waiting.get_mut(&key) {
            w.push(Box::new(done));
            // asked again: it is on screen now – to the top of the stack
            if let Some(i) = s.stack.iter().position(|k| *k == key) {
                let k = s.stack.remove(i);
                s.stack.push(k);
            }
            return;
        }
        s.waiting.insert(key.clone(), vec![Box::new(done)]);
        s.stack.push(key);
        drop(s);
        self.shared.ready.notify_one();
    }

    /// Keys waiting (not yet taken by a worker).
    pub fn queued(&self) -> usize {
        self.shared
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .stack
            .len()
    }
}

fn worker<K: Eq + Hash + Clone, V: Clone>(s: &Shared<K, V>) {
    loop {
        let key = {
            let mut st = s.state.lock().unwrap_or_else(|e| e.into_inner());
            loop {
                if let Some(k) = st.stack.pop() {
                    break k;
                }
                st = s.ready.wait(st).unwrap_or_else(|e| e.into_inner());
            }
        };
        let value = (s.work)(&key);
        let callbacks = s
            .state
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .waiting
            .remove(&key)
            .unwrap_or_default();
        for cb in callbacks {
            cb(value.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn last_asked_first_made_and_same_key_once() {
        // one worker, blocked on the first key until the others are queued
        let (gate_tx, gate_rx) = mpsc::channel::<()>();
        let gate = Mutex::new(gate_rx);
        let made = Arc::new(Mutex::new(Vec::new()));
        let m = made.clone();
        let pool = Pool::new(1, move |k: &u32| {
            if *k == 0 {
                let _ = gate.lock().unwrap().recv_timeout(Duration::from_secs(5));
            }
            m.lock().unwrap().push(*k);
            k * 10
        });
        let (tx, rx) = mpsc::channel();
        let send = |k: u32| {
            let tx = tx.clone();
            move |v: u32| tx.send((k, v)).unwrap()
        };
        pool.request(0, send(0));
        // wait until the worker holds key 0
        while pool.queued() > 0 {
            std::thread::sleep(Duration::from_millis(5));
        }
        pool.request(1, send(1));
        pool.request(2, send(2));
        pool.request(3, send(3));
        pool.request(1, send(1)); // asked again → to the top, made once
        gate_tx.send(()).unwrap();
        let mut got: Vec<(u32, u32)> = (0..5)
            .map(|_| rx.recv_timeout(Duration::from_secs(5)).unwrap())
            .collect();
        got.sort_unstable();
        assert_eq!(got, [(0, 0), (1, 10), (1, 10), (2, 20), (3, 30)]);
        assert_eq!(*made.lock().unwrap(), [0, 1, 3, 2]);
    }
}

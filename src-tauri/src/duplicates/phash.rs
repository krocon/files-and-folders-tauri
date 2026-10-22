//! Perceptual hash and grouping for similar images (design 042 E6) – pure, no I/O.
//!
//! pHash: grey values scaled to 32 × 32, 2-D DCT, the 8 × 8 lowest frequencies; a bit
//! is set where the coefficient is above their median (the DC term left out of the
//! median). Two images are "similar" when few bits differ (Hamming distance).
//!
//! Grouping ([`cluster`]): similarity is not transitive (A ≈ B, B ≈ C, A ≉ C). Items are
//! taken in a fixed order (largest image first); every item that is still free becomes
//! the **centre** of a new group, and every free item within the threshold **of that
//! centre** joins it. So no member is ever farther than the threshold from its centre,
//! and the result does not depend on chains.

use std::cmp::Ordering;
use std::sync::OnceLock;

/// Side of the grey image the DCT runs on.
pub const SIDE: usize = 32;
/// Side of the low-frequency block that makes the 64 bits.
const LOW: usize = 8;

fn cos_table() -> &'static [[f64; SIDE]; SIDE] {
    static TABLE: OnceLock<[[f64; SIDE]; SIDE]> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut t = [[0.0; SIDE]; SIDE];
        for (k, row) in t.iter_mut().enumerate() {
            for (n, v) in row.iter_mut().enumerate() {
                *v = (std::f64::consts::PI / SIDE as f64 * (n as f64 + 0.5) * k as f64).cos();
            }
        }
        t
    })
}

/// DCT-II of one line; only the first [`LOW`] coefficients are needed.
fn dct_low(input: &[f64; SIDE]) -> [f64; LOW] {
    let t = cos_table();
    let mut out = [0.0; LOW];
    for (k, o) in out.iter_mut().enumerate() {
        *o = input.iter().zip(t[k].iter()).map(|(x, c)| x * c).sum();
    }
    out
}

/// The 64-bit pHash of a [`SIDE`] × [`SIDE`] grey image (row by row).
pub fn phash_of_grey(px: &[u8]) -> u64 {
    assert_eq!(px.len(), SIDE * SIDE, "a {SIDE}×{SIDE} grey image");
    // rows: SIDE lines → LOW coefficients each
    let mut rows = [[0.0f64; LOW]; SIDE];
    for (y, row) in rows.iter_mut().enumerate() {
        let mut line = [0.0; SIDE];
        for (x, v) in line.iter_mut().enumerate() {
            *v = f64::from(px[y * SIDE + x]);
        }
        *row = dct_low(&line);
    }
    // columns of the row result: LOW × LOW block
    let mut block = [0.0f64; LOW * LOW];
    for u in 0..LOW {
        let mut col = [0.0; SIDE];
        for (y, v) in col.iter_mut().enumerate() {
            *v = rows[y][u];
        }
        let c = dct_low(&col);
        for v in 0..LOW {
            block[v * LOW + u] = c[v];
        }
    }
    let mut ac: Vec<f64> = block[1..].to_vec();
    ac.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let median = (ac[ac.len() / 2 - 1] + ac[ac.len() / 2]) / 2.0;
    block
        .iter()
        .enumerate()
        .fold(0u64, |h, (i, &v)| if v > median { h | (1 << i) } else { h })
}

/// Number of different bits.
pub fn hamming(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

/// Width/height ratios differ by more than 10 % – a crop or another picture, never "the same".
pub fn aspect_differs(a: (u32, u32), b: (u32, u32)) -> bool {
    if a.0 == 0 || a.1 == 0 || b.0 == 0 || b.1 == 0 {
        return true;
    }
    let ra = f64::from(a.0) / f64::from(a.1);
    let rb = f64::from(b.0) / f64::from(b.1);
    (ra - rb).abs() / ra.max(rb) > 0.10
}

/// Groups `items` (see the module docs): `order` decides who becomes a centre first,
/// `dist` is `None` for "never similar". Returns groups of ≥ 2 members as
/// `(index, distance to the centre)`, the centre first with distance 0, the others by
/// distance and index. `cancelled` is polled once per centre.
pub fn cluster<T>(
    items: &[T],
    order: impl Fn(&T, &T) -> Ordering,
    dist: impl Fn(&T, &T) -> Option<u32>,
    threshold: u32,
    cancelled: &dyn Fn() -> bool,
) -> Vec<Vec<(usize, u32)>> {
    let mut sorted: Vec<usize> = (0..items.len()).collect();
    sorted.sort_by(|&a, &b| order(&items[a], &items[b]).then(a.cmp(&b)));
    // the free items in centre order; members leave the list as they are taken
    let mut free = sorted;
    let mut groups = Vec::new();
    while !free.is_empty() {
        if cancelled() {
            break;
        }
        let centre = free.remove(0);
        let mut members = vec![(centre, 0)];
        free.retain(|&i| match dist(&items[centre], &items[i]) {
            Some(d) if d <= threshold => {
                members.push((i, d));
                false
            }
            _ => true,
        });
        if members.len() > 1 {
            members[1..].sort_by(|a, b| a.1.cmp(&b.1).then(a.0.cmp(&b.0)));
            groups.push(members);
        }
    }
    groups
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A smooth "photo": gradients and a bright disc at (cx, cy).
    fn picture(cx: f64, cy: f64, seed: u8) -> Vec<u8> {
        let mut v = Vec::with_capacity(SIDE * SIDE);
        for y in 0..SIDE {
            for x in 0..SIDE {
                let (fx, fy) = (x as f64, y as f64);
                let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
                let disc = if d < 8.0 { 120.0 } else { 0.0 };
                let g = fx * 2.0 + fy * f64::from(seed) / 8.0 + disc;
                v.push(g.clamp(0.0, 255.0) as u8);
            }
        }
        v
    }

    #[test]
    fn same_picture_same_hash_noise_close_other_far() {
        let a = picture(10.0, 12.0, 3);
        let ha = phash_of_grey(&a);
        assert_eq!(ha, phash_of_grey(&a));
        // a little noise (recompression): only a few bits change
        let noisy: Vec<u8> = a
            .iter()
            .enumerate()
            .map(|(i, &p)| p.saturating_add((i % 7) as u8 / 3))
            .collect();
        assert!(hamming(ha, phash_of_grey(&noisy)) <= 4);
        // another picture: far away
        let b = picture(24.0, 20.0, 30);
        assert!(
            hamming(ha, phash_of_grey(&b)) > 12,
            "{}",
            hamming(ha, phash_of_grey(&b))
        );
        // mirrored: not the same picture
        let mut m = a.clone();
        for row in m.chunks_mut(SIDE) {
            row.reverse();
        }
        assert!(hamming(ha, phash_of_grey(&m)) > 8);
    }

    #[test]
    fn a_flat_image_has_a_hash() {
        // all coefficients 0 except DC: nothing above the median – a stable value
        assert_eq!(
            phash_of_grey(&[128; SIDE * SIDE]),
            phash_of_grey(&[128; SIDE * SIDE])
        );
    }

    #[test]
    fn aspect() {
        assert!(!aspect_differs((4000, 3000), (800, 600)));
        assert!(!aspect_differs((4000, 3000), (800, 610)));
        assert!(aspect_differs((4000, 3000), (3000, 4000)));
        assert!(aspect_differs((0, 3), (1, 1)));
    }

    fn by_value(items: &[u64], t: u32) -> Vec<Vec<(usize, u32)>> {
        cluster(
            items,
            |_, _| Ordering::Equal,
            |a, b| Some(hamming(*a, *b)),
            t,
            &|| false,
        )
    }

    #[test]
    fn cluster_never_chains() {
        // A–B 6 bits, B–C 6 bits, A–C 12 bits; threshold 8 → C stays out of A's group
        let a = 0u64;
        let b = 0b11_1111;
        let c = 0b1111_1111_1111;
        let g = by_value(&[a, b, c], 8);
        assert_eq!(g, vec![vec![(0, 0), (1, 6)]]);
        // C after B: B is taken already, C alone is no group
        let g = by_value(&[a, b, c, c], 8);
        assert_eq!(g, vec![vec![(0, 0), (1, 6)], vec![(2, 0), (3, 0)]]);
    }

    #[test]
    fn cluster_order_and_none() {
        let items = [(1u32, 5u64), (9, 5), (3, 5)];
        // largest first becomes the centre
        let g = cluster(
            &items,
            |a, b| b.0.cmp(&a.0),
            |a, b| (a.0 != 3 && b.0 != 3).then(|| hamming(a.1, b.1)),
            4,
            &|| false,
        );
        assert_eq!(g, vec![vec![(1, 0), (0, 0)]]);
        // cancelled: no groups
        assert!(cluster(&items, |_, _| Ordering::Equal, |_, _| Some(0), 4, &|| true).is_empty());
    }

    /// Brute force is enough (design 042 E6.4): 50 000 hashes, many groups.
    /// `cargo test --release cluster_50k -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn cluster_50k() {
        let mut x = 0x9e37_79b9_7f4a_7c15u64;
        let mut items: Vec<u64> = Vec::with_capacity(50_000);
        for i in 0..50_000 {
            // every 10th is a near copy (2 bits) of the one before
            if i % 10 == 9 {
                items.push(items[i - 1] ^ 0b101);
            } else {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                items.push(x);
            }
        }
        let start = std::time::Instant::now();
        let g = by_value(&items, 8);
        println!("50 000 hashes: {} groups in {:?}", g.len(), start.elapsed());
        assert!(g.len() >= 4_900);
    }
}

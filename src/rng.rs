//! 自前の決定的 PRNG（splitmix64）。依存追加禁止のため外部 crate は使わない（M22 採用済み）。
//! 同じシードからは常に同じ列が得られる（決定性 MUST）。システム時刻・外部乱数源は使わない。

/// 既定シード（ドキュメント化された定数。CLI `--seed` / REPL prop リクエストの seed で上書き可）。
pub const DEFAULT_SEED: u64 = 0x5EED_1A7C_2B21_9D4F;

#[derive(Debug, Clone)]
pub struct Rng {
    state: u64,
}

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng { state: seed }
    }

    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    /// [0, 1) の f64。
    pub fn next_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / (1u64 << 53) as f64
    }

    /// [lo, hi] の範囲の整数（hi < lo なら lo を返す）。
    pub fn gen_range(&mut self, lo: u64, hi: u64) -> u64 {
        if hi <= lo {
            return lo;
        }
        lo + self.next_u64() % (hi - lo + 1)
    }

    pub fn gen_bool(&mut self) -> bool {
        self.next_u64() & 1 == 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn same_seed_same_sequence() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            assert_eq!(a.next_u64(), b.next_u64());
        }
    }

    #[test]
    fn different_seed_differs_and_range_holds() {
        let mut a = Rng::new(1);
        let mut b = Rng::new(2);
        assert_ne!(a.next_u64(), b.next_u64());
        let mut r = Rng::new(7);
        for _ in 0..1000 {
            let v = r.gen_range(3, 9);
            assert!((3..=9).contains(&v));
            let f = r.next_f64();
            assert!((0.0..1.0).contains(&f));
        }
        assert_eq!(Rng::new(9).gen_range(5, 5), 5);
        assert_eq!(Rng::new(9).gen_range(9, 5), 9, "hi<lo なら lo");
    }
}

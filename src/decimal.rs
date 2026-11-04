//! decimal（M23, design/decimal.md 採用済み）: 固定小数点 SCALE=18。
//! 値はスケール済み i128 整数 s（実値 = s / 10^18）。
//! Rust(i128) / JS(BigInt) / WASM(i128) でビット一致することを最優先する。
//! 丸めは round-half-away-from-zero（trunc + 剰余の 2r >= d 判定）で、全バックエンド完全一致。

/// 固定スケール（小数点以下の桁数）。
pub const SCALE: u32 = 18;
/// 10^SCALE（スケール因子）。
pub const S: i128 = 1_000_000_000_000_000_000;
const S_U128: u128 = S as u128;
/// スケール済み整数の絶対値上限（実値で約 ±1.7e20）。
pub const DEC_MAX: i128 = i128::MAX;
/// §8.6 バックエンド中立な実行時エラー名（interp と JS で同一文字列）。
pub const ERR_DIV_ZERO: &str = "decimal-division-by-zero";
pub const ERR_OVERFLOW: &str = "decimal-overflow";

/// 256ビット積: a*b = hi*2^128 + lo（a, b は u128）。
fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let a0 = a & 0xFFFF_FFFF_FFFF_FFFF;
    let a1 = a >> 64;
    let b0 = b & 0xFFFF_FFFF_FFFF_FFFF;
    let b1 = b >> 64;
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & 0xFFFF_FFFF_FFFF_FFFF) + (p10 & 0xFFFF_FFFF_FFFF_FFFF);
    let lo = (p00 & 0xFFFF_FFFF_FFFF_FFFF) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

/// 256ビット ÷ 128ビットの商と剰余（2進長除算）。商が u128 に収まらなければ None（= オーバーフロー）。
fn divmod_wide(hi: u128, lo: u128, den: u128) -> Option<(u128, u128)> {
    if den == 0 {
        return None;
    }
    let mut rem: u128 = 0;
    let mut q: u128 = 0;
    for i in (0..256).rev() {
        let bit = if i >= 128 { (hi >> (i - 128)) & 1 } else { (lo >> i) & 1 };
        rem = (rem << 1) | bit;
        if q >> 127 != 0 {
            return None;
        }
        q <<= 1;
        if rem >= den {
            rem -= den;
            q |= 1;
        }
    }
    Some((q, rem))
}

/// u128 の round-half-away-from-zero 除算。商が i128 に収まらなければ None。
fn div_round(num: u128, den: u128) -> Option<i128> {
    if den == 0 {
        return None;
    }
    let mut q = num / den;
    let r = num % den;
    if 2 * r >= den {
        q += 1;
    }
    if q > DEC_MAX as u128 {
        return None;
    }
    Some(q as i128)
}

pub fn dec_add(a: i128, b: i128) -> Result<i128, &'static str> {
    a.checked_add(b).ok_or(ERR_OVERFLOW)
}

pub fn dec_sub(a: i128, b: i128) -> Result<i128, &'static str> {
    a.checked_sub(b).ok_or(ERR_OVERFLOW)
}

/// (a*b)/S を round-half-away で。
pub fn dec_mul(a: i128, b: i128) -> Result<i128, &'static str> {
    let sign = a.signum() * b.signum();
    let (hi, lo) = mul_wide(a.unsigned_abs(), b.unsigned_abs());
    if hi != 0 {
        return Err(ERR_OVERFLOW);
    }
    let q = div_round(lo, S_U128).ok_or(ERR_OVERFLOW)?;
    Ok(if sign < 0 { -q } else { q })
}

/// (a*S)/b を round-half-away で。b==0 は ERR_DIV_ZERO。
pub fn dec_div(a: i128, b: i128) -> Result<i128, &'static str> {
    if b == 0 {
        return Err(ERR_DIV_ZERO);
    }
    let sign = a.signum() * b.signum();
    let (hi, lo) = mul_wide(a.unsigned_abs(), S_U128);
    let (q, r) = divmod_wide(hi, lo, b.unsigned_abs()).ok_or(ERR_OVERFLOW)?;
    let mut q = q;
    if 2 * r >= b.unsigned_abs() {
        q += 1;
    }
    if q > DEC_MAX as u128 {
        return Err(ERR_OVERFLOW);
    }
    let q = q as i128;
    Ok(if sign < 0 { -q } else { q })
}

/// 印字: 小数点以下ちょうど SCALE 桁の平書き（§11.6）。例: 1.50d → "1.500000000000000000"。
pub fn fmt_dec(s: i128) -> String {
    let neg = s < 0;
    let a = s.unsigned_abs();
    let int = a / S_U128;
    let frac = a % S_U128;
    format!("{}{}.{:018}", if neg { "-" } else { "" }, int, frac)
}

pub fn dec_to_num(s: i128) -> f64 {
    s as f64 / S as f64
}

/// number(f64) → decimal。最短往復の科学表記（Rust `{:e}` / JS `toExponential()` は
/// 桁が同一で表記のみ差）をパースし SCALE で half-away に丸める。NaN/±Inf・範囲外は ERR_OVERFLOW。
pub fn dec_from_num(n: f64) -> Result<i128, &'static str> {
    if n.is_nan() || n.is_infinite() {
        return Err(ERR_OVERFLOW);
    }
    let text = format!("{:e}", n);
    parse_dec_scientific(&text).ok_or(ERR_OVERFLOW)
}

/// `[-]D[.DDD][eE[+-]D]` 形式の10進表記 → スケール済み i128（SCALE で half-away に丸め、範囲内のみ）。
pub fn parse_dec_scientific(text: &str) -> Option<i128> {
    let bytes = text.as_bytes();
    let mut i = 0;
    let neg = if i < bytes.len() && bytes[i] == b'-' {
        i += 1;
        true
    } else if i < bytes.len() && bytes[i] == b'+' {
        i += 1;
        false
    } else {
        false
    };
    let mut digits = String::new();
    let mut frac_len: i64 = 0;
    let mut seen_dot = false;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
        if bytes[i] == b'.' {
            if seen_dot {
                return None;
            }
            seen_dot = true;
        } else {
            digits.push(bytes[i] as char);
            if seen_dot {
                frac_len += 1;
            }
        }
        i += 1;
    }
    let mut exp: i64 = 0;
    if i < bytes.len() && (bytes[i] == b'e' || bytes[i] == b'E') {
        i += 1;
        let exp_neg = if i < bytes.len() && bytes[i] == b'-' {
            i += 1;
            true
        } else if i < bytes.len() && bytes[i] == b'+' {
            i += 1;
            false
        } else {
            false
        };
        let mut e = 0i64;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            e = e * 10 + (bytes[i] - b'0') as i64;
            if e > 10000 {
                return None;
            }
            i += 1;
        }
        if i != bytes.len() {
            return None;
        }
        exp = if exp_neg { -e } else { e };
    } else if i != bytes.len() {
        return None;
    }
    if digits.is_empty() {
        return None;
    }
    // 先頭の 0 を落とす（u128::parse が桁溢れを検出する）
    let digits_trimmed = digits.trim_start_matches('0');
    let digits_trimmed = if digits_trimmed.is_empty() { "0" } else { digits_trimmed };
    let mantissa: u128 = digits_trimmed.parse().ok()?;
    // 実値 = mantissa * 10^(exp - frac_len)。スケール済み = mantissa * 10^(exp - frac_len + SCALE)
    let shift = exp - frac_len + SCALE as i64;
    let scaled_u128 = if shift >= 0 {
        let mut r = mantissa;
        let mut s = shift;
        while s > 0 {
            let step = s.min(38) as u32;
            r = r.checked_mul(pow10(step))?;
            s -= step as i64;
        }
        r
    } else {
        let den = pow10((-shift).min(76) as u32);
        if -shift > 76 {
            0
        } else {
            let mut q = mantissa / den;
            let r = mantissa % den;
            if 2 * r >= den {
                q += 1;
            }
            q
        }
    };
    if scaled_u128 > DEC_MAX as u128 {
        return None;
    }
    let scaled = scaled_u128 as i128;
    Some(if neg { -scaled } else { scaled })
}

fn pow10(n: u32) -> u128 {
    let mut r = 1u128;
    for _ in 0..n {
        r *= 10;
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn literal_parse_and_fmt_roundtrip() {
        let s = parse_dec_scientific("1.50").expect("parse");
        assert_eq!(s, 1_500_000_000_000_000_000);
        assert_eq!(fmt_dec(s), "1.500000000000000000");
        assert_eq!(fmt_dec(parse_dec_scientific("-3.25").expect("p")), "-3.250000000000000000");
        assert_eq!(fmt_dec(0), "0.000000000000000000");
        assert_eq!(parse_dec_scientific("2e3"), Some(2_000_000_000_000_000_000_000));
        assert_eq!(parse_dec_scientific("0.0000000000000000005"), Some(1), "half-away で繰り上がる");
        assert_eq!(parse_dec_scientific("-0.0000000000000000005"), Some(-1));
        assert!(parse_dec_scientific("1e30").is_none(), "範囲外は None");
    }

    #[test]
    fn arithmetic_and_rounding() {
        let one = S;
        assert_eq!(dec_add(one, one).ok(), Some(2 * S));
        assert_eq!(dec_sub(0, one).ok(), Some(-S));
        // mul: 1.5 * 2.0 = 3.0
        assert_eq!(dec_mul(3 * S / 2, 2 * S).ok(), Some(3 * S));
        // mul の丸め: 0.5 * 0.1 (scaled) = ... half-away
        let half = S / 2;
        let tenth = S / 10;
        // 0.5 * 0.1 = 0.05 exactly
        assert_eq!(dec_mul(half, tenth).ok(), Some(S / 20));
        // div: 1 / 3 = 0.333... → SCALE で half-away
        let third = dec_div(S, 3 * S).ok().expect("1/3");
        assert_eq!(fmt_dec(third), "0.333333333333333333");
        // 2/3 → 0.666...667 (half-away up)
        let two_thirds = dec_div(2 * S, 3 * S).ok().expect("2/3");
        assert_eq!(fmt_dec(two_thirds), "0.666666666666666667");
        // div by zero
        assert_eq!(dec_div(S, 0), Err(ERR_DIV_ZERO));
        // overflow
        assert_eq!(dec_add(DEC_MAX, 1), Err(ERR_OVERFLOW));
        assert_eq!(dec_mul(DEC_MAX, 2 * S), Err(ERR_OVERFLOW));
    }

    #[test]
    fn num_conversion_is_deterministic() {
        let s = dec_from_num(1.5).expect("1.5");
        assert_eq!(s, 3 * S / 2);
        assert_eq!(dec_from_num(0.1).ok(), Some(S / 10), "0.1 は f64 では不正確だが最短表記は 0.1");
        assert_eq!(dec_to_num(S / 10), 0.1);
        assert_eq!(dec_from_num(f64::NAN), Err(ERR_OVERFLOW));
        assert_eq!(dec_from_num(f64::INFINITY), Err(ERR_OVERFLOW));
        // 往復
        let x = 123456789.125;
        assert_eq!(dec_to_num(dec_from_num(x).expect("ok")), x);
    }
}

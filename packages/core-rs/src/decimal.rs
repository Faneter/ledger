use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;
use core::cmp::Ordering;

/// Number of fixed fractional digits maintained internally (matches Decimal.js precision 28 for normal amounts).
pub const SCALE: u32 = 28;

/// 512-bit unsigned integer stored in little-endian 64-bit limbs.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct U512(pub [u64; 8]);

impl U512 {
    pub const ZERO: Self = Self([0; 8]);
    pub const ONE: Self = Self([1, 0, 0, 0, 0, 0, 0, 0]);

    pub const fn from_u64(v: u64) -> Self {
        Self([v, 0, 0, 0, 0, 0, 0, 0])
    }

    pub const fn from_u128(v: u128) -> Self {
        Self([v as u64, (v >> 64) as u64, 0, 0, 0, 0, 0, 0])
    }

    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|&x| x == 0)
    }

    fn highest_bit(&self) -> Option<usize> {
        for i in (0..8).rev() {
            if self.0[i] != 0 {
                return Some(i * 64 + (63 - self.0[i].leading_zeros() as usize));
            }
        }
        None
    }

    fn get_bit(&self, bit: usize) -> bool {
        let limb = bit / 64;
        let offset = bit % 64;
        (self.0[limb] >> offset) & 1 == 1
    }

    fn set_bit(&mut self, bit: usize) {
        let limb = bit / 64;
        let offset = bit % 64;
        self.0[limb] |= 1u64 << offset;
    }

    fn shl1_in_place(&mut self) {
        let mut carry = 0u64;
        for limb in &mut self.0 {
            let next_carry = *limb >> 63;
            *limb = (*limb << 1) | carry;
            carry = next_carry;
        }
    }

    pub fn add(self, other: Self) -> Self {
        let mut out = [0u64; 8];
        let mut carry: u128 = 0;
        for i in 0..8 {
            let sum = self.0[i] as u128 + other.0[i] as u128 + carry;
            out[i] = sum as u64;
            carry = sum >> 64;
        }
        Self(out)
    }

    pub fn sub(self, other: Self) -> Self {
        let mut out = [0u64; 8];
        let mut borrow: u128 = 0;
        for i in 0..8 {
            let a = self.0[i] as u128;
            let b = other.0[i] as u128 + borrow;
            if a >= b {
                out[i] = (a - b) as u64;
                borrow = 0;
            } else {
                out[i] = ((1u128 << 64) + a - b) as u64;
                borrow = 1;
            }
        }
        Self(out)
    }

    pub fn mul_u64(self, rhs: u64) -> Self {
        let mut out = [0u64; 8];
        let mut carry: u128 = 0;
        let r = rhs as u128;
        for i in 0..8 {
            let prod = self.0[i] as u128 * r + carry;
            out[i] = prod as u64;
            carry = prod >> 64;
        }
        Self(out)
    }

    pub fn mul(self, other: Self) -> Self {
        let mut out = [0u64; 8];
        for i in 0..8 {
            if self.0[i] == 0 {
                continue;
            }
            let a = self.0[i] as u128;
            let mut carry: u128 = 0;
            for j in 0..(8 - i) {
                let prod = a * (other.0[j] as u128) + out[i + j] as u128 + carry;
                out[i + j] = prod as u64;
                carry = prod >> 64;
            }
        }
        Self(out)
    }

    pub fn div_rem(self, divisor: Self) -> (Self, Self) {
        assert!(!divisor.is_zero(), "U512 division by zero");
        let mut q = Self::ZERO;
        let mut r = Self::ZERO;
        if let Some(tb) = self.highest_bit() {
            for bit in (0..=tb).rev() {
                r.shl1_in_place();
                if self.get_bit(bit) {
                    r.0[0] |= 1;
                }
                if r >= divisor {
                    r = r.sub(divisor);
                    q.set_bit(bit);
                }
            }
        }
        (q, r)
    }

    pub fn div_rem_u64(self, divisor: u64) -> (Self, u64) {
        assert!(divisor != 0, "U512 division by zero");
        let mut q = [0u64; 8];
        let mut rem: u128 = 0;
        let d = divisor as u128;
        for i in (0..8).rev() {
            let cur = (rem << 64) | (self.0[i] as u128);
            q[i] = (cur / d) as u64;
            rem = cur % d;
        }
        (Self(q), rem as u64)
    }

    pub fn pow10(exp: u32) -> Self {
        let mut res = Self::ONE;
        for _ in 0..exp {
            res = res.mul_u64(10);
        }
        res
    }

    pub fn to_decimal_string(self) -> String {
        if self.is_zero() {
            return String::from("0");
        }
        let mut chunks: Vec<u64> = Vec::new();
        let mut cur = self;
        while !cur.is_zero() {
            let (q, r) = cur.div_rem_u64(1_000_000_000);
            chunks.push(r);
            cur = q;
        }
        let mut out = String::new();
        if let Some(&last) = chunks.last() {
            out.push_str(&format!("{}", last));
            for &chunk in chunks[..chunks.len() - 1].iter().rev() {
                out.push_str(&format!("{:09}", chunk));
            }
        }
        out
    }
}

impl Ord for U512 {
    fn cmp(&self, other: &Self) -> Ordering {
        for i in (0..8).rev() {
            match self.0[i].cmp(&other.0[i]) {
                Ordering::Equal => continue,
                non_eq => return non_eq,
            }
        }
        Ordering::Equal
    }
}

impl PartialOrd for U512 {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn ten_pow_scale() -> U512 {
    U512::from_u128(10_000_000_000_000_000_000_000_000_000u128)
}

/// Fixed-scale decimal (`mag / 10^28`) using `ROUND_HALF_UP`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Dec {
    pub neg: bool,
    pub mag: U512,
}

impl Dec {
    pub const ZERO: Self = Self {
        neg: false,
        mag: U512::ZERO,
    };

    pub fn one() -> Self {
        Self {
            neg: false,
            mag: ten_pow_scale(),
        }
    }

    pub fn from_i64(v: i64) -> Self {
        let neg = v < 0;
        let abs = v.unsigned_abs();
        let mag = U512::from_u64(abs).mul(ten_pow_scale());
        Self::canonical(neg, mag)
    }

    fn canonical(neg: bool, mag: U512) -> Self {
        if mag.is_zero() {
            Self::ZERO
        } else {
            Self { neg, mag }
        }
    }

    pub fn is_zero(&self) -> bool {
        self.mag.is_zero()
    }

    pub fn is_negative(&self) -> bool {
        self.neg && !self.mag.is_zero()
    }

    pub fn is_positive(&self) -> bool {
        !self.neg && !self.mag.is_zero()
    }

    pub fn abs(self) -> Self {
        Self {
            neg: false,
            mag: self.mag,
        }
    }

    pub fn neg(self) -> Self {
        Self::canonical(!self.neg, self.mag)
    }

    pub fn max(self, other: Self) -> Self {
        if self >= other { self } else { other }
    }

    pub fn min(self, other: Self) -> Self {
        if self <= other { self } else { other }
    }

    pub fn parse(raw: &str) -> Result<Self, String> {
        let s = raw.trim();
        if s.is_empty() {
            return Err(String::from("Empty decimal string"));
        }
        let (neg, rest) = if let Some(r) = s.strip_prefix('-') {
            (true, r)
        } else if let Some(r) = s.strip_prefix('+') {
            (false, r)
        } else {
            (false, s)
        };
        if rest.is_empty() {
            return Err(format!("Invalid decimal: {}", raw));
        }

        let (mantissa_str, exp10): (&str, i32) = if let Some(idx) = rest.find(['e', 'E']) {
            let m = &rest[..idx];
            let e_str = &rest[idx + 1..];
            let e_val: i32 = e_str
                .parse()
                .map_err(|_| format!("Invalid exponent in decimal: {}", raw))?;
            (m, e_val)
        } else {
            (rest, 0)
        };

        let mut int_digits = String::new();
        let mut frac_digits = String::new();
        if let Some(dot) = mantissa_str.find('.') {
            int_digits.push_str(&mantissa_str[..dot]);
            frac_digits.push_str(&mantissa_str[dot + 1..]);
            if frac_digits.contains('.') {
                return Err(format!("Multiple dots in decimal: {}", raw));
            }
        } else {
            int_digits.push_str(mantissa_str);
        }

        if int_digits.is_empty() && frac_digits.is_empty() {
            return Err(format!("Invalid decimal: {}", raw));
        }
        if !int_digits.bytes().all(|b| b.is_ascii_digit())
            || !frac_digits.bytes().all(|b| b.is_ascii_digit())
        {
            return Err(format!("Non-digit in decimal: {}", raw));
        }

        let mut mag = U512::ZERO;
        for b in int_digits.bytes().chain(frac_digits.bytes()) {
            mag = mag.mul_u64(10).add(U512::from_u64((b - b'0') as u64));
        }
        if mag.is_zero() {
            return Ok(Self::ZERO);
        }

        let shift = (SCALE as i32) + exp10 - (frac_digits.len() as i32);
        let scaled = if shift >= 0 {
            mag.mul(U512::pow10(shift as u32))
        } else {
            let down = (-shift) as u32;
            if down > 120 {
                U512::ZERO
            } else {
                let div = U512::pow10(down);
                let (mut q, r) = mag.div_rem(div);
                if r.mul_u64(2) >= div {
                    q = q.add(U512::ONE);
                }
                q
            }
        };

        Ok(Self::canonical(neg, scaled))
    }

    pub fn add(self, other: Self) -> Self {
        if self.neg == other.neg {
            Self::canonical(self.neg, self.mag.add(other.mag))
        } else if self.mag >= other.mag {
            Self::canonical(self.neg, self.mag.sub(other.mag))
        } else {
            Self::canonical(other.neg, other.mag.sub(self.mag))
        }
    }

    pub fn sub(self, other: Self) -> Self {
        self.add(other.neg())
    }

    pub fn mul(self, other: Self) -> Self {
        if self.is_zero() || other.is_zero() {
            return Self::ZERO;
        }
        let prod = self.mag.mul(other.mag);
        let div = ten_pow_scale();
        let (mut q, rem) = prod.div_rem(div);
        if rem.mul_u64(2) >= div {
            q = q.add(U512::ONE);
        }
        Self::canonical(self.neg ^ other.neg, q)
    }

    pub fn checked_div(self, other: Self) -> Result<Self, String> {
        if other.is_zero() {
            return Err(String::from("Division by zero"));
        }
        if self.is_zero() {
            return Ok(Self::ZERO);
        }
        let num = self.mag.mul(ten_pow_scale());
        let (mut q, rem) = num.div_rem(other.mag);
        if rem.mul_u64(2) >= other.mag {
            q = q.add(U512::ONE);
        }
        Ok(Self::canonical(self.neg ^ other.neg, q))
    }

    pub fn round_dp(self, dp: u32) -> Self {
        if dp >= SCALE || self.is_zero() {
            return self;
        }
        let step = U512::pow10(SCALE - dp);
        let (mut q, rem) = self.mag.div_rem(step);
        if rem.mul_u64(2) >= step {
            q = q.add(U512::ONE);
        }
        Self::canonical(self.neg, q.mul(step))
    }

    pub fn format_dp(self, dp: u32) -> String {
        let rounded = self.round_dp(dp);
        let step = if dp < SCALE {
            U512::pow10(SCALE - dp)
        } else {
            U512::ONE
        };
        let (units, _) = rounded.mag.div_rem(step);
        if dp == 0 {
            let s = units.to_decimal_string();
            return if rounded.is_negative() {
                format!("-{}", s)
            } else {
                s
            };
        }
        let frac_scale = U512::pow10(dp);
        let (int_part, frac_part) = units.div_rem(frac_scale);
        let int_str = int_part.to_decimal_string();
        let mut frac_str = frac_part.to_decimal_string();
        if frac_str.len() < dp as usize {
            let zeros = "0".repeat(dp as usize - frac_str.len());
            frac_str = format!("{}{}", zeros, frac_str);
        }
        if rounded.is_negative() {
            format!("-{}.{}", int_str, frac_str)
        } else {
            format!("{}.{}", int_str, frac_str)
        }
    }

    pub fn format_trimmed(self) -> String {
        if self.is_zero() {
            return String::from("0");
        }
        let scale_pow = ten_pow_scale();
        let (int_part, frac_part) = self.mag.div_rem(scale_pow);
        let int_str = int_part.to_decimal_string();
        if frac_part.is_zero() {
            return if self.is_negative() {
                format!("-{}", int_str)
            } else {
                int_str
            };
        }
        let mut frac_str = frac_part.to_decimal_string();
        if frac_str.len() < SCALE as usize {
            let zeros = "0".repeat(SCALE as usize - frac_str.len());
            frac_str = format!("{}{}", zeros, frac_str);
        }
        let trimmed = frac_str.trim_end_matches('0');
        if self.is_negative() {
            format!("-{}.{}", int_str, trimmed)
        } else {
            format!("{}.{}", int_str, trimmed)
        }
    }

    pub fn to_f64_approx(self) -> f64 {
        self.format_dp(6).parse::<f64>().unwrap_or(0.0)
    }
}

impl Ord for Dec {
    fn cmp(&self, other: &Self) -> Ordering {
        match (self.is_negative(), other.is_negative()) {
            (true, false) => Ordering::Less,
            (false, true) => Ordering::Greater,
            (false, false) => self.mag.cmp(&other.mag),
            (true, true) => other.mag.cmp(&self.mag),
        }
    }
}

impl PartialOrd for Dec {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

pub fn round_cny(v: Dec) -> Dec {
    v.round_dp(2)
}

pub fn format_cny(v: Dec) -> String {
    v.format_dp(2)
}

pub fn round_rate(v: Dec) -> Dec {
    v.round_dp(6)
}

pub fn format_rate(v: Dec) -> String {
    v.format_dp(6)
}

pub fn sum_cny(values: &[Dec]) -> Dec {
    let mut total = Dec::ZERO;
    for &v in values {
        total = total.add(v);
    }
    total.round_dp(2)
}

pub fn equals_cny(a: Dec, b: Dec) -> bool {
    a.round_dp(2) == b.round_dp(2)
}

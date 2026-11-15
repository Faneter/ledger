use alloc::collections::BTreeMap;
use alloc::string::String;

use crate::decimal::{Dec, format_cny, format_rate, round_cny};
use crate::json::JsonVal;

pub const DEFAULT_FX_RATES: &[(&str, &str)] = &[
    ("CNY", "1.000000"),
    ("USD", "7.200000"),
    ("EUR", "7.800000"),
    ("JPY", "0.048000"),
    ("GBP", "9.100000"),
    ("HKD", "0.920000"),
];

pub fn lookup_default_fx_rate(currency: &str) -> &'static str {
    for &(code, rate) in DEFAULT_FX_RATES {
        if code.eq_ignore_ascii_case(currency) {
            return rate;
        }
    }
    "7.200000"
}

pub fn process_mastercard_fx_lifecycle(
    foreign_amount: Dec,
    hold_amount_cny: Dec,
    settled_amount_cny: Option<Dec>,
    hold_ratio: Dec,
    cashback_rate: Dec,
    monthly_remaining_cap_cny: Option<Dec>,
) -> Result<JsonVal, String> {
    let hold_amount_dec = round_cny(hold_amount_cny);
    let mut map = BTreeMap::new();

    if settled_amount_cny.is_none() {
        let estimated_base = round_cny(hold_amount_dec.checked_div(hold_ratio)?);
        let raw_cashback = round_cny(estimated_base.mul(cashback_rate));

        let estimated_cashback = match monthly_remaining_cap_cny {
            Some(cap_in) => {
                let cap = cap_in.max(Dec::ZERO);
                round_cny(raw_cashback.min(cap))
            }
            None => raw_cashback,
        };

        let total_net = round_cny(estimated_base.sub(estimated_cashback));
        let exchange_rate = format_rate(estimated_base.checked_div(foreign_amount)?);

        map.insert(String::from("status"), JsonVal::Str(String::from("PENDING_HOLD")));
        map.insert(
            String::from("hold_amount_cny"),
            JsonVal::Str(format_cny(hold_amount_dec)),
        );
        map.insert(
            String::from("total_gross"),
            JsonVal::Str(format_cny(estimated_base)),
        );
        map.insert(
            String::from("payment_discount"),
            JsonVal::Str(format_cny(estimated_cashback)),
        );
        map.insert(String::from("total_net"), JsonVal::Str(format_cny(total_net)));
        map.insert(String::from("exchange_rate"), JsonVal::Str(exchange_rate));
    } else if let Some(settled_in) = settled_amount_cny {
        let settled_base = round_cny(settled_in);
        let raw_cashback = round_cny(settled_base.mul(cashback_rate));

        let actual_cashback = match monthly_remaining_cap_cny {
            Some(cap_in) => {
                let cap = cap_in.max(Dec::ZERO);
                round_cny(raw_cashback.min(cap))
            }
            None => raw_cashback,
        };

        let released_hold = round_cny(hold_amount_dec.sub(settled_base));
        let total_net = round_cny(settled_base.sub(actual_cashback));
        let exchange_rate = format_rate(settled_base.checked_div(foreign_amount)?);

        map.insert(String::from("status"), JsonVal::Str(String::from("SETTLED")));
        map.insert(
            String::from("hold_amount_cny"),
            JsonVal::Str(String::from("0.00")),
        );
        map.insert(
            String::from("released_to_available"),
            JsonVal::Str(format_cny(released_hold)),
        );
        map.insert(
            String::from("total_gross"),
            JsonVal::Str(format_cny(settled_base)),
        );
        map.insert(
            String::from("payment_discount"),
            JsonVal::Str(format_cny(actual_cashback)),
        );
        map.insert(String::from("total_net"), JsonVal::Str(format_cny(total_net)));
        map.insert(String::from("exchange_rate"), JsonVal::Str(exchange_rate));
    }

    Ok(JsonVal::Obj(map))
}

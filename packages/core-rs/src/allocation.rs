use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::String;
use alloc::vec::Vec;

use crate::decimal::{Dec, format_cny, round_cny, sum_cny};
use crate::json::JsonVal;

#[derive(Clone, Debug)]
pub struct SplitItemInput {
    pub name: String,
    pub gross: Dec,
    pub category_id: String,
    pub budget_pool_id: Option<String>,
    pub project_tag_id: Option<String>,
    pub is_primary: Option<bool>,
    pub extra: BTreeMap<String, JsonVal>,
}

#[derive(Clone, Debug)]
pub struct SplitItemResult {
    pub input: SplitItemInput,
    pub gross: String,
    pub allocated_discount: String,
    pub net: String,
}

impl SplitItemResult {
    pub fn to_json(&self) -> JsonVal {
        let mut m = self.input.extra.clone();
        m.insert(String::from("name"), JsonVal::Str(self.input.name.clone()));
        m.insert(String::from("gross"), JsonVal::Str(self.gross.clone()));
        m.insert(
            String::from("category_id"),
            JsonVal::Str(self.input.category_id.clone()),
        );
        if let Some(ref bp) = self.input.budget_pool_id {
            m.insert(String::from("budget_pool_id"), JsonVal::Str(bp.clone()));
        }
        if let Some(ref pt) = self.input.project_tag_id {
            m.insert(String::from("project_tag_id"), JsonVal::Str(pt.clone()));
        } else if self.input.extra.contains_key("project_tag_id") {
            // Preserve explicit null if present in extra
        }
        if let Some(prim) = self.input.is_primary {
            m.insert(String::from("is_primary"), JsonVal::Bool(prim));
        }
        m.insert(
            String::from("allocated_discount"),
            JsonVal::Str(self.allocated_discount.clone()),
        );
        m.insert(String::from("net"), JsonVal::Str(self.net.clone()));
        JsonVal::Obj(m)
    }
}

#[derive(Clone, Debug)]
pub struct VoucherRedemptionInfo {
    pub face_value: Dec,
    pub acquire_cost: Dec,
    pub voucher_type: String,
}

#[derive(Clone, Debug)]
pub struct AllocationComputationResult {
    pub total_gross: String,
    pub total_discount: String,
    pub total_net: String,
    pub cash_paid: String,
    pub voucher_net_savings: String,
    pub voucher_cost_carryover: String,
    pub items: Vec<SplitItemResult>,
}

impl AllocationComputationResult {
    pub fn to_json(&self) -> JsonVal {
        let mut m = BTreeMap::new();
        m.insert(String::from("total_gross"), JsonVal::Str(self.total_gross.clone()));
        m.insert(
            String::from("total_discount"),
            JsonVal::Str(self.total_discount.clone()),
        );
        m.insert(String::from("total_net"), JsonVal::Str(self.total_net.clone()));
        m.insert(String::from("cash_paid"), JsonVal::Str(self.cash_paid.clone()));
        m.insert(
            String::from("voucher_net_savings"),
            JsonVal::Str(self.voucher_net_savings.clone()),
        );
        m.insert(
            String::from("voucher_cost_carryover"),
            JsonVal::Str(self.voucher_cost_carryover.clone()),
        );
        m.insert(
            String::from("items"),
            JsonVal::Arr(self.items.iter().map(SplitItemResult::to_json).collect()),
        );
        JsonVal::Obj(m)
    }
}

fn make_row(item: &SplitItemInput, gross: Dec, disc: Dec, net: Dec) -> SplitItemResult {
    SplitItemResult {
        input: item.clone(),
        gross: format_cny(gross),
        allocated_discount: format_cny(disc),
        net: format_cny(net),
    }
}

pub fn allocate_split_discounts(
    items: &[SplitItemInput],
    total_net_paid: Dec,
    mode: &str,
    manual_nets: Option<&[Dec]>,
) -> Result<Vec<SplitItemResult>, String> {
    if items.is_empty() {
        return Ok(Vec::new());
    }

    let net_paid_dec = round_cny(total_net_paid);
    let mut total_gross_dec = Dec::ZERO;
    for it in items {
        total_gross_dec = total_gross_dec.add(it.gross);
    }
    let total_discount_dec = round_cny(total_gross_dec.sub(net_paid_dec));

    // 1. MANUAL mode
    if mode == "MANUAL" {
        let nets = match manual_nets {
            Some(n) if n.len() == items.len() => n,
            other => {
                let got = other.map(|n| n.len()).unwrap_or(0);
                return Err(format!(
                    "MANUAL allocation requires manualNets matching items length (expected {}, got {})",
                    items.len(),
                    got
                ));
            }
        };
        let manual_sum = sum_cny(nets);
        if manual_sum != net_paid_dec {
            return Err(format!(
                "MANUAL allocation sum ({}) does not equal totalNetPaid ({}), violating conservation law",
                format_cny(manual_sum),
                format_cny(net_paid_dec)
            ));
        }
        return Ok(items
            .iter()
            .enumerate()
            .map(|(idx, item)| {
                let gross = round_cny(item.gross);
                let net = round_cny(nets[idx]);
                let discount = gross.sub(net);
                make_row(item, gross, discount, net)
            })
            .collect());
    }

    // 2. SINGLE or single item
    if items.len() == 1 || mode == "SINGLE" {
        return Ok(items
            .iter()
            .enumerate()
            .map(|(idx, item)| {
                let gross = round_cny(item.gross);
                if idx == 0 {
                    let net = round_cny(gross.sub(total_discount_dec));
                    make_row(item, gross, total_discount_dec, net)
                } else {
                    make_row(item, gross, Dec::ZERO, gross)
                }
            })
            .collect());
    }

    // 3. discount <= 0
    if total_discount_dec <= Dec::ZERO {
        if total_discount_dec.is_zero() {
            return Ok(items
                .iter()
                .map(|item| {
                    let gross = round_cny(item.gross);
                    make_row(item, gross, Dec::ZERO, gross)
                })
                .collect());
        }
        return Ok(items
            .iter()
            .enumerate()
            .map(|(idx, item)| {
                let gross = round_cny(item.gross);
                if idx == items.len() - 1 {
                    let net = round_cny(gross.sub(total_discount_dec));
                    make_row(item, gross, total_discount_dec, net)
                } else {
                    make_row(item, gross, Dec::ZERO, gross)
                }
            })
            .collect());
    }

    // 4. PRIMARY_ITEM
    if mode == "PRIMARY_ITEM" {
        let target_idx = items
            .iter()
            .position(|it| it.is_primary == Some(true))
            .unwrap_or(0);

        return Ok(items
            .iter()
            .enumerate()
            .map(|(idx, item)| {
                let gross = round_cny(item.gross);
                if idx == target_idx {
                    let net = round_cny(gross.sub(total_discount_dec));
                    make_row(item, gross, total_discount_dec, net)
                } else {
                    make_row(item, gross, Dec::ZERO, gross)
                }
            })
            .collect());
    }

    // 5. PROPORTIONAL (default): proportional weight by gross, last item absorbs penny diff
    let mut accumulated_discount = Dec::ZERO;
    let mut result = Vec::with_capacity(items.len());
    for (i, item) in items.iter().enumerate() {
        let gross = round_cny(item.gross);
        let disc = if i < items.len() - 1 {
            let d = if total_gross_dec.is_zero() {
                Dec::ZERO
            } else {
                let ratio = gross.checked_div(total_gross_dec)?;
                round_cny(total_discount_dec.mul(ratio))
            };
            accumulated_discount = accumulated_discount.add(d);
            d
        } else {
            round_cny(total_discount_dec.sub(accumulated_discount))
        };
        let net = round_cny(gross.sub(disc));
        result.push(make_row(item, gross, disc, net));
    }

    Ok(result)
}

pub fn apply_voucher_to_order(
    order_gross: Dec,
    cash_actually_paid: Dec,
    voucher: &VoucherRedemptionInfo,
) -> JsonVal {
    let gross_dec = round_cny(order_gross);
    let cash_paid_dec = round_cny(cash_actually_paid);
    let acquire_cost_dec = round_cny(voucher.acquire_cost);
    let face_value_dec = round_cny(voucher.face_value);

    let effective_budget_net = round_cny(cash_paid_dec.add(acquire_cost_dec));
    let net_savings = round_cny(face_value_dec.sub(acquire_cost_dec));

    let mut m = BTreeMap::new();
    m.insert(String::from("order_gross"), JsonVal::Str(format_cny(gross_dec)));
    m.insert(String::from("cash_paid"), JsonVal::Str(format_cny(cash_paid_dec)));
    m.insert(
        String::from("voucher_acquire_cost"),
        JsonVal::Str(format_cny(acquire_cost_dec)),
    );
    m.insert(
        String::from("effective_budget_net"),
        JsonVal::Str(format_cny(effective_budget_net)),
    );
    m.insert(
        String::from("net_savings"),
        JsonVal::Str(format_cny(net_savings)),
    );
    JsonVal::Obj(m)
}

pub fn compute_order_allocation(
    items: &[SplitItemInput],
    cash_actually_paid: Dec,
    mode: &str,
    voucher: Option<&VoucherRedemptionInfo>,
    manual_nets: Option<&[Dec]>,
) -> Result<AllocationComputationResult, String> {
    let mut sum_gross = Dec::ZERO;
    for it in items {
        sum_gross = sum_gross.add(it.gross);
    }
    let total_gross_dec = round_cny(sum_gross);
    let cash_paid_dec = round_cny(cash_actually_paid);

    let mut voucher_savings = Dec::ZERO;
    let mut voucher_cost = Dec::ZERO;
    if let Some(v) = voucher {
        voucher_cost = round_cny(v.acquire_cost);
        voucher_savings = round_cny(v.face_value.sub(voucher_cost));
    }

    let effective_budget_net_dec = round_cny(cash_paid_dec.add(voucher_cost));
    let total_discount_dec = round_cny(total_gross_dec.sub(effective_budget_net_dec));
    let split_items =
        allocate_split_discounts(items, effective_budget_net_dec, mode, manual_nets)?;

    Ok(AllocationComputationResult {
        total_gross: format_cny(total_gross_dec),
        total_discount: format_cny(total_discount_dec),
        total_net: format_cny(effective_budget_net_dec),
        cash_paid: format_cny(cash_paid_dec),
        voucher_net_savings: format_cny(voucher_savings),
        voucher_cost_carryover: format_cny(voucher_cost),
        items: split_items,
    })
}

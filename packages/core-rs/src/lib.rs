#![cfg_attr(target_arch = "wasm32", no_std)]

extern crate alloc;

pub mod allocation;
pub mod decimal;
pub mod dsl;
pub mod fx;
pub mod hlc;
pub mod json;
pub mod money;

use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::alloc::Layout;

use allocation::{
    SplitItemInput, VoucherRedemptionInfo, allocate_split_discounts, apply_voucher_to_order,
    compute_order_allocation,
};
use decimal::{Dec, equals_cny, format_cny, format_rate, round_cny, round_rate, sum_cny};
use dsl::{
    BudgetPoolDef, CategoryDef, ProjectTagDef, evaluate_math_formula, parse_quick_input_dsl,
};
use fx::process_mastercard_fx_lifecycle;
use hlc::{SyncOpLogEntry, hlc_compare, hlc_now, hlc_parse, hlc_receive, merge_oplog_entries};
use json::{JsonVal, parse_json};
use money::generate_voucher_title;

// ============================================================================
// wasm32 no_std allocator & panic handler
// ============================================================================

#[cfg(target_arch = "wasm32")]
mod wasm_rt {
    use core::alloc::{GlobalAlloc, Layout};
    use core::arch::wasm32;
    use core::cell::UnsafeCell;
    use core::panic::PanicInfo;
    use core::ptr;

    #[repr(C, align(16))]
    struct FreeBlock {
        size: usize,
        next: *mut FreeBlock,
    }

    struct SyncCell(UnsafeCell<*mut FreeBlock>);
    unsafe impl Sync for SyncCell {}

    static FREE_HEAD: SyncCell = SyncCell(UnsafeCell::new(ptr::null_mut()));

    pub struct WasmFreeListAlloc;

    unsafe impl GlobalAlloc for WasmFreeListAlloc {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            let align = layout.align().max(16);
            let need = ((layout.size().max(16)) + 15) & !15;
            unsafe {
                let head_ptr = FREE_HEAD.0.get();
                // Try first-fit aligned block in free list.
                let mut prev: *mut *mut FreeBlock = head_ptr;
                let mut cur = *head_ptr;
                while !cur.is_null() {
                    let addr = cur as usize;
                    let size = (*cur).size;
                    if addr.is_multiple_of(align) && size >= need {
                        let next_blk = (*cur).next;
                        let rem = size - need;
                        if rem >= 16 {
                            let rem_blk = (addr + need) as *mut FreeBlock;
                            (*rem_blk).size = rem;
                            (*rem_blk).next = next_blk;
                            *prev = rem_blk;
                        } else {
                            *prev = next_blk;
                        }
                        return addr as *mut u8;
                    }
                    prev = &raw mut (*cur).next;
                    cur = (*cur).next;
                }

                // Fallback: grow linear memory by enough 64KiB pages.
                let total_bytes = need.max(align);
                let pages = total_bytes.div_ceil(65536);
                let prev_pages = wasm32::memory_grow(0, pages);
                if prev_pages == usize::MAX {
                    return ptr::null_mut();
                }
                let base_addr = prev_pages * 65536;
                let grown_bytes = pages * 65536;
                let rem = grown_bytes - need;
                if rem >= 16 {
                    let rem_blk = (base_addr + need) as *mut FreeBlock;
                    (*rem_blk).size = rem;
                    (*rem_blk).next = ptr::null_mut();
                    self.insert_coalesced(rem_blk);
                }
                base_addr as *mut u8
            }
        }

        unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
            if ptr.is_null() {
                return;
            }
            let block_size = ((layout.size().max(16)) + 15) & !15;
            let blk = ptr as *mut FreeBlock;
            unsafe {
                (*blk).size = block_size;
                (*blk).next = ptr::null_mut();
                self.insert_coalesced(blk);
            }
        }
    }

    impl WasmFreeListAlloc {
        unsafe fn insert_coalesced(&self, blk: *mut FreeBlock) {
            unsafe {
                let head_ptr = FREE_HEAD.0.get();
                let blk_addr = blk as usize;
                let mut prev: *mut *mut FreeBlock = head_ptr;
                let mut cur = *head_ptr;
                let mut prev_blk: *mut FreeBlock = ptr::null_mut();

                while !cur.is_null() && (cur as usize) < blk_addr {
                    prev_blk = cur;
                    prev = &raw mut (*cur).next;
                    cur = (*cur).next;
                }

                (*blk).next = cur;
                *prev = blk;

                // Coalesce with right neighbor
                if !cur.is_null() && blk_addr + (*blk).size == (cur as usize) {
                    (*blk).size += (*cur).size;
                    (*blk).next = (*cur).next;
                }

                // Coalesce with left neighbor
                if !prev_blk.is_null() && (prev_blk as usize) + (*prev_blk).size == blk_addr {
                    (*prev_blk).size += (*blk).size;
                    (*prev_blk).next = (*blk).next;
                }
            }
        }
    }

    #[global_allocator]
    static ALLOCATOR: WasmFreeListAlloc = WasmFreeListAlloc;

    #[panic_handler]
    fn panic(_info: &PanicInfo) -> ! {
        wasm32::unreachable()
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn memcmp(s1: *const u8, s2: *const u8, n: usize) -> i32 {
        let mut i = 0;
        while i < n {
            let a = unsafe { *s1.add(i) };
            let b = unsafe { *s2.add(i) };
            if a != b {
                return (a as i32) - (b as i32);
            }
            i += 1;
        }
        0
    }
}

// ============================================================================
// JSON Dispatch Core
// ============================================================================

fn parse_dec_val(v: &JsonVal) -> Result<Dec, String> {
    match v {
        JsonVal::Str(s) => Dec::parse(s),
        JsonVal::Num(n) => Dec::parse(n),
        other => Err(format!("Expected decimal string or number, got {:?}", other)),
    }
}

fn parse_split_items(arr: &[JsonVal]) -> Result<Vec<SplitItemInput>, String> {
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        let obj = v
            .as_obj()
            .ok_or_else(|| String::from("SplitItemInput must be an object"))?;
        let name = obj
            .get("name")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let gross = obj
            .get("gross")
            .ok_or_else(|| String::from("Missing gross on split item"))
            .and_then(parse_dec_val)?;
        let category_id = obj
            .get("category_id")
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string();
        let budget_pool_id = obj
            .get("budget_pool_id")
            .and_then(|x| x.as_str())
            .map(ToString::to_string);
        let project_tag_id = obj
            .get("project_tag_id")
            .and_then(|x| x.as_str())
            .map(ToString::to_string);
        let is_primary = obj.get("is_primary").and_then(|x| x.as_bool());
        out.push(SplitItemInput {
            name,
            gross,
            category_id,
            budget_pool_id,
            project_tag_id,
            is_primary,
            extra: obj.clone(),
        });
    }
    Ok(out)
}

fn parse_voucher(v: &JsonVal) -> Result<VoucherRedemptionInfo, String> {
    let face_value = v
        .get("face_value")
        .or_else(|| v.get("faceValue"))
        .ok_or_else(|| String::from("Missing face_value on voucher"))
        .and_then(parse_dec_val)?;
    let acquire_cost = v
        .get("acquire_cost")
        .or_else(|| v.get("acquireCost"))
        .ok_or_else(|| String::from("Missing acquire_cost on voucher"))
        .and_then(parse_dec_val)?;
    let voucher_type = v
        .get("voucher_type")
        .or_else(|| v.get("voucherType"))
        .and_then(|x| x.as_str())
        .unwrap_or("PREPAID_COUPON")
        .to_string();
    Ok(VoucherRedemptionInfo {
        face_value,
        acquire_cost,
        voucher_type,
    })
}

fn parse_categories(arr: &[JsonVal]) -> Result<Vec<CategoryDef>, String> {
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(CategoryDef {
            id: v
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            parent_id: v
                .get_non_null("parent_id")
                .and_then(|x| x.as_str())
                .map(ToString::to_string),
            name: v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            default_pool_id: v
                .get("default_pool_id")
                .and_then(|x| x.as_str())
                .unwrap_or("POOL_DAILY")
                .to_string(),
            keywords: v
                .get_non_null("keywords")
                .and_then(|x| x.as_str())
                .map(ToString::to_string),
            sort_order: v.get("sort_order").and_then(|x| x.as_i64()).unwrap_or(0),
        });
    }
    Ok(out)
}

fn parse_project_tags(arr: &[JsonVal]) -> Result<Vec<ProjectTagDef>, String> {
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(ProjectTagDef {
            id: v
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            name: v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            tag_type: v
                .get("tag_type")
                .and_then(|x| x.as_str())
                .unwrap_or("PROJECT")
                .to_string(),
            target_budget: v
                .get_non_null("target_budget")
                .and_then(|x| x.as_num_or_str()),
            linked_pool_id: v
                .get_non_null("linked_pool_id")
                .and_then(|x| x.as_str())
                .map(ToString::to_string),
            is_active: v.get("is_active").and_then(|x| x.as_bool()).unwrap_or(true),
        });
    }
    Ok(out)
}

fn parse_budget_pools(arr: &[JsonVal]) -> Result<Vec<BudgetPoolDef>, String> {
    let mut out = Vec::with_capacity(arr.len());
    for v in arr {
        out.push(BudgetPoolDef {
            id: v
                .get("id")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            name: v
                .get("name")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            pool_type: v
                .get("pool_type")
                .and_then(|x| x.as_str())
                .unwrap_or("FLEX")
                .to_string(),
            is_monthly_budget: v
                .get("is_monthly_budget")
                .and_then(|x| x.as_bool())
                .unwrap_or(true),
            rollover_strategy: v
                .get("rollover_strategy")
                .and_then(|x| x.as_str())
                .unwrap_or("RESET")
                .to_string(),
        });
    }
    Ok(out)
}

fn ok_json(data: JsonVal) -> String {
    let mut m = BTreeMap::new();
    m.insert(String::from("ok"), JsonVal::Bool(true));
    m.insert(String::from("data"), data);
    JsonVal::Obj(m).to_json_string()
}

fn err_json(msg: &str) -> String {
    let mut m = BTreeMap::new();
    m.insert(String::from("ok"), JsonVal::Bool(false));
    m.insert(String::from("error"), JsonVal::Str(msg.to_string()));
    JsonVal::Obj(m).to_json_string()
}

pub fn dispatch_op(req_str: &str) -> String {
    match dispatch_op_inner(req_str) {
        Ok(val) => ok_json(val),
        Err(msg) => err_json(&msg),
    }
}

fn dispatch_op_inner(req_str: &str) -> Result<JsonVal, String> {
    let req = parse_json(req_str)?;
    let op = req
        .get("op")
        .and_then(|v| v.as_str())
        .ok_or_else(|| String::from("Missing 'op' field"))?;

    match op {
        "round_cny" => {
            let v = req
                .get("value")
                .ok_or_else(|| String::from("Missing 'value'"))
                .and_then(parse_dec_val)?;
            Ok(JsonVal::Str(round_cny(v).format_trimmed()))
        }
        "format_cny" => {
            let v = req
                .get("value")
                .ok_or_else(|| String::from("Missing 'value'"))
                .and_then(parse_dec_val)?;
            Ok(JsonVal::Str(format_cny(v)))
        }
        "round_rate" => {
            let v = req
                .get("value")
                .ok_or_else(|| String::from("Missing 'value'"))
                .and_then(parse_dec_val)?;
            Ok(JsonVal::Str(round_rate(v).format_trimmed()))
        }
        "format_rate" => {
            let v = req
                .get("value")
                .ok_or_else(|| String::from("Missing 'value'"))
                .and_then(parse_dec_val)?;
            Ok(JsonVal::Str(format_rate(v)))
        }
        "sum_cny" => {
            let arr = req
                .get("values")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| String::from("Missing 'values' array"))?;
            let mut vals = Vec::with_capacity(arr.len());
            for item in arr {
                vals.push(parse_dec_val(item)?);
            }
            Ok(JsonVal::Str(format_cny(sum_cny(&vals))))
        }
        "equals_cny" => {
            let a = req
                .get("a")
                .ok_or_else(|| String::from("Missing 'a'"))
                .and_then(parse_dec_val)?;
            let b = req
                .get("b")
                .ok_or_else(|| String::from("Missing 'b'"))
                .and_then(parse_dec_val)?;
            Ok(JsonVal::Bool(equals_cny(a, b)))
        }
        "generate_voucher_title" => {
            let vt = req
                .get("voucherType")
                .or_else(|| req.get("voucher_type"))
                .and_then(|v| v.as_str())
                .unwrap_or("FREE_COUPON");
            let face = req
                .get("faceValue")
                .or_else(|| req.get("face_value"))
                .ok_or_else(|| String::from("Missing faceValue"))
                .and_then(parse_dec_val)?;
            let min_spend = req
                .get("minSpend")
                .or_else(|| req.get("min_spend"))
                .map(parse_dec_val)
                .transpose()?
                .unwrap_or(Dec::ZERO);
            Ok(JsonVal::Str(generate_voucher_title(vt, face, min_spend)))
        }
        "evaluate_math_formula" => {
            let expr = req
                .get("expr")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'expr'"))?;
            Ok(evaluate_math_formula(expr)?.to_json())
        }
        "parse_quick_input_dsl" => {
            let raw_text = req
                .get("rawText")
                .or_else(|| req.get("raw_text"))
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'rawText'"))?;
            let ctx = req.get_non_null("context");
            let cats = ctx
                .and_then(|c| c.get_non_null("categories"))
                .and_then(|v| v.as_arr())
                .map(parse_categories)
                .transpose()?;
            let tags = ctx
                .and_then(|c| c.get_non_null("projectTags").or_else(|| c.get_non_null("project_tags")))
                .and_then(|v| v.as_arr())
                .map(parse_project_tags)
                .transpose()?;
            let pools = ctx
                .and_then(|c| c.get_non_null("budgetPools").or_else(|| c.get_non_null("budget_pools")))
                .and_then(|v| v.as_arr())
                .map(parse_budget_pools)
                .transpose()?;
            let fx_cfg = ctx.and_then(|c| c.get_non_null("fxConfig").or_else(|| c.get_non_null("fx_config")));
            let hold_ratio_raw = fx_cfg
                .and_then(|f| f.get_non_null("defaultHoldRatio"))
                .and_then(|v| v.as_num_or_str())
                .unwrap_or_else(|| String::from("1.02"));
            let cashback_rate_raw = fx_cfg
                .and_then(|f| f.get_non_null("defaultCashbackRate"))
                .and_then(|v| v.as_num_or_str())
                .unwrap_or_else(|| String::from("0.01"));

            parse_quick_input_dsl(
                raw_text,
                cats.as_deref(),
                tags.as_deref(),
                pools.as_deref(),
                Dec::parse(&hold_ratio_raw)?,
                Dec::parse(&cashback_rate_raw)?,
                &cashback_rate_raw,
            )
        }
        "allocate_split_discounts" => {
            let items_arr = req
                .get("items")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| String::from("Missing 'items' array"))?;
            let items = parse_split_items(items_arr)?;
            let total_net = req
                .get("totalNetPaid")
                .or_else(|| req.get("total_net_paid"))
                .ok_or_else(|| String::from("Missing 'totalNetPaid'"))
                .and_then(parse_dec_val)?;
            let mode = req
                .get_non_null("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("PROPORTIONAL");
            let manual_nets = req
                .get_non_null("manualNets")
                .or_else(|| req.get_non_null("manual_nets"))
                .and_then(|v| v.as_arr())
                .map(|arr| arr.iter().map(parse_dec_val).collect::<Result<Vec<_>, _>>())
                .transpose()?;

            let res = allocate_split_discounts(
                &items,
                total_net,
                mode,
                manual_nets.as_deref(),
            )?;
            Ok(JsonVal::Arr(res.iter().map(|r| r.to_json()).collect()))
        }
        "apply_voucher_to_order" => {
            let order_gross = req
                .get("orderGross")
                .or_else(|| req.get("order_gross"))
                .ok_or_else(|| String::from("Missing 'orderGross'"))
                .and_then(parse_dec_val)?;
            let cash_paid = req
                .get("cashActuallyPaidAfterVoucher")
                .or_else(|| req.get("cash_paid"))
                .ok_or_else(|| String::from("Missing 'cashActuallyPaidAfterVoucher'"))
                .and_then(parse_dec_val)?;
            let voucher_val = req
                .get("voucher")
                .ok_or_else(|| String::from("Missing 'voucher'"))?;
            let voucher = parse_voucher(voucher_val)?;
            Ok(apply_voucher_to_order(order_gross, cash_paid, &voucher))
        }
        "compute_order_allocation" => {
            let items_arr = req
                .get("items")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| String::from("Missing 'items' array"))?;
            let items = parse_split_items(items_arr)?;
            let cash_paid = req
                .get("cashActuallyPaid")
                .or_else(|| req.get("cash_actually_paid"))
                .ok_or_else(|| String::from("Missing 'cashActuallyPaid'"))
                .and_then(parse_dec_val)?;
            let mode = req
                .get_non_null("mode")
                .and_then(|v| v.as_str())
                .unwrap_or("PROPORTIONAL");
            let voucher = req
                .get_non_null("voucher")
                .map(parse_voucher)
                .transpose()?;
            let manual_nets = req
                .get_non_null("manualNets")
                .or_else(|| req.get_non_null("manual_nets"))
                .and_then(|v| v.as_arr())
                .map(|arr| arr.iter().map(parse_dec_val).collect::<Result<Vec<_>, _>>())
                .transpose()?;

            Ok(compute_order_allocation(
                &items,
                cash_paid,
                mode,
                voucher.as_ref(),
                manual_nets.as_deref(),
            )?
            .to_json())
        }
        "process_mastercard_fx_lifecycle" => {
            let foreign = req
                .get("foreignAmount")
                .or_else(|| req.get("foreign_amount"))
                .ok_or_else(|| String::from("Missing 'foreignAmount'"))
                .and_then(parse_dec_val)?;
            let hold = req
                .get("holdAmountCny")
                .or_else(|| req.get("hold_amount_cny"))
                .ok_or_else(|| String::from("Missing 'holdAmountCny'"))
                .and_then(parse_dec_val)?;
            let settled = req
                .get_non_null("settledAmountCny")
                .or_else(|| req.get_non_null("settled_amount_cny"))
                .map(parse_dec_val)
                .transpose()?;
            let hold_ratio = req
                .get_non_null("holdRatio")
                .or_else(|| req.get_non_null("hold_ratio"))
                .map(parse_dec_val)
                .transpose()?
                .unwrap_or_else(|| Dec::parse("1.02").unwrap());
            let cashback = req
                .get_non_null("cashbackRate")
                .or_else(|| req.get_non_null("cashback_rate"))
                .map(parse_dec_val)
                .transpose()?
                .unwrap_or_else(|| Dec::parse("0.01").unwrap());
            let cap = req
                .get_non_null("monthlyRemainingCapCny")
                .or_else(|| req.get_non_null("monthly_remaining_cap_cny"))
                .map(parse_dec_val)
                .transpose()?;

            process_mastercard_fx_lifecycle(foreign, hold, settled, hold_ratio, cashback, cap)
        }
        "hlc_parse" => {
            let hlc_str = req
                .get("hlc")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'hlc'"))?;
            let p = hlc_parse(hlc_str)?;
            let mut m = BTreeMap::new();
            m.insert(
                String::from("timestampMs"),
                JsonVal::Num(format!("{}", p.timestamp_ms)),
            );
            m.insert(
                String::from("counter"),
                JsonVal::Num(format!("{}", p.counter)),
            );
            m.insert(String::from("nodeId"), JsonVal::Str(p.node_id));
            Ok(JsonVal::Obj(m))
        }
        "hlc_compare" => {
            let a = req
                .get("a")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'a'"))?;
            let b = req
                .get("b")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'b'"))?;
            Ok(JsonVal::Num(format!("{}", hlc_compare(a, b)?)))
        }
        "hlc_now" => {
            let node_id = req
                .get("nodeId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'nodeId'"))?;
            let last_ts = req
                .get("lastPhysicalTimeMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let counter = req
                .get("counter")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let pt = req
                .get("physicalTimeMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let (hlc_s, next_ts, next_c) = hlc_now(node_id, last_ts, counter, pt);
            let mut m = BTreeMap::new();
            m.insert(String::from("hlc"), JsonVal::Str(hlc_s));
            m.insert(
                String::from("lastPhysicalTimeMs"),
                JsonVal::Num(format!("{}", next_ts)),
            );
            m.insert(String::from("counter"), JsonVal::Num(format!("{}", next_c)));
            Ok(JsonVal::Obj(m))
        }
        "hlc_receive" => {
            let node_id = req
                .get("nodeId")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'nodeId'"))?;
            let last_ts = req
                .get("lastPhysicalTimeMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let counter = req
                .get("counter")
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as u32;
            let remote_hlc = req
                .get("remoteHlc")
                .and_then(|v| v.as_str())
                .ok_or_else(|| String::from("Missing 'remoteHlc'"))?;
            let pt = req
                .get("physicalTimeMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0);
            let (hlc_s, next_ts, next_c) =
                hlc_receive(node_id, last_ts, counter, remote_hlc, pt)?;
            let mut m = BTreeMap::new();
            m.insert(String::from("hlc"), JsonVal::Str(hlc_s));
            m.insert(
                String::from("lastPhysicalTimeMs"),
                JsonVal::Num(format!("{}", next_ts)),
            );
            m.insert(String::from("counter"), JsonVal::Num(format!("{}", next_c)));
            Ok(JsonVal::Obj(m))
        }
        "merge_oplog_entries" => {
            let existing_arr = req
                .get("existingOps")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| String::from("Missing 'existingOps'"))?;
            let incoming_arr = req
                .get("incomingOps")
                .and_then(|v| v.as_arr())
                .ok_or_else(|| String::from("Missing 'incomingOps'"))?;
            let now_iso = req
                .get_non_null("nowIso")
                .and_then(|v| v.as_str())
                .unwrap_or("1970-01-01T00:00:00.000Z");

            let existing = existing_arr
                .iter()
                .map(SyncOpLogEntry::from_json)
                .collect::<Result<Vec<_>, _>>()?;
            let incoming = incoming_arr
                .iter()
                .map(SyncOpLogEntry::from_json)
                .collect::<Result<Vec<_>, _>>()?;
            merge_oplog_entries(&existing, &incoming, now_iso)
        }
        other => Err(format!("Unknown op: {}", other)),
    }
}

// ============================================================================
// C-ABI / WASM Exports
// ============================================================================

#[unsafe(no_mangle)]
pub extern "C" fn ledger_alloc(len: u32) -> *mut u8 {
    let size = (len as usize).max(1);
    let layout = match Layout::from_size_align(size, 8) {
        Ok(l) => l,
        Err(_) => return core::ptr::null_mut(),
    };
    unsafe { alloc::alloc::alloc(layout) }
}

#[unsafe(no_mangle)]
pub extern "C" fn ledger_dealloc(ptr: *mut u8, len: u32) {
    if ptr.is_null() {
        return;
    }
    let size = (len as usize).max(1);
    if let Ok(layout) = Layout::from_size_align(size, 8) {
        unsafe {
            alloc::alloc::dealloc(ptr, layout);
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn ledger_invoke(req_ptr: *const u8, req_len: u32, out_len: *mut u32) -> *mut u8 {
    let resp = if req_ptr.is_null() {
        err_json("Null request pointer")
    } else {
        let slice = unsafe { core::slice::from_raw_parts(req_ptr, req_len as usize) };
        match core::str::from_utf8(slice) {
            Ok(s) => dispatch_op(s),
            Err(_) => err_json("Request bytes are not valid UTF-8"),
        }
    };
    let bytes = resp.as_bytes();
    let byte_len = bytes.len() as u32;
    let out_ptr = ledger_alloc(byte_len);
    if out_ptr.is_null() {
        if !out_len.is_null() {
            unsafe { *out_len = 0 };
        }
        return core::ptr::null_mut();
    }
    unsafe {
        core::ptr::copy_nonoverlapping(bytes.as_ptr(), out_ptr, bytes.len());
        if !out_len.is_null() {
            *out_len = byte_len;
        }
    }
    out_ptr
}

// ============================================================================
// Unit Tests against docs/golden_test_cases.json
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    const GOLDEN_JSON: &str = include_str!("../../../docs/golden_test_cases.json");

    fn parse_golden() -> JsonVal {
        parse_json(GOLDEN_JSON).expect("golden_test_cases.json should parse")
    }

    #[test]
    fn test_golden_money_rounding_and_helpers() {
        let g = parse_golden();
        let suite = g.get("suites").unwrap().get("money_rounding_and_helpers").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let func = case.get("fn").unwrap().as_str().unwrap();
            let input = case.get("input").unwrap();
            let expected = case.get("expected").unwrap();

            match func {
                "roundCny" => {
                    let dec = Dec::parse(input.as_str().unwrap()).unwrap();
                    assert_eq!(format_cny(round_cny(dec)), expected.as_str().unwrap(), "case {}", id);
                }
                "roundRate" => {
                    let s = input.as_str().unwrap();
                    let val = if let Some(idx) = s.find('/') {
                        let a = Dec::parse(&s[..idx]).unwrap();
                        let b = Dec::parse(&s[idx + 1..]).unwrap();
                        a.checked_div(b).unwrap()
                    } else {
                        Dec::parse(s).unwrap()
                    };
                    assert_eq!(format_rate(round_rate(val)), expected.as_str().unwrap(), "case {}", id);
                }
                "sumCny" => {
                    let arr: Vec<Dec> = input.as_arr().unwrap().iter().map(|x| Dec::parse(x.as_str().unwrap()).unwrap()).collect();
                    assert_eq!(format_cny(sum_cny(&arr)), expected.as_str().unwrap(), "case {}", id);
                }
                "equalsCny" => {
                    let arr = input.as_arr().unwrap();
                    let a = Dec::parse(arr[0].as_str().unwrap()).unwrap();
                    let b = Dec::parse(arr[1].as_str().unwrap()).unwrap();
                    assert_eq!(equals_cny(a, b), expected.as_bool().unwrap(), "case {}", id);
                }
                "generateVoucherTitle" => {
                    let vt = input.get("voucherType").unwrap().as_str().unwrap();
                    let fv = Dec::parse(input.get("faceValue").unwrap().as_str().unwrap()).unwrap();
                    let ms = Dec::parse(input.get("minSpend").unwrap().as_str().unwrap()).unwrap();
                    assert_eq!(generate_voucher_title(vt, fv, ms), expected.as_str().unwrap(), "case {}", id);
                }
                other => panic!("Unknown money helper fn: {}", other),
            }
        }
    }

    #[test]
    fn test_golden_math_formula_eval() {
        let g = parse_golden();
        let suite = g.get("suites").unwrap().get("math_formula_eval").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let expr = case.get("input").unwrap().get("expr").unwrap().as_str().unwrap();
            let exp = case.get("expected").unwrap();
            let got = evaluate_math_formula(expr).unwrap_or_else(|e| panic!("case {} err: {}", id, e));
            assert_eq!(got.gross, exp.get("gross").unwrap().as_str().unwrap(), "case {} gross", id);
            assert_eq!(got.discount, exp.get("discount").unwrap().as_str().unwrap(), "case {} discount", id);
            assert_eq!(got.net, exp.get("net").unwrap().as_str().unwrap(), "case {} net", id);
        }
    }

    #[test]
    fn test_golden_dsl_parser() {
        let g = parse_golden();
        let meta = g.get("meta").unwrap();
        let cats = parse_categories(meta.get("seed_categories").unwrap().as_arr().unwrap()).unwrap();
        let tags = parse_project_tags(meta.get("seed_project_tags").unwrap().as_arr().unwrap()).unwrap();
        let pools = parse_budget_pools(meta.get("seed_budget_pools").unwrap().as_arr().unwrap()).unwrap();

        let suite = g.get("suites").unwrap().get("dsl_parser").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let input = case.get("input").unwrap();
            let raw_text = input.get("rawText").unwrap().as_str().unwrap();
            let fx_cfg = input.get_non_null("fxConfig");
            let hr = fx_cfg
                .and_then(|c| c.get("defaultHoldRatio"))
                .and_then(|x| x.as_str())
                .unwrap_or("1.02");
            let cr = fx_cfg
                .and_then(|c| c.get("defaultCashbackRate"))
                .and_then(|x| x.as_str())
                .unwrap_or("0.01");

            let got = parse_quick_input_dsl(
                raw_text,
                Some(&cats),
                Some(&tags),
                Some(&pools),
                Dec::parse(hr).unwrap(),
                Dec::parse(cr).unwrap(),
                cr,
            )
            .unwrap_or_else(|e| panic!("case {} failed: {}", id, e));

            let exp = case.get("expected").unwrap();
            for (k, exp_v) in exp.as_obj().unwrap() {
                let got_v = got.get(k).unwrap_or_else(|| panic!("case {} missing field {}", id, k));
                assert_eq!(got_v, exp_v, "case {} field {}", id, k);
            }
        }
    }

    #[test]
    fn test_golden_split_discount_allocation() {
        let g = parse_golden();
        let suite = g.get("suites").unwrap().get("split_discount_allocation").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let input = case.get("input").unwrap();
            let items = parse_split_items(input.get("items").unwrap().as_arr().unwrap()).unwrap();
            let net = parse_dec_val(input.get("totalNetPaid").unwrap()).unwrap();
            let mode = input.get_non_null("mode").and_then(|v| v.as_str()).unwrap_or("PROPORTIONAL");
            let manual = input
                .get_non_null("manualNets")
                .and_then(|v| v.as_arr())
                .map(|a| a.iter().map(parse_dec_val).collect::<Result<Vec<_>, _>>().unwrap());
            let got = allocate_split_discounts(&items, net, mode, manual.as_deref()).unwrap();
            let exp_items = case.get("expected").unwrap().as_arr().unwrap();
            assert_eq!(got.len(), exp_items.len(), "case {} len", id);
            for (i, (g_item, e_item)) in got.iter().zip(exp_items.iter()).enumerate() {
                let gj = g_item.to_json();
                for k in ["gross", "allocated_discount", "net"] {
                    assert_eq!(gj.get(k), e_item.get(k), "case {} item {} key {}", id, i, k);
                }
            }
        }
    }

    #[test]
    fn test_golden_voucher_cost_carryover() {
        let g = parse_golden();
        let suite = g.get("suites").unwrap().get("voucher_cost_carryover").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let func = case.get("fn").unwrap().as_str().unwrap();
            let input = case.get("input").unwrap();
            let exp = case.get("expected").unwrap();
            if func == "applyVoucherToOrder" {
                let og = parse_dec_val(input.get("orderGross").unwrap()).unwrap();
                let cp = parse_dec_val(input.get("cashActuallyPaidAfterVoucher").unwrap()).unwrap();
                let v = parse_voucher(input.get("voucher").unwrap()).unwrap();
                let got = apply_voucher_to_order(og, cp, &v);
                assert_eq!(&got, exp, "case {}", id);
            } else {
                let items = parse_split_items(input.get("items").unwrap().as_arr().unwrap()).unwrap();
                let cp = parse_dec_val(input.get("cashActuallyPaid").unwrap()).unwrap();
                let mode = input.get_non_null("mode").and_then(|v| v.as_str()).unwrap_or("PROPORTIONAL");
                let v = input.get_non_null("voucher").map(|x| parse_voucher(x).unwrap());
                let got = compute_order_allocation(&items, cp, mode, v.as_ref(), None).unwrap().to_json();
                assert_eq!(&got, exp, "case {}", id);
            }
        }
    }

    #[test]
    fn test_golden_mastercard_fx_lifecycle() {
        let g = parse_golden();
        let suite = g.get("suites").unwrap().get("mastercard_fx_lifecycle").unwrap().as_arr().unwrap();
        for case in suite {
            let id = case.get("id").unwrap().as_str().unwrap();
            let input = case.get("input").unwrap();
            let req = JsonVal::Obj({
                let mut m = input.as_obj().unwrap().clone();
                m.insert(String::from("op"), JsonVal::Str(String::from("process_mastercard_fx_lifecycle")));
                m
            });
            let resp_str = dispatch_op(&req.to_json_string());
            let resp = parse_json(&resp_str).unwrap();
            assert_eq!(resp.get("ok").unwrap().as_bool(), Some(true), "case {} err: {}", id, resp_str);
            assert_eq!(resp.get("data").unwrap(), case.get("expected").unwrap(), "case {}", id);
        }
    }

    #[test]
    fn test_ffi_roundtrip_and_hlc() {
        let req = br#"{"op":"hlc_now","nodeId":"mobile-1","lastPhysicalTimeMs":0,"counter":0,"physicalTimeMs":1700000000000}"#;
        let mut out_len: u32 = 0;
        let out_ptr = ledger_invoke(req.as_ptr(), req.len() as u32, &mut out_len);
        assert!(!out_ptr.is_null());
        let resp_slice = unsafe { core::slice::from_raw_parts(out_ptr, out_len as usize) };
        let resp_str = core::str::from_utf8(resp_slice).unwrap().to_string();
        ledger_dealloc(out_ptr, out_len);
        let parsed = parse_json(&resp_str).unwrap();
        assert_eq!(parsed.get("ok").unwrap().as_bool(), Some(true));
        assert_eq!(
            parsed.get("data").unwrap().get("hlc").unwrap().as_str().unwrap(),
            "001700000000000-0000-mobile-1"
        );
    }
}

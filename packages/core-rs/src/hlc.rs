use alloc::collections::{BTreeMap, BTreeSet};
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::cmp::Ordering;

use crate::json::{JsonVal, parse_json};

#[derive(Clone, Debug)]
pub struct ParsedHlc {
    pub timestamp_ms: i64,
    pub counter: u32,
    pub node_id: String,
}

#[derive(Clone, Debug)]
pub struct SyncOpLogEntry {
    pub hlc: String,
    pub node_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub op_type: String,
    pub payload_json: String,
    pub created_at: String,
    pub raw: BTreeMap<String, JsonVal>,
}

impl SyncOpLogEntry {
    pub fn from_json(v: &JsonVal) -> Result<Self, String> {
        let obj = v
            .as_obj()
            .ok_or_else(|| String::from("OpLog entry must be a JSON object"))?;
        let get_str = |k: &str| -> Result<String, String> {
            obj.get(k)
                .and_then(|x| x.as_str())
                .map(ToString::to_string)
                .ok_or_else(|| format!("Missing string field '{}' in OpLog entry", k))
        };
        Ok(Self {
            hlc: get_str("hlc")?,
            node_id: get_str("node_id")?,
            entity_type: get_str("entity_type")?,
            entity_id: match obj.get("entity_id") {
                Some(JsonVal::Str(s)) => s.clone(),
                Some(JsonVal::Num(n)) => n.clone(),
                _ => return Err(String::from("Missing 'entity_id' in OpLog entry")),
            },
            op_type: get_str("op_type")?,
            payload_json: get_str("payload_json")?,
            created_at: obj
                .get("created_at")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string(),
            raw: obj.clone(),
        })
    }

    pub fn to_json(&self) -> JsonVal {
        JsonVal::Obj(self.raw.clone())
    }
}

pub fn hlc_parse(hlc: &str) -> Result<ParsedHlc, String> {
    let first_dash = hlc
        .find('-')
        .ok_or_else(|| format!("Invalid HLC format: \"{}\"", hlc))?;
    let second_rel = hlc[first_dash + 1..]
        .find('-')
        .ok_or_else(|| format!("Invalid HLC format: \"{}\"", hlc))?;
    let second_dash = first_dash + 1 + second_rel;

    let ts_str = &hlc[..first_dash];
    let counter_str = &hlc[first_dash + 1..second_dash];
    let node_id = &hlc[second_dash + 1..];

    let timestamp_ms = ts_str
        .parse::<i64>()
        .map_err(|_| format!("Invalid HLC numbers in: \"{}\"", hlc))?;
    let counter = u32::from_str_radix(counter_str, 16)
        .map_err(|_| format!("Invalid HLC numbers in: \"{}\"", hlc))?;

    Ok(ParsedHlc {
        timestamp_ms,
        counter,
        node_id: node_id.to_string(),
    })
}

pub fn hlc_compare(a: &str, b: &str) -> Result<i32, String> {
    if a == b {
        return Ok(0);
    }
    let pa = hlc_parse(a)?;
    let pb = hlc_parse(b)?;

    match pa.timestamp_ms.cmp(&pb.timestamp_ms) {
        Ordering::Less => return Ok(-1),
        Ordering::Greater => return Ok(1),
        Ordering::Equal => {}
    }
    match pa.counter.cmp(&pb.counter) {
        Ordering::Less => return Ok(-1),
        Ordering::Greater => return Ok(1),
        Ordering::Equal => {}
    }
    match pa.node_id.cmp(&pb.node_id) {
        Ordering::Less => Ok(-1),
        Ordering::Greater => Ok(1),
        Ordering::Equal => Ok(0),
    }
}

pub fn hlc_format(timestamp_ms: i64, counter: u32, node_id: &str) -> String {
    format!("{:015}-{:04x}-{}", timestamp_ms, counter & 0xffff, node_id)
}

pub fn hlc_now(
    node_id: &str,
    last_physical_time_ms: i64,
    counter: u32,
    physical_time_ms: i64,
) -> (String, i64, u32) {
    let (next_ts, next_counter) = if physical_time_ms > last_physical_time_ms {
        (physical_time_ms, 0)
    } else {
        (last_physical_time_ms, counter + 1)
    };
    (hlc_format(next_ts, next_counter, node_id), next_ts, next_counter)
}

pub fn hlc_receive(
    node_id: &str,
    last_physical_time_ms: i64,
    counter: u32,
    remote_hlc: &str,
    physical_time_ms: i64,
) -> Result<(String, i64, u32), String> {
    let remote = hlc_parse(remote_hlc)?;
    let max_time = last_physical_time_ms
        .max(remote.timestamp_ms)
        .max(physical_time_ms);

    let next_counter = if max_time == last_physical_time_ms && max_time == remote.timestamp_ms {
        counter.max(remote.counter) + 1
    } else if max_time == last_physical_time_ms {
        counter + 1
    } else if max_time == remote.timestamp_ms {
        remote.counter + 1
    } else {
        0
    };

    Ok((
        hlc_format(max_time, next_counter, node_id),
        max_time,
        next_counter,
    ))
}

fn extract_str_or_num_field(payload: &JsonVal, keys: &[&str]) -> Option<String> {
    for &k in keys {
        if let Some(v) = payload.get_non_null(k) {
            if let Some(s) = v.as_num_or_str() {
                if !s.is_empty() {
                    return Some(s);
                }
            }
        }
    }
    if let Some(header) = payload.get_non_null("header") {
        for &k in keys {
            if let Some(v) = header.get_non_null(k) {
                if let Some(s) = v.as_num_or_str() {
                    if !s.is_empty() {
                        return Some(s);
                    }
                }
            }
        }
    }
    None
}

pub fn merge_oplog_entries(
    existing_ops: &[SyncOpLogEntry],
    incoming_ops: &[SyncOpLogEntry],
    now_iso: &str,
) -> Result<JsonVal, String> {
    let mut unique_ops_map: BTreeMap<String, SyncOpLogEntry> = BTreeMap::new();
    for op in existing_ops {
        hlc_parse(&op.hlc)?;
        unique_ops_map.insert(op.hlc.clone(), op.clone());
    }
    for op in incoming_ops {
        hlc_parse(&op.hlc)?;
        unique_ops_map.insert(op.hlc.clone(), op.clone());
    }

    let mut merged_ops: Vec<SyncOpLogEntry> = unique_ops_map.into_values().collect();
    merged_ops.sort_by(|a, b| match hlc_compare(&a.hlc, &b.hlc).unwrap_or(0) {
        x if x < 0 => Ordering::Less,
        x if x > 0 => Ordering::Greater,
        _ => Ordering::Equal,
    });

    let mut winning_entities: BTreeMap<String, SyncOpLogEntry> = BTreeMap::new();
    for op in &merged_ops {
        let entity_key = format!("{}:{}", op.entity_type, op.entity_id);
        winning_entities.insert(entity_key, op.clone());
    }

    let mut detected_conflicts: Vec<JsonVal> = Vec::new();

    // Conflict check 1: CONCURRENT_TX_EDIT / CONCURRENT_FX_SETTLE
    let mut existing_tx_map: BTreeMap<String, &SyncOpLogEntry> = BTreeMap::new();
    for op in existing_ops {
        if op.entity_type == "TRANSACTION" {
            let replace = match existing_tx_map.get(&op.entity_id) {
                None => true,
                Some(cur) => hlc_compare(&op.hlc, &cur.hlc)? > 0,
            };
            if replace {
                existing_tx_map.insert(op.entity_id.clone(), op);
            }
        }
    }

    let mut incoming_tx_map: BTreeMap<String, &SyncOpLogEntry> = BTreeMap::new();
    for op in incoming_ops {
        if op.entity_type == "TRANSACTION" {
            let replace = match incoming_tx_map.get(&op.entity_id) {
                None => true,
                Some(cur) => hlc_compare(&op.hlc, &cur.hlc)? > 0,
            };
            if replace {
                incoming_tx_map.insert(op.entity_id.clone(), op);
            }
        }
    }

    for (entity_id, exist_op) in &existing_tx_map {
        if let Some(incoming_op) = incoming_tx_map.get(entity_id) {
            if exist_op.node_id != incoming_op.node_id && exist_op.hlc != incoming_op.hlc {
                let cmp = hlc_compare(&exist_op.hlc, &incoming_op.hlc)?;
                let (winner_op, loser_op) = if cmp >= 0 {
                    (*exist_op, *incoming_op)
                } else {
                    (*incoming_op, *exist_op)
                };

                let winner_payload =
                    parse_json(&winner_op.payload_json).unwrap_or(JsonVal::Null);
                let loser_payload =
                    parse_json(&loser_op.payload_json).unwrap_or(JsonVal::Null);

                let winner_base_hlc = extract_str_or_num_field(&winner_payload, &["base_hlc"]);
                if winner_base_hlc.as_deref() == Some(loser_op.hlc.as_str()) {
                    continue;
                }

                let winner_status =
                    extract_str_or_num_field(&winner_payload, &["settlement_status"]);
                let loser_status =
                    extract_str_or_num_field(&loser_payload, &["settlement_status"]);

                let is_fx_settle = winner_status.is_some()
                    && loser_status.is_some()
                    && winner_status != loser_status;

                let conflict_type = if is_fx_settle {
                    "CONCURRENT_FX_SETTLE"
                } else {
                    "CONCURRENT_TX_EDIT"
                };

                let cid = format!("conflict_{}_{}_{}", conflict_type, entity_id, loser_op.hlc);
                let mut cm = BTreeMap::new();
                cm.insert(String::from("id"), JsonVal::Str(cid));
                cm.insert(
                    String::from("conflict_type"),
                    JsonVal::Str(conflict_type.to_string()),
                );
                cm.insert(String::from("entity_id"), JsonVal::Str(entity_id.clone()));
                cm.insert(
                    String::from("winner_hlc"),
                    JsonVal::Str(winner_op.hlc.clone()),
                );
                cm.insert(
                    String::from("loser_hlc"),
                    JsonVal::Str(loser_op.hlc.clone()),
                );
                cm.insert(
                    String::from("winner_summary"),
                    JsonVal::Str(format!(
                        "Winner (Node {}) updated transaction {} at HLC {}",
                        winner_op.node_id, entity_id, winner_op.hlc
                    )),
                );
                cm.insert(
                    String::from("loser_summary"),
                    JsonVal::Str(format!(
                        "Loser (Node {}) updated transaction {} at HLC {}",
                        loser_op.node_id, entity_id, loser_op.hlc
                    )),
                );
                cm.insert(
                    String::from("loser_payload_json"),
                    JsonVal::Str(loser_op.payload_json.clone()),
                );
                cm.insert(String::from("status"), JsonVal::Str(String::from("PENDING")));
                cm.insert(
                    String::from("created_at"),
                    JsonVal::Str(now_iso.to_string()),
                );
                detected_conflicts.push(JsonVal::Obj(cm));
            }
        }
    }

    // Conflict check 2: VOUCHER_DOUBLE_SPEND
    let mut voucher_spends: BTreeMap<String, Vec<(&SyncOpLogEntry, String)>> = BTreeMap::new();
    for op in winning_entities.values() {
        if op.entity_type == "TRANSACTION" && op.op_type == "UPSERT" {
            let payload = parse_json(&op.payload_json).unwrap_or(JsonVal::Null);
            if let Some(v_key) =
                extract_str_or_num_field(&payload, &["appliedVoucherId", "applied_voucher_id"])
            {
                let tx_id = extract_str_or_num_field(&payload, &["id"])
                    .unwrap_or_else(|| op.entity_id.clone());
                voucher_spends.entry(v_key).or_default().push((op, tx_id));
            }
        }
    }

    for (v_key, spends) in voucher_spends {
        let mut unique_spends: Vec<(&SyncOpLogEntry, String)> = Vec::new();
        let mut seen_tx: BTreeSet<String> = BTreeSet::new();
        for (op, tx_id) in spends {
            if seen_tx.insert(tx_id.clone()) {
                unique_spends.push((op, tx_id));
            }
        }
        if unique_spends.len() > 1 {
            unique_spends.sort_by(|a, b| match hlc_compare(&a.0.hlc, &b.0.hlc).unwrap_or(0) {
                x if x < 0 => Ordering::Less,
                x if x > 0 => Ordering::Greater,
                _ => Ordering::Equal,
            });
            let winner = &unique_spends[0];
            for loser in &unique_spends[1..] {
                let cid = format!("conflict_voucher_{}_{}", v_key, loser.1);
                let mut cm = BTreeMap::new();
                cm.insert(String::from("id"), JsonVal::Str(cid));
                cm.insert(
                    String::from("conflict_type"),
                    JsonVal::Str(String::from("VOUCHER_DOUBLE_SPEND")),
                );
                cm.insert(String::from("entity_id"), JsonVal::Str(v_key.clone()));
                cm.insert(
                    String::from("winner_hlc"),
                    JsonVal::Str(winner.0.hlc.clone()),
                );
                cm.insert(
                    String::from("loser_hlc"),
                    JsonVal::Str(loser.0.hlc.clone()),
                );
                cm.insert(
                    String::from("winner_summary"),
                    JsonVal::Str(format!(
                        "Voucher {} successfully redeemed by transaction {} at HLC {}",
                        v_key, winner.1, winner.0.hlc
                    )),
                );
                cm.insert(
                    String::from("loser_summary"),
                    JsonVal::Str(format!(
                        "Voucher {} duplicate spend attempt by transaction {} at HLC {}",
                        v_key, loser.1, loser.0.hlc
                    )),
                );
                cm.insert(
                    String::from("loser_payload_json"),
                    JsonVal::Str(loser.0.payload_json.clone()),
                );
                cm.insert(String::from("status"), JsonVal::Str(String::from("PENDING")));
                cm.insert(
                    String::from("created_at"),
                    JsonVal::Str(now_iso.to_string()),
                );
                detected_conflicts.push(JsonVal::Obj(cm));
            }
        }
    }

    detected_conflicts.sort_by(|a, b| {
        let sa = a.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let sb = b.get("id").and_then(|v| v.as_str()).unwrap_or("");
        sa.cmp(sb)
    });

    let mut out = BTreeMap::new();
    out.insert(
        String::from("mergedOps"),
        JsonVal::Arr(merged_ops.iter().map(SyncOpLogEntry::to_json).collect()),
    );
    let mut win_map = BTreeMap::new();
    for (k, v) in winning_entities {
        win_map.insert(k, v.to_json());
    }
    out.insert(String::from("winningEntities"), JsonVal::Obj(win_map));
    out.insert(
        String::from("detectedConflicts"),
        JsonVal::Arr(detected_conflicts),
    );
    Ok(JsonVal::Obj(out))
}

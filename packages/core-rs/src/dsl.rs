use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

use crate::allocation::{SplitItemInput, allocate_split_discounts};
use crate::decimal::{Dec, format_cny, round_cny};
use crate::fx::{lookup_default_fx_rate, process_mastercard_fx_lifecycle};
use crate::json::JsonVal;

#[derive(Clone, Debug)]
pub struct CategoryDef {
    pub id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub default_pool_id: String,
    pub keywords: Option<String>,
    pub sort_order: i64,
}

#[derive(Clone, Debug)]
pub struct ProjectTagDef {
    pub id: String,
    pub name: String,
    pub tag_type: String,
    pub target_budget: Option<String>,
    pub is_active: bool,
}

#[derive(Clone, Debug)]
pub struct BudgetPoolDef {
    pub id: String,
    pub name: String,
    pub pool_type: String,
    pub is_monthly_budget: bool,
    pub rollover_strategy: String,
}

pub fn default_categories() -> Vec<CategoryDef> {
    let rows: &[(&str, &str, &str, &str, i64)] = &[
        ("CAT_FOOD", "餐饮零食与水饮", "POOL_DAILY", "饭卡,食堂,华莱士,塔斯汀,牛奶,芬达,可乐,面,面包,水果,甘果子,鱼干", 10),
        ("CAT_CLEAN", "日常洗护与消耗", "POOL_DAILY", "洗衣服,洗衣液,纸巾,抽纸,牙线,牙膏,洗发水", 20),
        ("CAT_TELECOM", "通信话费与理发", "POOL_FIXED", "话费,移动,电信,联通,理发,剪头", 30),
        ("CAT_GAME_FIXED", "游戏固定大小月卡", "POOL_FIXED", "小月卡,大月卡,空月祝福,珍珠纪行", 40),
        ("CAT_CLOTH", "服饰鞋帽与床品", "POOL_FLEX", "短袖,裤子,内裤,袜子,床单,被套,鞋子", 50),
        ("CAT_DAILY_GOODS", "宿舍日用百货", "POOL_FLEX", "衣架,挂钩,泡面碗,指甲剪,卷尺,理线器,书架,电池,打气筒", 60),
        ("CAT_EE_DEV", "电子电路与开发", "POOL_FLEX", "MSP430,MSPM0,开发板,J-Link,示波器,探头,排针,电容,电阻,焊接", 70),
        ("CAT_DIGITAL_SUB", "软件订阅与外设", "POOL_FLEX", "域名,Porkbun,阿里云,MOJITEST,鼠标垫,数据线,磁吸镜片,Pico", 80),
        ("CAT_STUDY_PRINT", "打印与学习资料", "POOL_FLEX", "打印,复印,教材,题库,文具", 90),
        ("CAT_TRAFFIC", "日常市内交通", "POOL_FLEX", "公交,地铁,单车,打车", 100),
        ("CAT_MEDICAL", "医疗买药与保健", "POOL_EMERGENCY", "维生素,溃疡,医院,门诊,冷冻,碘伏,棉签,药", 110),
        ("CAT_REPAIR", "突发损坏与维修", "POOL_EMERGENCY", "修车,内外胎,卡槽,维修,发霉替换", 120),
        ("CAT_EXAM_CERT", "考证报名与差旅", "POOL_FLEX", "JLPT,N2,报名费,护照,港澳通行证,青旅,考点住宿", 130),
        ("CAT_MAJOR_ASSET", "数码大件购置", "POOL_FLEX", "iPhone,手机,机械硬盘,希捷,固态硬盘,显示器", 140),
    ];
    rows.iter()
        .map(|&(id, name, pool, kw, sort)| CategoryDef {
            id: id.to_string(),
            parent_id: None,
            name: name.to_string(),
            default_pool_id: pool.to_string(),
            keywords: Some(kw.to_string()),
            sort_order: sort,
        })
        .collect()
}

pub fn default_project_tags() -> Vec<ProjectTagDef> {
    let rows: &[(&str, &str, &str, Option<&str>)] = &[
        ("TAG_JLPT_N2", "JLPT_N2考试专项", "PROJECT", Some("800.00")),
        ("TAG_MCU_LAB", "单片机硬件实验", "SCENE", None),
        ("TAG_STOCK_EAT", "靠存货/刷饭卡度日", "STOCK_CONSUME", None),
    ];
    rows.iter()
        .map(|&(id, name, tt, tb)| ProjectTagDef {
            id: id.to_string(),
            name: name.to_string(),
            tag_type: tt.to_string(),
            target_budget: tb.map(ToString::to_string),
            is_active: true,
        })
        .collect()
}

fn category_alias(key: &str) -> Option<&'static str> {
    match key {
        "饮食" | "餐饮" | "吃喝" | "零食" | "水饮" => Some("CAT_FOOD"),
        "洗护" | "日化" | "消耗" => Some("CAT_CLEAN"),
        "通信" | "话费" | "理发" => Some("CAT_TELECOM"),
        "游戏" | "月卡" => Some("CAT_GAME_FIXED"),
        "服饰" | "衣服" | "鞋帽" | "床品" => Some("CAT_CLOTH"),
        "日用" | "百货" | "宿舍日用" => Some("CAT_DAILY_GOODS"),
        "电子" | "电路" | "开发" | "单片机" => Some("CAT_EE_DEV"),
        "数字服务" | "软件订阅" | "订阅" | "外设" => Some("CAT_DIGITAL_SUB"),
        "学习" | "打印" | "资料" => Some("CAT_STUDY_PRINT"),
        "交通" | "出行" => Some("CAT_TRAFFIC"),
        "医疗" | "买药" | "保健" => Some("CAT_MEDICAL"),
        "维修" | "修理" => Some("CAT_REPAIR"),
        "考证" | "报名" | "差旅" => Some("CAT_EXAM_CERT"),
        "大件" | "数码大件" => Some("CAT_MAJOR_ASSET"),
        _ => None,
    }
}

fn project_tag_alias(key: &str) -> Option<&'static str> {
    match key {
        "jlpt_n2考试" | "jlpt_n2" | "jlpt" | "n2" | "n2考试" => Some("TAG_JLPT_N2"),
        "mcu" | "单片机" | "硬件实验" | "单片机硬件实验" => Some("TAG_MCU_LAB"),
        "存货" | "刷饭卡" | "靠存货" | "靠存货/刷饭卡度日" => Some("TAG_STOCK_EAT"),
        _ => None,
    }
}

// ============================================================================
// Arithmetic formula evaluator
// ============================================================================

#[derive(Clone, Debug)]
enum MathToken {
    Num(Dec, String),
    Plus,
    Minus,
    Star,
    Slash,
    LParen,
    RParen,
}

impl MathToken {
    fn raw(&self) -> &str {
        match self {
            MathToken::Num(_, s) => s.as_str(),
            MathToken::Plus => "+",
            MathToken::Minus => "-",
            MathToken::Star => "*",
            MathToken::Slash => "/",
            MathToken::LParen => "(",
            MathToken::RParen => ")",
        }
    }
}

fn tokenize_math_expr(expr: &str) -> Result<Vec<MathToken>, String> {
    let mut tokens = Vec::new();
    let mut chars = expr.trim().char_indices().peekable();
    while let Some(&(idx, ch)) = chars.peek() {
        if ch.is_whitespace() {
            chars.next();
            continue;
        }
        match ch {
            '+' => {
                tokens.push(MathToken::Plus);
                chars.next();
            }
            '-' => {
                tokens.push(MathToken::Minus);
                chars.next();
            }
            '*' => {
                tokens.push(MathToken::Star);
                chars.next();
            }
            '/' => {
                tokens.push(MathToken::Slash);
                chars.next();
            }
            '(' => {
                tokens.push(MathToken::LParen);
                chars.next();
            }
            ')' => {
                tokens.push(MathToken::RParen);
                chars.next();
            }
            '0'..='9' | '.' => {
                let start = idx;
                let mut end = idx;
                while let Some(&(j, c2)) = chars.peek() {
                    if c2.is_ascii_digit() || c2 == '.' {
                        end = j + c2.len_utf8();
                        chars.next();
                    } else {
                        break;
                    }
                }
                let raw = &expr.trim()[start..end];
                let val = Dec::parse(raw)?;
                tokens.push(MathToken::Num(val, raw.to_string()));
            }
            other => {
                return Err(format!(
                    "Unexpected character '{}' in arithmetic expression",
                    other
                ));
            }
        }
    }
    Ok(tokens)
}

struct MathParser<'a> {
    tokens: &'a [MathToken],
    pos: usize,
}

impl<'a> MathParser<'a> {
    fn peek(&self) -> Option<&MathToken> {
        self.tokens.get(self.pos)
    }

    fn next(&mut self) -> Result<&MathToken, String> {
        let t = self
            .tokens
            .get(self.pos)
            .ok_or_else(|| String::from("Unexpected end of arithmetic expression"))?;
        self.pos += 1;
        Ok(t)
    }

    fn parse(&mut self) -> Result<Dec, String> {
        if self.tokens.is_empty() {
            return Ok(Dec::ZERO);
        }
        let res = self.parse_additive()?;
        if self.pos < self.tokens.len() {
            return Err(format!("Unexpected token '{}'", self.tokens[self.pos].raw()));
        }
        Ok(res)
    }

    fn parse_additive(&mut self) -> Result<Dec, String> {
        let mut left = self.parse_multiplicative()?;
        while matches!(self.peek(), Some(MathToken::Plus) | Some(MathToken::Minus)) {
            let is_plus = matches!(self.next()?, MathToken::Plus);
            let right = self.parse_multiplicative()?;
            left = if is_plus {
                left.add(right)
            } else {
                left.sub(right)
            };
        }
        Ok(left)
    }

    fn parse_multiplicative(&mut self) -> Result<Dec, String> {
        let mut left = self.parse_primary()?;
        while matches!(self.peek(), Some(MathToken::Star) | Some(MathToken::Slash)) {
            let is_star = matches!(self.next()?, MathToken::Star);
            let right = self.parse_primary()?;
            left = if is_star {
                left.mul(right)
            } else {
                left.checked_div(right)?
            };
        }
        Ok(left)
    }

    fn parse_primary(&mut self) -> Result<Dec, String> {
        let tok = self
            .peek()
            .ok_or_else(|| String::from("Unexpected end of expression"))?
            .clone();
        match tok {
            MathToken::Plus => {
                self.pos += 1;
                self.parse_primary()
            }
            MathToken::Minus => {
                self.pos += 1;
                Ok(self.parse_primary()?.neg())
            }
            MathToken::Num(v, _) => {
                self.pos += 1;
                Ok(v)
            }
            MathToken::LParen => {
                self.pos += 1;
                let val = self.parse_additive()?;
                let closing = self.next()?;
                if !matches!(closing, MathToken::RParen) {
                    return Err(String::from("Expected ')'"));
                }
                Ok(val)
            }
            other => Err(format!("Unexpected token '{}'", other.raw())),
        }
    }
}

#[derive(Clone, Debug)]
pub struct EvaluatedFormula {
    pub gross: String,
    pub discount: String,
    pub net: String,
}

impl EvaluatedFormula {
    pub fn to_json(&self) -> JsonVal {
        let mut m = BTreeMap::new();
        m.insert(String::from("gross"), JsonVal::Str(self.gross.clone()));
        m.insert(String::from("discount"), JsonVal::Str(self.discount.clone()));
        m.insert(String::from("net"), JsonVal::Str(self.net.clone()));
        JsonVal::Obj(m)
    }
}

pub fn evaluate_math_formula(expr: &str) -> Result<EvaluatedFormula, String> {
    let trimmed = expr.trim();
    if trimmed.is_empty() {
        return Err(String::from("Empty arithmetic expression"));
    }
    let tokens = tokenize_math_expr(trimmed)?;
    if tokens.is_empty() {
        return Err(String::from("Empty arithmetic expression"));
    }

    let net_val = MathParser {
        tokens: &tokens,
        pos: 0,
    }
    .parse()?;

    let mut terms: Vec<(char, Vec<MathToken>)> = Vec::new();
    let mut current_sign = '+';
    let mut current_tokens: Vec<MathToken> = Vec::new();
    let mut depth: i32 = 0;
    let mut has_top_level_minus = false;

    for t in &tokens {
        match t {
            MathToken::LParen => {
                depth += 1;
                current_tokens.push(t.clone());
            }
            MathToken::RParen => {
                depth -= 1;
                if depth < 0 {
                    return Err(String::from("Mismatched ')' in expression"));
                }
                current_tokens.push(t.clone());
            }
            MathToken::Plus | MathToken::Minus if depth == 0 => {
                if !current_tokens.is_empty() {
                    terms.push((current_sign, core::mem::take(&mut current_tokens)));
                } else if matches!(t, MathToken::Minus) {
                    current_sign = '-';
                    continue;
                }
                current_sign = if matches!(t, MathToken::Plus) { '+' } else { '-' };
                if matches!(t, MathToken::Minus) {
                    has_top_level_minus = true;
                }
            }
            _ => current_tokens.push(t.clone()),
        }
    }
    if !current_tokens.is_empty() {
        terms.push((current_sign, current_tokens));
    }

    if !has_top_level_minus {
        let net_formatted = format_cny(net_val);
        return Ok(EvaluatedFormula {
            gross: net_formatted.clone(),
            discount: String::from("0.00"),
            net: net_formatted,
        });
    }

    let mut positive_sum = Dec::ZERO;
    let mut negative_sum = Dec::ZERO;
    for (sign, term_tokens) in terms {
        let val = MathParser {
            tokens: &term_tokens,
            pos: 0,
        }
        .parse()?;
        if sign == '+' {
            positive_sum = positive_sum.add(val);
        } else {
            negative_sum = negative_sum.add(val);
        }
    }

    Ok(EvaluatedFormula {
        gross: format_cny(positive_sum),
        discount: format_cny(negative_sum),
        net: format_cny(net_val),
    })
}

// ============================================================================
// DSL helpers
// ============================================================================

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

fn contains_word_ci(haystack: &str, word: &str) -> bool {
    let hb = haystack.as_bytes();
    let wb = word.as_bytes();
    if wb.is_empty() || hb.len() < wb.len() {
        return false;
    }
    for i in 0..=(hb.len() - wb.len()) {
        if hb[i..i + wb.len()].eq_ignore_ascii_case(wb) {
            let left_ok = i == 0 || !is_word_byte(hb[i - 1]);
            let right_ok = i + wb.len() == hb.len() || !is_word_byte(hb[i + wb.len()]);
            if left_ok && right_ok {
                return true;
            }
        }
    }
    false
}

fn is_ascii_num_char(b: u8) -> bool {
    b.is_ascii_digit() || b == b'.'
}

fn take_num_prefix(s: &str) -> Option<&str> {
    let bytes = s.as_bytes();
    let mut end = 0;
    while end < bytes.len() && is_ascii_num_char(bytes[end]) {
        end += 1;
    }
    if end > 0 { Some(&s[..end]) } else { None }
}

fn replace_first_range(s: &str, start: usize, end: usize, rep: &str) -> String {
    let mut out = String::with_capacity(s.len() - (end - start) + rep.len());
    out.push_str(&s[..start]);
    out.push_str(rep);
    out.push_str(&s[end..]);
    out
}

fn extract_eq_override(s: &str) -> Option<(usize, usize, String)> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'=' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if let Some(num) = take_num_prefix(&s[j..]) {
                return Some((i, j + num.len(), num.to_string()));
            }
        }
        i += 1;
    }
    None
}

fn strip_at_tokens(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.char_indices().peekable();
    while let Some(&(_, ch)) = chars.peek() {
        if ch == '@' {
            chars.next();
            let mut count = 0;
            while let Some(&(_, c2)) = chars.peek() {
                if !c2.is_whitespace() && c2 != '+' && c2 != '#' && c2 != '=' {
                    count += 1;
                    chars.next();
                } else {
                    break;
                }
            }
            if count > 0 {
                out.push(' ');
            } else {
                out.push('@');
            }
        } else {
            out.push(ch);
            chars.next();
        }
    }
    out.trim().to_string()
}

fn extract_freeze_amount(s: &str) -> Option<(usize, usize, String)> {
    let needle = "冻结";
    let mut offset = 0;
    while let Some(rel) = s[offset..].find(needle) {
        let start = offset + rel;
        let mut j = start + needle.len();
        let bytes = s.as_bytes();
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if let Some(num) = take_num_prefix(&s[j..]) {
            return Some((start, j + num.len(), num.to_string()));
        }
        offset = start + needle.len();
    }
    None
}

fn extract_dollar_amount(s: &str) -> Option<(usize, usize, String)> {
    let bytes = s.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b'$' {
            if let Some(num) = take_num_prefix(&s[i + 1..]) {
                return Some((i, i + 1 + num.len(), num.to_string()));
            }
        }
    }
    None
}

fn extract_fx_code_amount(s: &str) -> Option<(usize, usize, String, String)> {
    let codes = ["USD", "JPY", "EUR", "GBP", "HKD"];
    let bytes = s.as_bytes();
    for i in 0..bytes.len() {
        if !s.is_char_boundary(i) {
            continue;
        }
        // Check PREFIX: CODE \s* NUM
        for &code in &codes {
            if i + code.len() <= bytes.len()
                && bytes[i..i + code.len()].eq_ignore_ascii_case(code.as_bytes())
            {
                let mut j = i + code.len();
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if let Some(num) = take_num_prefix(&s[j..]) {
                    return Some((i, j + num.len(), code.to_string(), num.to_string()));
                }
            }
        }
        // Check SUFFIX: NUM \s* CODE
        if is_ascii_num_char(bytes[i]) {
            if let Some(num) = take_num_prefix(&s[i..]) {
                let mut j = i + num.len();
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                for &code in &codes {
                    if j + code.len() <= bytes.len()
                        && bytes[j..j + code.len()].eq_ignore_ascii_case(code.as_bytes())
                    {
                        return Some((i, j + code.len(), code.to_string(), num.to_string()));
                    }
                }
            }
        }
    }
    None
}

fn split_sub_items(working: &str) -> Vec<String> {
    // Matches JS `.split(/\s*\+\s*(?=[\p{L}\p{Script=Han}])/u).map(s => s.trim()).filter(Boolean)`
    let mut parts = Vec::new();
    let mut seg_start = 0;
    let bytes = working.as_bytes();
    let mut i = 0;

    while i < bytes.len() {
        let ch = working[i..].chars().next().unwrap();
        if ch.is_whitespace() {
            let ws_start = i;
            let mut j = i + ch.len_utf8();
            while j < bytes.len() {
                let c2 = working[j..].chars().next().unwrap();
                if c2.is_whitespace() {
                    j += c2.len_utf8();
                } else {
                    break;
                }
            }
            if j < bytes.len() && bytes[j] == b'+' {
                let mut k = j + 1;
                while k < bytes.len() {
                    let c3 = working[k..].chars().next().unwrap();
                    if c3.is_whitespace() {
                        k += c3.len_utf8();
                    } else {
                        break;
                    }
                }
                if let Some(next_ch) = working[k..].chars().next() {
                    if next_ch.is_alphabetic() {
                        let piece = working[seg_start..ws_start].trim();
                        if !piece.is_empty() {
                            parts.push(piece.to_string());
                        }
                        seg_start = k;
                        i = k;
                        continue;
                    }
                }
            }
            i = j;
        } else if ch == '+' {
            let plus_pos = i;
            let mut k = i + 1;
            while k < bytes.len() {
                let c3 = working[k..].chars().next().unwrap();
                if c3.is_whitespace() {
                    k += c3.len_utf8();
                } else {
                    break;
                }
            }
            if let Some(next_ch) = working[k..].chars().next() {
                if next_ch.is_alphabetic() {
                    let piece = working[seg_start..plus_pos].trim();
                    if !piece.is_empty() {
                        parts.push(piece.to_string());
                    }
                    seg_start = k;
                    i = k;
                    continue;
                }
            }
            i += 1;
        } else {
            i += ch.len_utf8();
        }
    }
    let last = working[seg_start..].trim();
    if !last.is_empty() {
        parts.push(last.to_string());
    }
    parts
}

fn extract_hash_tags(item_str: &str) -> (Vec<String>, String) {
    let mut tags = Vec::new();
    let mut cleaned = String::with_capacity(item_str.len());
    let mut chars = item_str.char_indices().peekable();
    while let Some(&(_, ch)) = chars.peek() {
        if ch == '#' {
            chars.next();
            let mut tag = String::new();
            while let Some(&(_, c2)) = chars.peek() {
                if !c2.is_whitespace() && c2 != '#' && c2 != '=' {
                    tag.push(c2);
                    chars.next();
                } else {
                    break;
                }
            }
            if !tag.is_empty() {
                tags.push(tag);
                cleaned.push(' ');
            } else {
                cleaned.push('#');
            }
        } else {
            cleaned.push(ch);
            chars.next();
        }
    }
    (tags, cleaned.trim().to_string())
}

fn is_formula_core_char(b: u8) -> bool {
    b.is_ascii_digit() || matches!(b, b'.' | b'+' | b'-' | b'*' | b'/' | b'(' | b')')
}

fn is_formula_op(b: u8) -> bool {
    matches!(b, b'+' | b'-' | b'*' | b'/')
}

fn matches_formula_expr_whole(s: &str) -> bool {
    let bytes = s.as_bytes();
    if bytes.is_empty() {
        return false;
    }
    let mut i = 0;
    if !is_formula_core_char(bytes[i]) {
        return false;
    }
    while i < bytes.len() && is_formula_core_char(bytes[i]) {
        i += 1;
    }
    while i < bytes.len() {
        let mut j = i;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || !is_formula_op(bytes[j]) {
            return false;
        }
        j += 1;
        while j < bytes.len() && bytes[j].is_ascii_whitespace() {
            j += 1;
        }
        if j >= bytes.len() || !is_formula_core_char(bytes[j]) {
            return false;
        }
        while j < bytes.len() && is_formula_core_char(bytes[j]) {
            j += 1;
        }
        i = j;
    }
    true
}

fn split_item_name_and_formula(item_str: &str) -> Result<(String, String), String> {
    for (idx, _) in item_str.char_indices() {
        let tail = &item_str[idx..];
        if !tail.starts_with(|c: char| c.is_whitespace()) && matches_formula_expr_whole(tail) {
            let prefix = item_str[..idx].trim();
            let name = if prefix.is_empty() {
                String::from("商品支出")
            } else {
                prefix.to_string()
            };
            return Ok((name, tail.trim().to_string()));
        }
    }
    // Fallback trailing number
    let bytes = item_str.as_bytes();
    let mut end = bytes.len();
    if end > 0 && is_ascii_num_char(bytes[end - 1]) {
        let mut start = end - 1;
        while start > 0 && is_ascii_num_char(bytes[start - 1]) {
            start -= 1;
        }
        let prefix = item_str[..start].trim();
        let name = if prefix.is_empty() {
            String::from("商品支出")
        } else {
            prefix.to_string()
        };
        return Ok((name, item_str[start..end].to_string()));
    }
    let _ = &mut end;
    Err(format!("Unable to extract formula from \"{}\"", item_str))
}

struct TagResolution<'a> {
    category: Option<&'a CategoryDef>,
    project_tag: Option<&'a ProjectTagDef>,
    budget_pool: Option<&'a BudgetPoolDef>,
}

fn resolve_tag_or_category<'a>(
    raw_tag: &str,
    categories: &'a [CategoryDef],
    project_tags: &'a [ProjectTagDef],
    budget_pools: Option<&'a [BudgetPoolDef]>,
) -> TagResolution<'a> {
    let clean = raw_tag.strip_prefix('#').unwrap_or(raw_tag).trim();
    let lower = clean.to_lowercase();

    // A. Project tags
    if let Some(alias_id) = project_tag_alias(&lower).or_else(|| project_tag_alias(clean)) {
        if let Some(pt) = project_tags.iter().find(|p| p.id == alias_id) {
            return TagResolution {
                category: None,
                project_tag: Some(pt),
                budget_pool: None,
            };
        }
    }
    if let Some(pt) = project_tags.iter().find(|p| p.id.to_lowercase() == lower) {
        return TagResolution { category: None, project_tag: Some(pt), budget_pool: None };
    }
    if let Some(pt) = project_tags.iter().find(|p| p.name.to_lowercase() == lower) {
        return TagResolution { category: None, project_tag: Some(pt), budget_pool: None };
    }
    if let Some(pt) = project_tags.iter().find(|p| {
        let nl = p.name.to_lowercase();
        nl.contains(&lower) || lower.contains(&nl)
    }) {
        return TagResolution { category: None, project_tag: Some(pt), budget_pool: None };
    }

    // B. Budget pools
    if let Some(pools) = budget_pools {
        if let Some(bp) = pools.iter().find(|p| p.id.to_lowercase() == lower) {
            return TagResolution { category: None, project_tag: None, budget_pool: Some(bp) };
        }
        if let Some(bp) = pools.iter().find(|p| p.name.to_lowercase() == lower) {
            return TagResolution { category: None, project_tag: None, budget_pool: Some(bp) };
        }
        if let Some(bp) = pools.iter().find(|p| {
            let nl = p.name.to_lowercase();
            nl.contains(&lower) || lower.contains(&nl)
        }) {
            return TagResolution { category: None, project_tag: None, budget_pool: Some(bp) };
        }
    }

    // C. Categories
    if let Some(alias_id) = category_alias(&lower).or_else(|| category_alias(clean)) {
        if let Some(cat) = categories.iter().find(|c| c.id == alias_id) {
            return TagResolution { category: Some(cat), project_tag: None, budget_pool: None };
        }
    }
    if let Some(cat) = categories.iter().find(|c| c.id.to_lowercase() == lower) {
        return TagResolution { category: Some(cat), project_tag: None, budget_pool: None };
    }
    if let Some(cat) = categories.iter().find(|c| c.name.to_lowercase() == lower) {
        return TagResolution { category: Some(cat), project_tag: None, budget_pool: None };
    }
    if let Some(cat) = categories.iter().find(|c| {
        let nl = c.name.to_lowercase();
        nl.contains(&lower) || lower.contains(&nl)
    }) {
        return TagResolution { category: Some(cat), project_tag: None, budget_pool: None };
    }
    if let Some(cat) = categories.iter().find(|c| {
        c.keywords.as_deref().is_some_and(|kws| {
            kws.split(',')
                .map(|k| k.trim().to_lowercase())
                .filter(|k| !k.is_empty())
                .any(|kw| kw == lower || lower.contains(&kw))
        })
    }) {
        return TagResolution { category: Some(cat), project_tag: None, budget_pool: None };
    }

    TagResolution {
        category: None,
        project_tag: None,
        budget_pool: None,
    }
}

fn auto_match_category_by_item_name<'a>(
    item_name: &str,
    categories: &'a [CategoryDef],
) -> Option<&'a CategoryDef> {
    let name_lower = item_name.to_lowercase();
    let mut best_match: Option<&'a CategoryDef> = None;
    let mut max_kw_len = 0usize;

    for cat in categories {
        if let Some(ref kws) = cat.keywords {
            for kw in kws.split(',').map(str::trim) {
                if !kw.is_empty() && name_lower.contains(&kw.to_lowercase()) {
                    if kw.chars().count() > max_kw_len {
                        max_kw_len = kw.chars().count();
                        best_match = Some(cat);
                    }
                }
            }
        }
    }
    best_match
}

struct IntermediateItem {
    name: String,
    raw_formula: Option<String>,
    gross: String,
    discount: String,
    net: String,
    category_id: Option<String>,
    pool_id: Option<String>,
    project_tag_id: Option<String>,
    is_primary: bool,
}

fn parsed_item_json(
    item_name: String,
    category_id: String,
    budget_pool_id: String,
    project_tag_id: Option<String>,
    item_gross: String,
    allocated_discount: String,
    item_net: String,
    is_primary_item: bool,
    raw_formula_expr: Option<String>,
) -> JsonVal {
    let mut m = BTreeMap::new();
    m.insert(String::from("item_name"), JsonVal::Str(item_name));
    m.insert(String::from("category_id"), JsonVal::Str(category_id));
    m.insert(String::from("budget_pool_id"), JsonVal::Str(budget_pool_id));
    m.insert(
        String::from("project_tag_id"),
        match project_tag_id {
            Some(s) => JsonVal::Str(s),
            None => JsonVal::Null,
        },
    );
    m.insert(String::from("item_gross"), JsonVal::Str(item_gross));
    m.insert(
        String::from("allocated_discount"),
        JsonVal::Str(allocated_discount),
    );
    m.insert(String::from("item_net"), JsonVal::Str(item_net));
    m.insert(String::from("is_primary_item"), JsonVal::Bool(is_primary_item));
    m.insert(
        String::from("raw_formula_expr"),
        match raw_formula_expr {
            Some(s) => JsonVal::Str(s),
            None => JsonVal::Null,
        },
    );
    JsonVal::Obj(m)
}

pub fn parse_quick_input_dsl(
    raw_text: &str,
    categories: Option<&[CategoryDef]>,
    project_tags: Option<&[ProjectTagDef]>,
    budget_pools: Option<&[BudgetPoolDef]>,
    fx_hold_ratio: Dec,
    fx_cashback_rate: Dec,
    fx_cashback_rate_raw: &str,
) -> Result<JsonVal, String> {
    let trimmed_text = raw_text.trim();
    if trimmed_text.is_empty() {
        return Err(String::from("Empty DSL input text"));
    }

    let def_cats;
    let cats = match categories {
        Some(c) => c,
        None => {
            def_cats = default_categories();
            &def_cats
        }
    };
    let def_tags;
    let tags = match project_tags {
        Some(t) => t,
        None => {
            def_tags = default_project_tags();
            &def_tags
        }
    };

    let mut working = trimmed_text.to_string();

    // A. `= 50` net override
    let mut merged_net_override: Option<String> = None;
    if let Some((start, end, num_str)) = extract_eq_override(&working) {
        merged_net_override = Some(format_cny(Dec::parse(&num_str)?));
        working = replace_first_range(&working, start, end, " ");
    }

    // B. Strip `@xxx`
    working = strip_at_tokens(&working);

    // C. FX detection & pre-auth hold
    let mut is_fx_detected = working.contains('$')
        || contains_word_ci(&working, "USD")
        || contains_word_ci(&working, "JPY")
        || working.contains("冻结");
    let mut original_currency = String::from("CNY");
    let mut original_amount: Option<String> = None;
    let mut hold_amount_cny = String::from("0.00");
    let mut settlement_status = String::from("SETTLED");

    if let Some((start, end, num_str)) = extract_freeze_amount(&working) {
        hold_amount_cny = format_cny(Dec::parse(&num_str)?);
        settlement_status = String::from("PENDING_HOLD");
        is_fx_detected = true;
        working = replace_first_range(&working, start, end, " ");
    }

    if let Some((start, end, num_str)) = extract_dollar_amount(&working) {
        original_currency = String::from("USD");
        original_amount = Some(format_cny(Dec::parse(&num_str)?));
        is_fx_detected = true;
        working = replace_first_range(&working, start, end, " ");
    } else if let Some((start, end, code, num_str)) = extract_fx_code_amount(&working) {
        original_currency = code.to_uppercase();
        let raw_dec = Dec::parse(&num_str)?;
        original_amount = Some(if original_currency == "JPY" {
            round_cny(raw_dec).format_dp(0)
        } else {
            format_cny(raw_dec)
        });
        is_fx_detected = true;
        working = replace_first_range(&working, start, end, " ");
    }

    if is_fx_detected {
        if let Some(ref orig_amt) = original_amount {
            if hold_amount_cny == "0.00" {
                let fx_rate = Dec::parse(lookup_default_fx_rate(&original_currency))?;
                let orig_dec = Dec::parse(orig_amt)?;
                hold_amount_cny = format_cny(round_cny(orig_dec.mul(fx_rate).mul(fx_hold_ratio)));
                settlement_status = String::from("PENDING_HOLD");
            }
        }
    }

    // D & E. Split sub-items
    let mut global_category_id: Option<String> = None;
    let mut global_pool_id: Option<String> = None;
    let mut global_project_tag_id: Option<String> = None;

    let raw_sub_items = split_sub_items(&working);
    if raw_sub_items.is_empty() {
        return Err(format!(
            "Unable to extract transaction items from: \"{}\"",
            raw_text
        ));
    }

    let mut parsed_items: Vec<IntermediateItem> = Vec::with_capacity(raw_sub_items.len());

    for (idx, raw_item) in raw_sub_items.iter().enumerate() {
        let mut item_str = raw_item.as_str().to_string();
        let mut item_category_id: Option<String> = None;
        let mut item_pool_id: Option<String> = None;
        let mut item_project_tag_id: Option<String> = None;
        let mut is_primary = false;

        if let Some(rest) = item_str.strip_prefix('*').or_else(|| item_str.strip_prefix('!')) {
            is_primary = true;
            item_str = rest.trim().to_string();
        }

        let (item_tags, cleaned_item_str) = extract_hash_tags(&item_str);
        item_str = cleaned_item_str;

        for tag_tok in item_tags {
            let resolved = resolve_tag_or_category(&tag_tok, cats, tags, budget_pools);
            if let Some(pt) = resolved.project_tag {
                item_project_tag_id = Some(pt.id.clone());
                if item_pool_id.is_none() && pt.tag_type == "PROJECT" {
                    item_pool_id = Some(String::from("POOL_FLEX"));
                }
            }
            if let Some(bp) = resolved.budget_pool {
                item_pool_id = Some(bp.id.clone());
            }
            if let Some(cat) = resolved.category {
                item_category_id = Some(cat.id.clone());
                if item_pool_id.is_none() {
                    item_pool_id = Some(cat.default_pool_id.clone());
                }
            }
        }

        if idx == raw_sub_items.len() - 1 {
            if let Some(ref c) = item_category_id {
                global_category_id = Some(c.clone());
            }
            if let Some(ref p) = item_pool_id {
                global_pool_id = Some(p.clone());
            }
            if let Some(ref t) = item_project_tag_id {
                global_project_tag_id = Some(t.clone());
            }
        }

        if is_fx_detected && original_amount.is_some() && raw_sub_items.len() == 1 {
            let name = if item_str.trim().is_empty() {
                String::from("外币消费")
            } else {
                item_str.trim().to_string()
            };
            let orig_ref = original_amount.as_deref().unwrap_or("0.00");
            let raw_fx_expr = if original_currency == "USD" {
                format!("${}", orig_ref)
            } else {
                format!("{} {}", original_currency, orig_ref)
            };
            parsed_items.push(IntermediateItem {
                name,
                raw_formula: Some(raw_fx_expr),
                gross: String::from("0.00"),
                discount: String::from("0.00"),
                net: String::from("0.00"),
                category_id: item_category_id,
                pool_id: item_pool_id,
                project_tag_id: item_project_tag_id,
                is_primary: true,
            });
            continue;
        }

        let (name, formula) = split_item_name_and_formula(&item_str).map_err(|_| {
            format!(
                "Unable to parse price formula for item \"{}\" in: \"{}\"",
                item_str, raw_text
            )
        })?;
        let evaluated = evaluate_math_formula(&formula)?;
        parsed_items.push(IntermediateItem {
            name,
            raw_formula: Some(formula),
            gross: evaluated.gross,
            discount: evaluated.discount,
            net: evaluated.net,
            category_id: item_category_id,
            pool_id: item_pool_id,
            project_tag_id: item_project_tag_id,
            is_primary,
        });
    }

    // Post-pass inheritance and keyword categorization
    for item in &mut parsed_items {
        if item.category_id.is_none() {
            item.category_id = global_category_id.clone();
        }
        if item.pool_id.is_none() {
            item.pool_id = global_pool_id.clone();
        }
        if item.project_tag_id.is_none() {
            item.project_tag_id = global_project_tag_id.clone();
        }

        if item.category_id.is_none() {
            if let Some(ref pt_id) = item.project_tag_id {
                let pt = tags.iter().find(|p| &p.id == pt_id);
                if pt.is_some_and(|p| p.id == "TAG_JLPT_N2") {
                    item.category_id = Some(String::from("CAT_EXAM_CERT"));
                }
                if item.pool_id.is_none() && pt.is_some_and(|p| p.tag_type == "PROJECT") {
                    item.pool_id = Some(String::from("POOL_FLEX"));
                }
            }
        }

        if item.category_id.is_none() {
            if let Some(matched) = auto_match_category_by_item_name(&item.name, cats) {
                item.category_id = Some(matched.id.clone());
                if item.pool_id.is_none() {
                    item.pool_id = Some(matched.default_pool_id.clone());
                }
            } else {
                item.category_id = Some(String::from("CAT_FOOD"));
                if item.pool_id.is_none() {
                    item.pool_id = Some(String::from("POOL_DAILY"));
                }
            }
        }

        if item.pool_id.is_none() {
            let cid = item.category_id.as_deref().unwrap_or("");
            let pool = cats
                .iter()
                .find(|c| c.id == cid)
                .map(|c| c.default_pool_id.clone())
                .unwrap_or_else(|| String::from("POOL_DAILY"));
            item.pool_id = Some(pool);
        }
    }

    // Scenario 3: FX hold
    if is_fx_detected && hold_amount_cny != "0.00" {
        if let Some(ref orig_amt) = original_amount {
            let fx_result = process_mastercard_fx_lifecycle(
                Dec::parse(orig_amt)?,
                Dec::parse(&hold_amount_cny)?,
                None,
                fx_hold_ratio,
                fx_cashback_rate,
                None,
            )?;
            let total_gross = fx_result
                .get("total_gross")
                .and_then(|v| v.as_str())
                .unwrap_or("0.00")
                .to_string();
            let payment_discount = fx_result
                .get("payment_discount")
                .and_then(|v| v.as_str())
                .unwrap_or("0.00")
                .to_string();
            let total_net = fx_result
                .get("total_net")
                .and_then(|v| v.as_str())
                .unwrap_or("0.00")
                .to_string();
            let exchange_rate = fx_result
                .get("exchange_rate")
                .and_then(|v| v.as_str())
                .unwrap_or("1.000000")
                .to_string();

            let item = &parsed_items[0];
            let final_items = alloc::vec![parsed_item_json(
                item.name.clone(),
                item.category_id.clone().unwrap(),
                item.pool_id.clone().unwrap(),
                item.project_tag_id.clone(),
                total_gross.clone(),
                payment_discount.clone(),
                total_net.clone(),
                true,
                item.raw_formula.clone(),
            )];

            let mut out = BTreeMap::new();
            out.insert(String::from("tx_type"), JsonVal::Str(String::from("EXPENSE")));
            out.insert(String::from("total_gross"), JsonVal::Str(total_gross));
            out.insert(
                String::from("platform_discount"),
                JsonVal::Str(String::from("0.00")),
            );
            out.insert(
                String::from("payment_discount"),
                JsonVal::Str(payment_discount),
            );
            out.insert(String::from("total_net"), JsonVal::Str(total_net));
            out.insert(
                String::from("allocation_mode"),
                JsonVal::Str(String::from("SINGLE")),
            );
            out.insert(
                String::from("original_currency"),
                JsonVal::Str(original_currency),
            );
            out.insert(
                String::from("original_amount"),
                JsonVal::Str(orig_amt.clone()),
            );
            out.insert(String::from("exchange_rate"), JsonVal::Str(exchange_rate));
            out.insert(
                String::from("settlement_status"),
                JsonVal::Str(String::from("PENDING_HOLD")),
            );
            out.insert(
                String::from("hold_amount_cny"),
                JsonVal::Str(hold_amount_cny),
            );
            out.insert(
                String::from("fx_cashback_rate"),
                JsonVal::Str(fx_cashback_rate_raw.to_string()),
            );
            out.insert(String::from("is_fx_detected"), JsonVal::Bool(true));
            out.insert(String::from("items"), JsonVal::Arr(final_items));
            out.insert(
                String::from("raw_input_text"),
                JsonVal::Str(raw_text.to_string()),
            );
            out.insert(
                String::from("merchant_or_note"),
                JsonVal::Str(item.name.clone()),
            );
            return Ok(JsonVal::Obj(out));
        }
    }

    // Scenario 2: Split discount (`= 50`)
    if let Some(merged_net_str) = merged_net_override {
        let mut total_gross_acc = Dec::ZERO;
        for it in &parsed_items {
            total_gross_acc = total_gross_acc.add(Dec::parse(&it.gross)?);
        }
        let total_gross_dec = round_cny(total_gross_acc);
        let total_net_dec = round_cny(Dec::parse(&merged_net_str)?);
        let total_discount_dec = round_cny(total_gross_dec.sub(total_net_dec));

        let split_inputs: Vec<SplitItemInput> = parsed_items
            .iter()
            .map(|it| SplitItemInput {
                name: it.name.clone(),
                gross: Dec::parse(&it.gross).unwrap_or(Dec::ZERO),
                category_id: it.category_id.clone().unwrap(),
                budget_pool_id: it.pool_id.clone(),
                project_tag_id: it.project_tag_id.clone(),
                is_primary: Some(it.is_primary),
                extra: BTreeMap::new(),
            })
            .collect();

        let has_primary = parsed_items.iter().any(|it| it.is_primary);
        let mode = if has_primary {
            "PRIMARY_ITEM"
        } else {
            "PROPORTIONAL"
        };

        let allocated = allocate_split_discounts(&split_inputs, total_net_dec, mode, None)?;
        let final_items: Vec<JsonVal> = parsed_items
            .iter()
            .zip(allocated.iter())
            .map(|(it, alloc_row)| {
                parsed_item_json(
                    it.name.clone(),
                    it.category_id.clone().unwrap(),
                    it.pool_id.clone().unwrap(),
                    it.project_tag_id.clone(),
                    alloc_row.gross.clone(),
                    alloc_row.allocated_discount.clone(),
                    alloc_row.net.clone(),
                    it.is_primary,
                    it.raw_formula.clone(),
                )
            })
            .collect();

        let note = parsed_items
            .iter()
            .map(|it| it.name.as_str())
            .collect::<Vec<_>>()
            .join(" + ");

        let mut out = BTreeMap::new();
        out.insert(String::from("tx_type"), JsonVal::Str(String::from("EXPENSE")));
        out.insert(
            String::from("total_gross"),
            JsonVal::Str(format_cny(total_gross_dec)),
        );
        out.insert(
            String::from("platform_discount"),
            JsonVal::Str(String::from("0.00")),
        );
        out.insert(
            String::from("payment_discount"),
            JsonVal::Str(format_cny(total_discount_dec)),
        );
        out.insert(
            String::from("total_net"),
            JsonVal::Str(format_cny(total_net_dec)),
        );
        out.insert(
            String::from("allocation_mode"),
            JsonVal::Str(mode.to_string()),
        );
        out.insert(
            String::from("original_currency"),
            JsonVal::Str(original_currency),
        );
        out.insert(
            String::from("original_amount"),
            match original_amount {
                Some(s) => JsonVal::Str(s),
                None => JsonVal::Null,
            },
        );
        out.insert(
            String::from("exchange_rate"),
            JsonVal::Str(String::from("1.000000")),
        );
        out.insert(
            String::from("settlement_status"),
            JsonVal::Str(settlement_status),
        );
        out.insert(
            String::from("hold_amount_cny"),
            JsonVal::Str(hold_amount_cny),
        );
        out.insert(String::from("is_fx_detected"), JsonVal::Bool(is_fx_detected));
        out.insert(String::from("items"), JsonVal::Arr(final_items));
        out.insert(
            String::from("raw_input_text"),
            JsonVal::Str(raw_text.to_string()),
        );
        out.insert(String::from("merchant_or_note"), JsonVal::Str(note));
        return Ok(JsonVal::Obj(out));
    }

    // Scenario 1: Normal / self-contained formula discount
    let mut gross_acc = Dec::ZERO;
    let mut disc_acc = Dec::ZERO;
    for it in &parsed_items {
        gross_acc = gross_acc.add(Dec::parse(&it.gross)?);
        disc_acc = disc_acc.add(Dec::parse(&it.discount)?);
    }
    let total_gross_dec = round_cny(gross_acc);
    let total_item_disc_dec = round_cny(disc_acc);
    let total_net_dec = round_cny(total_gross_dec.sub(total_item_disc_dec));

    let alloc_mode = if parsed_items.len() == 1 {
        "SINGLE"
    } else {
        "MANUAL"
    };
    let is_single = parsed_items.len() == 1;
    let final_items: Vec<JsonVal> = parsed_items
        .iter()
        .map(|it| {
            parsed_item_json(
                it.name.clone(),
                it.category_id.clone().unwrap(),
                it.pool_id.clone().unwrap(),
                it.project_tag_id.clone(),
                it.gross.clone(),
                it.discount.clone(),
                it.net.clone(),
                if is_single { true } else { it.is_primary },
                it.raw_formula.clone(),
            )
        })
        .collect();

    let note = parsed_items
        .iter()
        .map(|it| it.name.as_str())
        .collect::<Vec<_>>()
        .join(" + ");

    let mut out = BTreeMap::new();
    out.insert(String::from("tx_type"), JsonVal::Str(String::from("EXPENSE")));
    out.insert(
        String::from("total_gross"),
        JsonVal::Str(format_cny(total_gross_dec)),
    );
    out.insert(
        String::from("platform_discount"),
        JsonVal::Str(format_cny(total_item_disc_dec)),
    );
    out.insert(
        String::from("payment_discount"),
        JsonVal::Str(String::from("0.00")),
    );
    out.insert(
        String::from("total_net"),
        JsonVal::Str(format_cny(total_net_dec)),
    );
    out.insert(
        String::from("allocation_mode"),
        JsonVal::Str(alloc_mode.to_string()),
    );
    out.insert(
        String::from("original_currency"),
        JsonVal::Str(original_currency),
    );
    out.insert(
        String::from("original_amount"),
        match original_amount {
            Some(s) => JsonVal::Str(s),
            None => JsonVal::Null,
        },
    );
    out.insert(
        String::from("exchange_rate"),
        JsonVal::Str(String::from("1.000000")),
    );
    out.insert(
        String::from("settlement_status"),
        JsonVal::Str(settlement_status),
    );
    out.insert(
        String::from("hold_amount_cny"),
        JsonVal::Str(hold_amount_cny),
    );
    out.insert(String::from("is_fx_detected"), JsonVal::Bool(is_fx_detected));
    out.insert(String::from("items"), JsonVal::Arr(final_items));
    out.insert(
        String::from("raw_input_text"),
        JsonVal::Str(raw_text.to_string()),
    );
    out.insert(String::from("merchant_or_note"), JsonVal::Str(note));
    Ok(JsonVal::Obj(out))
}

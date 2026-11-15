use alloc::collections::BTreeMap;
use alloc::format;
use alloc::string::{String, ToString};
use alloc::vec::Vec;

#[derive(Clone, Debug, PartialEq)]
pub enum JsonVal {
    Null,
    Bool(bool),
    Num(String),
    Str(String),
    Arr(Vec<JsonVal>),
    Obj(BTreeMap<String, JsonVal>),
}

impl JsonVal {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            JsonVal::Str(s) => Some(s.as_str()),
            _ => None,
        }
    }

    pub fn as_bool(&self) -> Option<bool> {
        match self {
            JsonVal::Bool(b) => Some(*b),
            _ => None,
        }
    }

    pub fn as_i64(&self) -> Option<i64> {
        match self {
            JsonVal::Num(s) => s.parse::<i64>().ok().or_else(|| {
                s.parse::<f64>().ok().map(|f| f as i64)
            }),
            JsonVal::Str(s) => s.trim().parse::<i64>().ok(),
            _ => None,
        }
    }

    pub fn as_u64(&self) -> Option<u64> {
        match self {
            JsonVal::Num(s) => s.parse::<u64>().ok(),
            JsonVal::Str(s) => s.trim().parse::<u64>().ok(),
            _ => None,
        }
    }

    pub fn as_num_or_str(&self) -> Option<String> {
        match self {
            JsonVal::Str(s) => Some(s.clone()),
            JsonVal::Num(s) => Some(s.clone()),
            _ => None,
        }
    }

    pub fn as_arr(&self) -> Option<&[JsonVal]> {
        match self {
            JsonVal::Arr(v) => Some(v.as_slice()),
            _ => None,
        }
    }

    pub fn as_obj(&self) -> Option<&BTreeMap<String, JsonVal>> {
        match self {
            JsonVal::Obj(m) => Some(m),
            _ => None,
        }
    }

    pub fn get(&self, key: &str) -> Option<&JsonVal> {
        match self {
            JsonVal::Obj(m) => m.get(key),
            _ => None,
        }
    }

    pub fn get_non_null(&self, key: &str) -> Option<&JsonVal> {
        match self.get(key) {
            Some(JsonVal::Null) | None => None,
            Some(v) => Some(v),
        }
    }

    pub fn is_null(&self) -> bool {
        matches!(self, JsonVal::Null)
    }

    pub fn to_json_string(&self) -> String {
        let mut out = String::new();
        self.write_json(&mut out);
        out
    }

    pub fn write_json(&self, out: &mut String) {
        match self {
            JsonVal::Null => out.push_str("null"),
            JsonVal::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            JsonVal::Num(n) => out.push_str(n),
            JsonVal::Str(s) => write_json_str(s, out),
            JsonVal::Arr(arr) => {
                out.push('[');
                for (i, v) in arr.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    v.write_json(out);
                }
                out.push(']');
            }
            JsonVal::Obj(map) => {
                out.push('{');
                for (i, (k, v)) in map.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    write_json_str(k, out);
                    out.push(':');
                    v.write_json(out);
                }
                out.push('}');
            }
        }
    }
}

fn write_json_str(s: &str, out: &mut String) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0C}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", c as u32));
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

pub fn parse_json(input: &str) -> Result<JsonVal, String> {
    let mut parser = Parser {
        bytes: input.as_bytes(),
        pos: 0,
    };
    let val = parser.parse_value()?;
    parser.skip_ws();
    if parser.pos != parser.bytes.len() {
        return Err(format!("Trailing bytes in JSON at pos {}", parser.pos));
    }
    Ok(val)
}

struct Parser<'a> {
    bytes: &'a [u8],
    pos: usize,
}

impl<'a> Parser<'a> {
    fn skip_ws(&mut self) {
        while self.pos < self.bytes.len() {
            match self.bytes[self.pos] {
                b' ' | b'\t' | b'\n' | b'\r' => self.pos += 1,
                _ => break,
            }
        }
    }

    fn peek(&self) -> Option<u8> {
        self.bytes.get(self.pos).copied()
    }

    fn expect(&mut self, b: u8) -> Result<(), String> {
        self.skip_ws();
        match self.peek() {
            Some(c) if c == b => {
                self.pos += 1;
                Ok(())
            }
            other => Err(format!(
                "Expected '{}' at pos {}, got {:?}",
                b as char, self.pos, other
            )),
        }
    }

    fn parse_value(&mut self) -> Result<JsonVal, String> {
        self.skip_ws();
        match self.peek() {
            Some(b'n') => self.parse_null(),
            Some(b't') => self.parse_bool(true),
            Some(b'f') => self.parse_bool(false),
            Some(b'"') => self.parse_string().map(JsonVal::Str),
            Some(b'[') => self.parse_array(),
            Some(b'{') => self.parse_object(),
            Some(b'-') | Some(b'0'..=b'9') => self.parse_number(),
            other => Err(format!("Unexpected token at pos {}: {:?}", self.pos, other)),
        }
    }

    fn parse_null(&mut self) -> Result<JsonVal, String> {
        if self.bytes[self.pos..].starts_with(b"null") {
            self.pos += 4;
            Ok(JsonVal::Null)
        } else {
            Err(format!("Invalid null at pos {}", self.pos))
        }
    }

    fn parse_bool(&mut self, expected: bool) -> Result<JsonVal, String> {
        let lit = if expected { b"true".as_slice() } else { b"false".as_slice() };
        if self.bytes[self.pos..].starts_with(lit) {
            self.pos += lit.len();
            Ok(JsonVal::Bool(expected))
        } else {
            Err(format!("Invalid bool at pos {}", self.pos))
        }
    }

    fn parse_number(&mut self) -> Result<JsonVal, String> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        match self.peek() {
            Some(b'0') => self.pos += 1,
            Some(b'1'..=b'9') => {
                while matches!(self.peek(), Some(b'0'..=b'9')) {
                    self.pos += 1;
                }
            }
            _ => return Err(format!("Invalid number at pos {}", start)),
        }
        if self.peek() == Some(b'.') {
            self.pos += 1;
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!("Invalid fraction at pos {}", self.pos));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e') | Some(b'E')) {
            self.pos += 1;
            if matches!(self.peek(), Some(b'+') | Some(b'-')) {
                self.pos += 1;
            }
            if !matches!(self.peek(), Some(b'0'..=b'9')) {
                return Err(format!("Invalid exponent at pos {}", self.pos));
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        let s = core::str::from_utf8(&self.bytes[start..self.pos])
            .map_err(|_| String::from("UTF8 error in number"))?;
        Ok(JsonVal::Num(s.to_string()))
    }

    fn parse_string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = String::new();
        while self.pos < self.bytes.len() {
            let b = self.bytes[self.pos];
            if b == b'"' {
                self.pos += 1;
                return Ok(out);
            }
            if b == b'\\' {
                self.pos += 1;
                if self.pos >= self.bytes.len() {
                    return Err(String::from("Unterminated escape in JSON string"));
                }
                let esc = self.bytes[self.pos];
                self.pos += 1;
                match esc {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{08}'),
                    b'f' => out.push('\u{0C}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let code = self.parse_hex4()?;
                        if (0xD800..=0xDBFF).contains(&code) {
                            if self.bytes[self.pos..].starts_with(b"\\u") {
                                self.pos += 2;
                                let low = self.parse_hex4()?;
                                if (0xDC00..=0xDFFF).contains(&low) {
                                    let combined = 0x10000
                                        + (((code as u32 - 0xD800) << 10) | (low as u32 - 0xDC00));
                                    if let Some(c) = char::from_u32(combined) {
                                        out.push(c);
                                        continue;
                                    }
                                }
                            }
                            return Err(String::from("Invalid UTF-16 surrogate pair in JSON"));
                        }
                        let ch = char::from_u32(code as u32)
                            .ok_or_else(|| String::from("Invalid unicode scalar in JSON"))?;
                        out.push(ch);
                    }
                    other => return Err(format!("Invalid JSON escape \\{}", other as char)),
                }
            } else if b < 0x80 {
                if b < 0x20 {
                    return Err(format!("Unescaped control char in JSON at pos {}", self.pos));
                }
                out.push(b as char);
                self.pos += 1;
            } else {
                let s = core::str::from_utf8(&self.bytes[self.pos..])
                    .map_err(|_| String::from("Invalid UTF-8 in JSON string"))?;
                let ch = s.chars().next().ok_or_else(|| String::from("EOF in UTF-8"))?;
                out.push(ch);
                self.pos += ch.len_utf8();
            }
        }
        Err(String::from("Unterminated JSON string"))
    }

    fn parse_hex4(&mut self) -> Result<u16, String> {
        if self.pos + 4 > self.bytes.len() {
            return Err(String::from("Truncated \\uXXXX escape"));
        }
        let hex_str = core::str::from_utf8(&self.bytes[self.pos..self.pos + 4])
            .map_err(|_| String::from("Non-UTF8 in \\uXXXX"))?;
        self.pos += 4;
        u16::from_str_radix(hex_str, 16)
            .map_err(|_| format!("Invalid hex in \\u{}", hex_str))
    }

    fn parse_array(&mut self) -> Result<JsonVal, String> {
        self.expect(b'[')?;
        let mut items = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonVal::Arr(items));
        }
        loop {
            items.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonVal::Arr(items));
                }
                other => {
                    return Err(format!(
                        "Expected ',' or ']' in array at pos {}, got {:?}",
                        self.pos, other
                    ))
                }
            }
        }
    }

    fn parse_object(&mut self) -> Result<JsonVal, String> {
        self.expect(b'{')?;
        let mut map = BTreeMap::new();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonVal::Obj(map));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.expect(b':')?;
            let val = self.parse_value()?;
            map.insert(key, val);
            self.skip_ws();
            match self.peek() {
                Some(b',') => self.pos += 1,
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonVal::Obj(map));
                }
                other => {
                    return Err(format!(
                        "Expected ',' or '}}' in object at pos {}, got {:?}",
                        self.pos, other
                    ))
                }
            }
        }
    }
}

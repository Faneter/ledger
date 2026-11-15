use alloc::format;
use alloc::string::String;

use crate::decimal::Dec;

/// Formats voucher title identically to JS `generateVoucherTitle`.
pub fn generate_voucher_title(
    voucher_type: &str,
    face_value: Dec,
    min_spend: Dec,
) -> String {
    let type_label = if voucher_type == "PREPAID_COUPON" {
        "立减金"
    } else {
        "优惠券"
    };

    let min_str = min_spend.format_trimmed();
    let face_str = face_value.format_trimmed();

    if min_spend.is_positive() {
        format!("满{}减{}{}", min_str, face_str, type_label)
    } else {
        format!("{}元无门槛{}", face_str, type_label)
    }
}

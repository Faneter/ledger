#ifndef LEDGER_CORE_RS_H
#define LEDGER_CORE_RS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Allocate a byte buffer of `len` bytes inside ledger_core_rs. */
uint8_t* ledger_alloc(uint32_t len);

/** Deallocate a byte buffer previously allocated by ledger_core_rs. */
void ledger_dealloc(uint8_t* ptr, uint32_t len);

/** Invoke an operation encoded as UTF-8 JSON and return a newly allocated UTF-8 JSON response. */
uint8_t* ledger_invoke(const uint8_t* req_ptr, uint32_t req_len, uint32_t* out_len);

#ifdef __cplusplus
}
#endif

#endif /* LEDGER_CORE_RS_H */

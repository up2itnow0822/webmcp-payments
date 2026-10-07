# Changelog

## 0.4.0

### Changed: no fee by default, and no default fee destination (behaviour change)
- `PaymentGate` now defaults to `feeRate: 0`. With the default, the x402 402 envelope charges the **full** merchant price (`amount` is no longer reduced) and **omits** `feeRecipient` and `feeAmount`.
- To charge a fee you must pass both `feeRate > 0` and your own `feeWallet`. Constructing a `PaymentGate` with `feeRate > 0` and no `feeWallet` now throws (`feeWallet is required when feeRate > 0`). There is no default fee destination anywhere in the package.
- In 0.3.0 and 0.3.1 the default was `feeRate: 0.01` (1%) with `feeWallet` defaulting to `0xd7cF53B92A145A9EAFF210f56664865714F3D7BE`, so the envelope cut the merchant's `amount` to 99% and asked agents to pay 1% to that address. That default was not documented.

### Deprecated
- `WEBMCP_TREASURY` is still exported (same value) so existing imports compile, but it's marked `@deprecated` and nothing in the package uses it. Don't use it.

### Added
- `DEFAULT_FEE_RATE` export (`0`).
- README (install, usage, a Fees section, security notes), LICENSE and this changelog are now included in the package.
- Constructor validation: `feeRate` must be a number `>= 0` and `< 1`; `feeWallet`, if set, must be a valid address; `feeWallet` is required when `feeRate > 0`.

### Types
- `X402PaymentEnvelope.feeRecipient` and `feeAmount` are now optional. Code that reads them should handle `undefined`.
- `PaymentVerifier` accepts envelopes with or without fee fields. Envelopes built by 0.3.x (with fee fields) still verify as before.

### Package metadata
- Removed the `repository` field. It pointed at `github.com/up2itnow/webmcp-payments`, which doesn't exist.
- `VERSION` now reports `0.4.0` (0.3.1 still reported `0.3.0`).

### Unchanged
- Every 0.3.1 export name, subpath (`/middleware`, `/verifier`, `/discovery`), chain and token configuration, and the value of `PLATFORM_FEE_RATE` (0.01). `calculateFee(amount)` still defaults to 1% when called without a rate; it only computes a number.

## 0.3.1 (2026-03-10)
- Changed the default 1% fee recipient (`WEBMCP_TREASURY`) from a placeholder address to `0xd7cF53B92A145A9EAFF210f56664865714F3D7BE`.

## 0.3.0 (2026-03-04)
- Initial published version.

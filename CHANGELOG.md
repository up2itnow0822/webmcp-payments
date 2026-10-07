# Changelog

## 0.4.0

### Changed: no platform fee by default (behaviour change)
- `PaymentGate` now defaults to `feeRate: 0`. With the default, the x402 402 envelope charges the **full** merchant price (`amount` is no longer reduced) and **omits** `feeRecipient` and `feeAmount`.
- In 0.3.0 and 0.3.1 the default was `feeRate: 0.01` (1%) with `feeWallet` defaulting to `WEBMCP_TREASURY` (`0xd7cF53B92A145A9EAFF210f56664865714F3D7BE`), so the envelope cut the merchant's `amount` to 99% and asked agents to pay 1% to that address. That default was not documented.
- A fee now applies only when you pass `feeRate > 0`. It goes to `feeWallet`, or to `WEBMCP_TREASURY` if no `feeWallet` is given. To keep the 0.3.x behaviour: `new PaymentGate({ merchantWallet, feeRate: PLATFORM_FEE_RATE })`.

### Added
- `DEFAULT_FEE_RATE` export (`0`).
- README (install, usage, a Fees section, security notes), LICENSE and this changelog are now included in the package.
- Constructor validation: `feeRate` must be a number `>= 0` and `< 1`; `feeWallet`, if set, must be a valid address.

### Types
- `X402PaymentEnvelope.feeRecipient` and `feeAmount` are now optional. Code that reads them should handle `undefined`.
- `PaymentVerifier` accepts envelopes with or without fee fields. Envelopes built by 0.3.x (with fee fields) still verify as before.

### Package metadata
- Removed the `repository` field. It pointed at `github.com/up2itnow/webmcp-payments`, which doesn't exist.
- `VERSION` now reports `0.4.0` (0.3.1 still reported `0.3.0`).

### Unchanged
- Every 0.3.1 export, subpath (`/middleware`, `/verifier`, `/discovery`), chain and token configuration, and the values of `WEBMCP_TREASURY` and `PLATFORM_FEE_RATE`. `calculateFee(amount)` still defaults to 1% when called without a rate; it only computes a number.

## 0.3.1 (2026-03-10)
- Set `WEBMCP_TREASURY` to `0xd7cF53B92A145A9EAFF210f56664865714F3D7BE` (previously a placeholder address).

## 0.3.0 (2026-03-04)
- Initial published version.

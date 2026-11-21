/**
 * V22 D1 pricing approval — the single explicit switch behind /pricing.
 *
 * Spec: docs/v22/spec/LOKFEEL_V22_STRATEGIC_RECOVERY_MASTER_ORDER.md
 *   §C.5 (commercial approval gate must not be reopened), §F (/pricing row:
 *   "D1 未批则不露金额" + SSR/RSC/JSON/metadata/schema.org/cache/checkout all
 *   fail closed), §I DEV07, §J V22-G10 ("D1/D8 未批不能有价格/法务假承诺").
 * docs/v22/STRATEGY_LOCK.md §7 keeps D1 approval PENDING, so the default MUST
 * be closed. docs/v22/claim_register.csv CLM-017 marks /pricing GATE_REQUIRED.
 *
 * This is a real code-level switch, not a comment. While it is false, /pricing
 * renders no amount, plan price, discount, trial period or subscribe/开通 CTA,
 * and writes nothing commercial into SSR / metadata / JSON output. The three
 * product lines (Connection OS / legacy B2C / Hlua) are never shown together.
 *
 * Set to true ONLY after the business Owner gives explicit, written approval
 * for D1 pricing (and the approval reference is recorded). Do NOT treat the
 * older commercial gate as sufficient: its products.ts state is a self-set
 * APPROVED value, which is exactly why unapproved prices leaked to production.
 */
export const PRICING_APPROVED = false;

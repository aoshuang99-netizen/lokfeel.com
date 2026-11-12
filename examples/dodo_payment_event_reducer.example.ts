/** DESIGN EXAMPLE ONLY — adapt to actual Prisma/libSQL schema, transactions and real Dodo payload semantics.
 * Do not copy into production without checking provider event IDs and payment transition rules.
 */
export type PaymentState = 'CREATED' | 'FAILED' | 'SUCCEEDED' | 'REFUNDED';
export type PaymentEvent = {
  eventId: string;          // Dodo's unique delivery/event ID, not paymentId
  paymentId: string;
  eventType: 'payment.failed' | 'payment.succeeded' | 'payment.refunded';
};

export function dedupeKey(e: PaymentEvent): string {
  return `dodo:event:${e.eventId}`;
}

export function reducePaymentState(current: PaymentState, eventType: PaymentEvent['eventType']): PaymentState {
  // Failed attempts may subsequently settle; old failed retries cannot roll back a success.
  if (eventType === 'payment.succeeded' && current !== 'REFUNDED') return 'SUCCEEDED';
  if (eventType === 'payment.failed' && current === 'CREATED') return 'FAILED';
  if (eventType === 'payment.refunded' && current === 'SUCCEEDED') return 'REFUNDED';
  return current;
}

/** Actual implementation must, in ONE transaction:
 * 1. Verify authentic signature and event shape.
 * 2. Insert eventId with UNIQUE constraint (duplicate = safe no-op).
 * 3. Resolve payment/organization with immutable provider identifiers.
 * 4. Apply monotonic state transition with row-level/transactional concurrency safety.
 * 5. Apply exactly-once entitlement delta; journal linkage to provider transaction.
 * 6. Commit; then acknowledge webhook. If commit fails, request retry.
 * Separately reconcile Dodo provider settlements vs internal ledger / entitlements.
 */

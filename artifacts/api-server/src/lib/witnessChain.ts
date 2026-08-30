/**
 * The Stay Agent's customer-facing Witness chain key. One append-only chain per
 * property: `${propertyId}:stay-agent-v2`. Falls back to a company-scoped key when no
 * Apaleo property is in play (demo/no-ref).
 *
 * `-v2` is the current generation. The original `${propertyId}:stay-agent` chain is
 * RETIRED (permanent, anchored evidence) and must never be written to again — new
 * seals land on v2 so the retired chain stays immutable and clean.
 */
export const STAY_CHAIN_GENERATION = "stay-agent-v2";
export function stayChainKey(propertyId: string | null | undefined, companyId: number): string {
  const scope = (propertyId && propertyId.trim()) || `co${companyId}`;
  return `${scope}:${STAY_CHAIN_GENERATION}`;
}

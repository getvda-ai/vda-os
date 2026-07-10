/**
 * The Stay Agent's Witness chain key. One append-only chain per property so a
 * property's evidence trail is self-contained and queryable: `${propertyId}:stay-agent`.
 * Falls back to a company-scoped key when no Apaleo property is in play (demo/no-ref).
 */
export function stayChainKey(propertyId: string | null | undefined, companyId: number): string {
  const scope = (propertyId && propertyId.trim()) || `co${companyId}`;
  return `${scope}:stay-agent`;
}

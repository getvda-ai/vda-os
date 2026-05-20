import React, { useState, useEffect, useCallback } from "react";

const T = {
  bg: "#0a0b0e",
  surface: "#12141a",
  border: "#1e2229",
  text: "#e5e7eb",
  dim: "#9ca3af",
  muted: "#6b7280",
  green: "#34d399",
  yellow: "#f59e0b",
  red: "#f87171",
  blue: "#60a5fa",
  mono: "'IBM Plex Mono', monospace",
  sans: "'Outfit', sans-serif",
};

const RATE_CARD = {
  governance_decision: 1,
  onboarding_phase: 5,
  hitl_resolution: 10,
};

const TOPUP_PACKAGES = [
  { id: "starter", credits: 100, priceUsd: 9, label: "Starter" },
  { id: "growth", credits: 500, priceUsd: 39, label: "Growth" },
  { id: "enterprise", credits: 2000, priceUsd: 129, label: "Enterprise" },
];

export default function BillingAdminPanel() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedCompany, setSelectedCompany] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [topupCompany, setTopupCompany] = useState(null);
  const [topupPkg, setTopupPkg] = useState("starter");
  const [topupCredits, setTopupCredits] = useState("");
  const [topupMode, setTopupMode] = useState("package");
  const [topupLoading, setTopupLoading] = useState(false);
  const [topupMessage, setTopupMessage] = useState(null);
  const [tab, setTab] = useState("balances");

  const BASE = window.__API_BASE__ ?? "";

  const loadBalances = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/billing/all-balances`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setCompanies(d.companies ?? []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [BASE]);

  useEffect(() => { loadBalances(); }, [loadBalances]);

  const loadLedger = async (companyId, companyName) => {
    setSelectedCompany({ id: companyId, name: companyName });
    setLedgerLoading(true);
    setLedger([]);
    setTab("ledger");
    try {
      const r = await fetch(`${BASE}/api/billing/ledger/${companyId}?limit=50`);
      const d = await r.json();
      setLedger(d.entries ?? []);
    } catch { setLedger([]); }
    finally { setLedgerLoading(false); }
  };

  const handleTopup = async () => {
    if (!topupCompany) return;
    setTopupLoading(true);
    setTopupMessage(null);
    try {
      const body = { companyId: topupCompany.id };
      if (topupMode === "package") {
        body.packageId = topupPkg;
      } else {
        const c = parseInt(topupCredits, 10);
        if (!c || c <= 0) { setTopupMessage({ ok: false, text: "Enter a positive number of credits" }); setTopupLoading(false); return; }
        body.credits = c;
      }
      const r = await fetch(`${BASE}/api/billing/topup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (r.ok && d.ok) {
        setTopupMessage({ ok: true, text: `✓ Added ${d.creditsAdded} credits. New balance: ${d.balanceAfter}` });
        await loadBalances();
        if (selectedCompany?.id === topupCompany.id) {
          await loadLedger(topupCompany.id, topupCompany.name);
        }
        setTopupCredits("");
      } else {
        setTopupMessage({ ok: false, text: d.error ?? "Top-up failed" });
      }
    } catch (e) {
      setTopupMessage({ ok: false, text: e.message });
    } finally {
      setTopupLoading(false); }
  };

  const cell = (style = {}) => ({
    padding: "8px 12px",
    borderBottom: `1px solid ${T.border}`,
    fontSize: 12,
    fontFamily: T.mono,
    color: T.text,
    ...style,
  });

  const th = (style = {}) => ({
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 10,
    fontFamily: T.mono,
    color: T.muted,
    fontWeight: 600,
    letterSpacing: "0.07em",
    borderBottom: `1px solid ${T.border}`,
    background: T.surface,
    ...style,
  });

  return (
    <div style={{ background: T.bg, minHeight: "100vh", padding: 28 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 11, fontFamily: T.mono, color: T.muted, letterSpacing: "0.1em", marginBottom: 4 }}>
            PLATFORM ADMIN
          </div>
          <h2 style={{ margin: 0, fontSize: 22, fontFamily: T.sans, fontWeight: 700, color: T.text }}>
            x402 Billing
          </h2>
          <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, marginTop: 4 }}>
            Credit wallet balances · Usage ledger · Top-up
          </div>
        </div>
        <button onClick={loadBalances} disabled={loading} style={{
          background: T.surface, border: `1px solid ${T.border}`, color: T.dim,
          padding: "6px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
        }}>
          {loading ? "Loading…" : "↻ Refresh"}
        </button>
      </div>

      {/* Rate Card */}
      <div style={{
        background: T.surface, border: `1px solid ${T.border}`, borderRadius: 8,
        padding: "12px 16px", marginBottom: 24, display: "flex", gap: 24, flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted, letterSpacing: "0.07em", alignSelf: "center" }}>RATE CARD</div>
        {Object.entries(RATE_CARD).map(([op, cost]) => (
          <div key={op} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, fontFamily: T.mono, color: T.dim }}>{op.replace(/_/g, " ")}</span>
            <span style={{
              fontSize: 11, fontFamily: T.mono, fontWeight: 700, color: T.green,
              background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)",
              borderRadius: 4, padding: "2px 8px",
            }}>{cost} cr</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${T.border}`, marginBottom: 24 }}>
        {[{ id: "balances", label: "Tenant Balances" }, { id: "ledger", label: selectedCompany ? `Ledger — ${selectedCompany.name}` : "Ledger" }, { id: "topup", label: "Top-up Credits" }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            background: "none", border: "none", borderBottom: `2px solid ${tab === t.id ? T.blue : "transparent"}`,
            color: tab === t.id ? T.blue : T.dim, padding: "8px 18px",
            cursor: "pointer", fontSize: 12, fontFamily: T.sans, fontWeight: tab === t.id ? 700 : 400,
          }}>{t.label}</button>
        ))}
      </div>

      {/* ── Balances Tab ── */}
      {tab === "balances" && (
        <div>
          {error && (
            <div style={{ color: T.red, fontFamily: T.mono, fontSize: 12, marginBottom: 12 }}>{error}</div>
          )}
          <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th()}>ID</th>
                  <th style={th()}>Company</th>
                  <th style={th()}>Industry</th>
                  <th style={th()}>x402 Status</th>
                  <th style={th({ textAlign: "right" })}>Balance</th>
                  <th style={th()}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={cell({ color: T.muted, textAlign: "center", padding: 24 })}>Loading…</td></tr>
                ) : companies.length === 0 ? (
                  <tr><td colSpan={6} style={cell({ color: T.muted, textAlign: "center", padding: 24 })}>No companies found. Run /api/admin/seed-companies first.</td></tr>
                ) : companies.map((c) => (
                  <tr key={c.id} style={{ background: selectedCompany?.id === c.id ? "rgba(96,165,250,0.04)" : "transparent" }}>
                    <td style={cell({ color: T.muted })}>{c.id}</td>
                    <td style={cell({ fontWeight: 700, color: T.text })}>{c.companyName}</td>
                    <td style={cell({ color: T.dim })}>{c.industry}</td>
                    <td style={cell()}>
                      {c.x402Exempt ? (
                        <span style={{
                          fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.green,
                          background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)",
                          borderRadius: 4, padding: "2px 8px",
                        }}>EXEMPT</span>
                      ) : (
                        <span style={{
                          fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.yellow,
                          background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)",
                          borderRadius: 4, padding: "2px 8px",
                        }}>METERED</span>
                      )}
                    </td>
                    <td style={cell({ textAlign: "right" })}>
                      {c.x402Exempt ? (
                        <span style={{ color: T.muted }}>∞</span>
                      ) : (
                        <span style={{
                          fontWeight: 700, color: c.balance <= 0 ? T.red : c.balance < 20 ? T.yellow : T.green,
                        }}>{c.balance} cr</span>
                      )}
                    </td>
                    <td style={cell()}>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          onClick={() => loadLedger(c.id, c.companyName)}
                          style={{
                            background: "none", border: `1px solid ${T.border}`, color: T.dim,
                            padding: "3px 10px", borderRadius: 4, cursor: "pointer", fontSize: 10, fontFamily: T.mono,
                          }}>
                          Ledger
                        </button>
                        {!c.x402Exempt && (
                          <button
                            onClick={() => { setTopupCompany(c); setTab("topup"); setTopupMessage(null); }}
                            style={{
                              background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.2)",
                              color: T.green, padding: "3px 10px", borderRadius: 4, cursor: "pointer",
                              fontSize: 10, fontFamily: T.mono,
                            }}>
                            Top-up
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Ledger Tab ── */}
      {tab === "ledger" && (
        <div>
          {!selectedCompany ? (
            <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 12, padding: 24, textAlign: "center" }}>
              Select a company from the Tenant Balances tab to view its ledger.
            </div>
          ) : (
            <>
              <div style={{ fontFamily: T.mono, fontSize: 12, color: T.dim, marginBottom: 16 }}>
                Last 50 transactions for <span style={{ color: T.text, fontWeight: 700 }}>{selectedCompany.name}</span>
              </div>
              {ledgerLoading ? (
                <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 12, textAlign: "center", padding: 24 }}>Loading…</div>
              ) : ledger.length === 0 ? (
                <div style={{ color: T.muted, fontFamily: T.mono, fontSize: 12, textAlign: "center", padding: 24 }}>
                  No ledger entries yet. This company has not made any governance calls.
                </div>
              ) : (
                <div style={{ border: `1px solid ${T.border}`, borderRadius: 8, overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                      <tr>
                        <th style={th()}>Timestamp</th>
                        <th style={th()}>Operation</th>
                        <th style={th()}>Description</th>
                        <th style={th()}>Source</th>
                        <th style={th({ textAlign: "right" })}>Δ Credits</th>
                        <th style={th({ textAlign: "right" })}>Balance After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledger.map((e) => (
                        <tr key={e.id}>
                          <td style={cell({ color: T.muted, fontSize: 10 })}>
                            {new Date(e.createdAt).toISOString().replace("T", " ").slice(0, 19)}
                          </td>
                          <td style={cell()}>
                            <span style={{
                              fontSize: 10, fontFamily: T.mono,
                              color: e.deltaCredits > 0 ? T.green : T.yellow,
                              background: e.deltaCredits > 0 ? "rgba(52,211,153,0.08)" : "rgba(245,158,11,0.08)",
                              border: `1px solid ${e.deltaCredits > 0 ? "rgba(52,211,153,0.2)" : "rgba(245,158,11,0.2)"}`,
                              borderRadius: 4, padding: "1px 6px",
                            }}>
                              {e.operation.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td style={cell({ color: T.dim, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                            {e.description ?? "—"}
                          </td>
                          <td style={cell({ color: T.muted, fontSize: 10, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>
                            {e.sourceRef ?? "—"}
                          </td>
                          <td style={cell({ textAlign: "right", fontWeight: 700, color: e.deltaCredits > 0 ? T.green : T.red })}>
                            {e.deltaCredits > 0 ? `+${e.deltaCredits}` : e.deltaCredits}
                          </td>
                          <td style={cell({ textAlign: "right", color: T.dim })}>{e.balanceAfter}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Top-up Tab ── */}
      {tab === "topup" && (
        <div style={{ maxWidth: 480 }}>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, display: "block", marginBottom: 8 }}>
              COMPANY
            </label>
            <select
              value={topupCompany?.id ?? ""}
              onChange={e => {
                const c = companies.find(x => x.id === Number(e.target.value));
                setTopupCompany(c ?? null);
                setTopupMessage(null);
              }}
              style={{
                background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                padding: "8px 12px", borderRadius: 6, fontSize: 12, fontFamily: T.mono,
                width: "100%", outline: "none",
              }}
            >
              <option value="">— select a tenant —</option>
              {companies.filter(c => !c.x402Exempt).map(c => (
                <option key={c.id} value={c.id}>{c.companyName} (balance: {c.balance} cr)</option>
              ))}
            </select>
            {companies.filter(c => !c.x402Exempt).length === 0 && (
              <div style={{ fontSize: 11, fontFamily: T.mono, color: T.muted, marginTop: 8 }}>
                All companies are currently x402-exempt. Add a non-citizenM tenant to top up.
              </div>
            )}
          </div>

          {topupCompany && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button
                    onClick={() => setTopupMode("package")}
                    style={{
                      background: topupMode === "package" ? "rgba(96,165,250,0.1)" : "none",
                      border: `1px solid ${topupMode === "package" ? T.blue : T.border}`,
                      color: topupMode === "package" ? T.blue : T.dim,
                      padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
                    }}>Package</button>
                  <button
                    onClick={() => setTopupMode("custom")}
                    style={{
                      background: topupMode === "custom" ? "rgba(96,165,250,0.1)" : "none",
                      border: `1px solid ${topupMode === "custom" ? T.blue : T.border}`,
                      color: topupMode === "custom" ? T.blue : T.dim,
                      padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: T.mono,
                    }}>Custom amount</button>
                </div>

                {topupMode === "package" && (
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                    {TOPUP_PACKAGES.map(pkg => (
                      <button
                        key={pkg.id}
                        onClick={() => setTopupPkg(pkg.id)}
                        style={{
                          background: topupPkg === pkg.id ? "rgba(52,211,153,0.08)" : T.surface,
                          border: `1px solid ${topupPkg === pkg.id ? "rgba(52,211,153,0.4)" : T.border}`,
                          borderRadius: 8, padding: "14px 10px", cursor: "pointer", textAlign: "center",
                        }}>
                        <div style={{ fontSize: 11, fontFamily: T.mono, color: topupPkg === pkg.id ? T.green : T.dim, marginBottom: 4 }}>{pkg.label}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: T.sans, color: topupPkg === pkg.id ? T.green : T.text }}>{pkg.credits}</div>
                        <div style={{ fontSize: 10, fontFamily: T.mono, color: T.muted }}>credits</div>
                        <div style={{ fontSize: 12, fontFamily: T.mono, color: T.dim, marginTop: 6 }}>${pkg.priceUsd}</div>
                      </button>
                    ))}
                  </div>
                )}

                {topupMode === "custom" && (
                  <div>
                    <label style={{ fontFamily: T.mono, fontSize: 11, color: T.muted, display: "block", marginBottom: 8 }}>CREDITS</label>
                    <input
                      type="number"
                      min={1}
                      value={topupCredits}
                      onChange={e => setTopupCredits(e.target.value)}
                      placeholder="e.g. 250"
                      style={{
                        background: T.surface, border: `1px solid ${T.border}`, color: T.text,
                        padding: "8px 12px", borderRadius: 6, fontSize: 12, fontFamily: T.mono,
                        width: "100%", outline: "none", boxSizing: "border-box",
                      }}
                    />
                  </div>
                )}
              </div>

              <button
                onClick={handleTopup}
                disabled={topupLoading || !topupCompany}
                style={{
                  background: topupLoading ? T.surface : "rgba(52,211,153,0.12)",
                  border: `1px solid ${topupLoading ? T.border : "rgba(52,211,153,0.4)"}`,
                  color: topupLoading ? T.muted : T.green,
                  padding: "10px 24px", borderRadius: 6, cursor: topupLoading ? "not-allowed" : "pointer",
                  fontSize: 13, fontWeight: 700, fontFamily: T.sans, width: "100%",
                }}>
                {topupLoading ? "Adding credits…" : `Add Credits to ${topupCompany.companyName}`}
              </button>

              {topupMessage && (
                <div style={{
                  marginTop: 12, padding: "10px 14px", borderRadius: 6, fontSize: 12, fontFamily: T.mono,
                  background: topupMessage.ok ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
                  border: `1px solid ${topupMessage.ok ? "rgba(52,211,153,0.3)" : "rgba(248,113,113,0.3)"}`,
                  color: topupMessage.ok ? T.green : T.red,
                }}>
                  {topupMessage.text}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

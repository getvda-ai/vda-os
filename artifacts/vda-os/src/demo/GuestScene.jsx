import { useState, useEffect } from "react";

const C = {
  bg: "#0a0c10",
  card: "#111318",
  border: "#1e2130",
  text: "#ffffff",
  muted: "#8b92a5",
  dim: "#555d72",
  green: "#4ade80",
  amber: "#f59e0b",
  red: "#f87171",
  blue: "#60a5fa",
  purple: "#a855f7",
  orange: "#fb923c",
};

function PhoneFrame({ children, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", height: "100%" }}>
      <div style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
        color: C.dim, marginBottom: 10,
      }}>{label}</div>
      <div style={{
        background: "#0d0f14",
        border: `2px solid ${C.border}`,
        borderRadius: 28,
        width: 280,
        flex: 1,
        maxHeight: 480,
        overflow: "hidden",
        position: "relative",
        boxShadow: "0 0 60px rgba(0,0,0,0.8), inset 0 0 0 1px rgba(255,255,255,0.04)",
        display: "flex",
        flexDirection: "column",
      }}>
        <div style={{
          height: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderBottom: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{ width: 60, height: 6, background: C.border, borderRadius: 3 }} />
        </div>
        <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
          {children}
        </div>
        <div style={{
          height: 24,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderTop: `1px solid ${C.border}`,
          flexShrink: 0,
        }}>
          <div style={{ width: 40, height: 4, background: C.border, borderRadius: 2 }} />
        </div>
      </div>
    </div>
  );
}

function AppHeader({ title }) {
  return (
    <div style={{
      background: "#070a0f",
      borderBottom: `1px solid ${C.border}`,
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 8,
    }}>
      <span style={{ fontSize: 14, fontWeight: 900, letterSpacing: "-0.03em", color: C.text }}>citizenM</span>
      <span style={{ fontSize: 10, color: C.dim }}>·</span>
      <span style={{ fontSize: 11, color: C.muted }}>{title}</span>
    </div>
  );
}

function Scene1_Availability({ result }) {
  const [visible, setVisible] = useState([]);
  const rooms = [
    { type: "Compact Room", price: "€175", avail: 4, icon: "🛏" },
    { type: "Standard Room", price: "€195", avail: 7, icon: "🏨" },
    { type: "Corner Room", price: "€220", avail: 2, icon: "⭐" },
  ];
  useEffect(() => {
    const timers = rooms.map((_, i) => setTimeout(() => setVisible(prev => [...prev, i]), 200 + i * 200));
    return () => timers.forEach(clearTimeout);
  }, []);
  const isPass = result?.decision === "PASS";
  return (
    <PhoneFrame label="Guest's device">
      <AppHeader title="Availability" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, color: C.muted, marginBottom: 4 }}>
          Vienna · 2 nights · 2 adults
        </div>
        {rooms.map((r, i) => (
          <div key={i} style={{
            background: C.card,
            border: `1px solid ${isPass && visible.includes(i) ? C.green + "50" : C.border}`,
            borderRadius: 10,
            padding: "10px 12px",
            opacity: visible.includes(i) ? 1 : 0,
            transform: visible.includes(i) ? "none" : "translateY(10px)",
            transition: "all 0.35s ease",
            display: "flex", alignItems: "center", gap: 8,
          }}>
            <span style={{ fontSize: 20 }}>{r.icon}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: C.text }}>{r.type}</div>
              <div style={{ fontSize: 9, color: C.muted }}>{r.avail} units available</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: isPass ? C.green : C.muted }}>{r.price}</div>
              <div style={{ fontSize: 8, color: C.dim }}>per night</div>
            </div>
          </div>
        ))}
        {isPass && (
          <div style={{
            background: `${C.green}12`, border: `1px solid ${C.green}40`,
            borderRadius: 8, padding: "6px 10px", textAlign: "center",
            fontSize: 10, color: C.green, fontWeight: 700,
            animation: "fadeIn 0.4s ease",
          }}>
            Agent confirmed availability ✓
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Scene2_Rate({ result }) {
  const [showDiscount, setShowDiscount] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShowDiscount(true), 600);
    return () => clearTimeout(t);
  }, []);
  const isPass = result?.decision === "PASS";
  return (
    <PhoneFrame label="Guest's device">
      <AppHeader title="Rate Negotiation" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "12px",
        }}>
          <div style={{ fontSize: 10, color: C.muted, marginBottom: 6 }}>Standard Room · 1 night</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 900, color: C.text }}>€175</span>
            <span style={{ fontSize: 11, color: C.dim, textDecoration: "line-through" }}>€180</span>
            <span style={{ fontSize: 9, background: `${C.green}20`, color: C.green, padding: "1px 5px", borderRadius: 3 }}>BAR</span>
          </div>
          <div style={{ fontSize: 9, color: C.dim }}>Best Available Rate</div>
        </div>
        <button style={{
          background: "#1a1f2e", border: `1px solid ${C.border}`,
          borderRadius: 8, padding: "8px 12px",
          fontSize: 11, color: C.muted, cursor: "default",
          textAlign: "left",
        }}>
          <span style={{ color: C.text }}>Request discount</span>
          <span style={{ float: "right", fontSize: 9 }}>5% off →</span>
        </button>
        {showDiscount && (
          <div style={{
            background: isPass ? `${C.green}12` : `${C.amber}12`,
            border: `1px solid ${isPass ? C.green : C.amber}40`,
            borderRadius: 8, padding: "10px 12px",
            opacity: showDiscount ? 1 : 0,
            transition: "opacity 0.4s",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: isPass ? C.green : C.amber, marginBottom: 4 }}>
              {isPass ? "Discount approved autonomously" : "Escalated to Revenue Manager"}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 20, fontWeight: 900, color: C.text }}>€171</span>
              <span style={{ fontSize: 9, color: C.muted }}>/ night · 5% off applied</span>
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>
              Within autonomous agent authority band
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Scene3_Reservation({ result }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 400);
    const t2 = setTimeout(() => setStage(2), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const resvId = result?.apaleoIds?.reservationId ?? "VIE-DEMO-001";
  return (
    <PhoneFrame label="Guest's device">
      <AppHeader title="Booking" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        {stage >= 1 && (
          <div style={{
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 10, padding: "12px",
            animation: "fadeIn 0.3s ease",
          }}>
            <div style={{ fontSize: 9, color: C.muted, marginBottom: 8 }}>Booking summary</div>
            {[
              ["Hotel", "citizenM Vienna"],
              ["Room", "Standard Room"],
              ["Rate", "€171 / night (5% off)"],
              ["Dates", "+7 → +8 days"],
              ["Guest", "Demo Guest"],
            ].map(([k, v]) => (
              <div key={k} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: C.dim }}>{k}</span>
                <span style={{ fontSize: 10, color: C.text, fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {stage >= 2 && (
          <div style={{
            background: `${C.green}12`,
            border: `1px solid ${C.green}40`,
            borderRadius: 10,
            padding: "12px",
            animation: "fadeIn 0.3s ease",
          }}>
            <div style={{ textAlign: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 24 }}>✅</span>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.green, textAlign: "center", marginBottom: 6 }}>
              Booking confirmed
            </div>
            <div style={{
              background: "#0a1020", border: `1px solid ${C.border}`,
              borderRadius: 6, padding: "5px 8px", textAlign: "center",
              fontSize: 9, color: C.blue, fontFamily: "monospace",
            }}>
              {resvId.slice(0, 20)}
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Scene4_CheckIn({ result }) {
  const [gates, setGates] = useState([]);
  const gateList = [
    "Reservation confirmed",
    "Identity verified",
    "Open folio found",
    "Payment secured",
    "No arrival holds",
  ];
  const isPass = result?.decision === "PASS";
  useEffect(() => {
    if (result) {
      const timers = gateList.map((_, i) => setTimeout(() => setGates(prev => [...prev, i]), 200 + i * 250));
      return () => timers.forEach(clearTimeout);
    }
  }, [result]);
  return (
    <PhoneFrame label="kiosk screen">
      <AppHeader title="Check-In" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, color: C.muted, textAlign: "center" }}>
          5-gate validation
        </div>
        {gateList.map((gate, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: C.card,
            border: `1px solid ${gates.includes(i) && isPass ? C.green + "50" : C.border}`,
            borderRadius: 8,
            padding: "8px 10px",
            opacity: gates.includes(i) ? 1 : 0.4,
            transition: "all 0.35s ease",
          }}>
            <div style={{
              width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
              background: gates.includes(i)
                ? (isPass ? `${C.green}25` : `${C.red}25`)
                : C.border,
              border: `1.5px solid ${gates.includes(i) ? (isPass ? C.green : C.red) : C.border}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 10,
              transition: "all 0.3s",
            }}>
              {gates.includes(i) ? (isPass ? "✓" : "✗") : ""}
            </div>
            <span style={{ fontSize: 11, color: gates.includes(i) ? C.text : C.dim }}>{gate}</span>
          </div>
        ))}
        {gates.length === 5 && isPass && (
          <div style={{
            background: `${C.green}12`, border: `1px solid ${C.green}40`,
            borderRadius: 8, padding: "8px",
            textAlign: "center", fontSize: 11, fontWeight: 700, color: C.green,
            animation: "fadeIn 0.4s ease",
          }}>
            Welcome! Room 412 is ready 🛏
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Scene5_FolioCharge({ result }) {
  const [posted, setPosted] = useState(false);
  useEffect(() => {
    if (result) {
      const t = setTimeout(() => setPosted(true), 500);
      return () => clearTimeout(t);
    }
  }, [result]);
  const folioId = result?.apaleoIds?.folioId ?? "FOLIO-VIE-001";
  return (
    <PhoneFrame label="folio system">
      <AppHeader title="Folio" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: "12px",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: C.muted }}>Folio</span>
            <span style={{ fontSize: 9, color: C.blue, fontFamily: "monospace" }}>{folioId.slice(0, 16)}</span>
          </div>
          <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
            {[
              { name: "Standard Room Rate", amount: "€171.00", posted: true },
            ].map((item, i) => (
              <div key={i} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, color: C.muted }}>{item.name}</span>
                <span style={{ fontSize: 10, color: C.text }}>{item.amount}</span>
              </div>
            ))}
            <div style={{
              display: "flex", justifyContent: "space-between",
              marginTop: 4, paddingTop: 4, borderTop: `1px dashed ${C.border}`,
              opacity: posted ? 1 : 0.3,
              transition: "opacity 0.5s",
            }}>
              <span style={{ fontSize: 10, color: posted ? C.green : C.muted }}>
                Room Rate Supplement
              </span>
              <span style={{ fontSize: 10, color: posted ? C.green : C.muted, fontWeight: 700 }}>+€89.00</span>
            </div>
          </div>
        </div>
        {posted && (
          <div style={{
            background: `${C.green}10`, border: `1px solid ${C.green}35`,
            borderRadius: 8, padding: "6px 10px",
            display: "flex", alignItems: "center", gap: 6,
            animation: "fadeIn 0.4s ease",
          }}>
            <span style={{ fontSize: 12 }}>✅</span>
            <span style={{ fontSize: 10, color: C.green }}>Charge posted · O2C policy verified</span>
          </div>
        )}
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 8, padding: "8px 10px",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: C.text }}>Total</span>
          <span style={{ fontSize: 13, fontWeight: 900, color: C.text }}>€260.00</span>
        </div>
      </div>
    </PhoneFrame>
  );
}

function Scene6_Checkout({ result }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    if (result) {
      const t1 = setTimeout(() => setStage(1), 300);
      const t2 = setTimeout(() => setStage(2), 700);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [result]);
  const hasException = result?.exceptionApplied;
  return (
    <PhoneFrame label="Guest's device">
      <AppHeader title="Checkout" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ textAlign: "center", padding: "10px 0" }}>
          <span style={{ fontSize: 36 }}>🚪</span>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginTop: 6 }}>Checking out…</div>
          <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>Standard departure: 12:00</div>
        </div>
        {stage >= 1 && hasException && (
          <div style={{
            background: `${C.purple}12`, border: `1px solid ${C.purple}40`,
            borderRadius: 10, padding: "10px 12px",
            animation: "fadeIn 0.4s ease",
          }}>
            <div style={{
              display: "flex", alignItems: "center", gap: 6, marginBottom: 6,
            }}>
              <span style={{ fontSize: 14 }}>🏅</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: C.purple }}>Gold Loyalty Exception Applied</span>
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>
              Late checkout until 13:00 — fee waived
            </div>
            <div style={{ fontSize: 9, color: C.dim, marginTop: 4 }}>
              Governed by EXCEPTION.md policy overlay
            </div>
          </div>
        )}
        {stage >= 2 && (
          <div style={{
            background: `${C.green}12`, border: `1px solid ${C.green}40`,
            borderRadius: 10, padding: "10px 12px", textAlign: "center",
            animation: "fadeIn 0.4s ease",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 4 }}>
              Checkout complete ✓
            </div>
            <div style={{ fontSize: 10, color: C.muted }}>Thank you for staying with citizenM</div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

function Scene7_Revenue({ result }) {
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setStage(1), 300);
    const t2 = setTimeout(() => setStage(2), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);
  const hash = result?.witnessEntryId ? `#${result.witnessEntryId}` : "#7182";
  return (
    <PhoneFrame label="revenue system">
      <AppHeader title="Reconciliation" />
      <div style={{ padding: "12px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ textAlign: "center", padding: "6px 0" }}>
          <span style={{ fontSize: 28 }}>📊</span>
        </div>
        {[
          { label: "Journey steps", value: "7 / 7", color: C.green },
          { label: "Policy violations", value: "0", color: C.green },
          { label: "AI decisions", value: "7", color: C.text },
          { label: "Revenue posted", value: "€260.00", color: C.text },
        ].map(({ label, value, color }, i) => (
          <div key={i} style={{
            display: "flex", justifyContent: "space-between",
            background: C.card, border: `1px solid ${C.border}`,
            borderRadius: 8, padding: "8px 10px",
            opacity: stage >= 1 ? 1 : 0.3,
            transition: `opacity ${0.3 + i * 0.1}s ease`,
          }}>
            <span style={{ fontSize: 10, color: C.muted }}>{label}</span>
            <span style={{ fontSize: 10, fontWeight: 700, color }}>{value}</span>
          </div>
        ))}
        {stage >= 2 && (
          <div style={{
            background: "#0a1020", border: `1px solid #1e3a5f`,
            borderRadius: 8, padding: "8px 10px",
            animation: "fadeIn 0.4s ease",
          }}>
            <div style={{ fontSize: 9, color: C.blue, fontWeight: 700, marginBottom: 3 }}>
              WITNESS LEDGER SEALED
            </div>
            <div style={{ fontSize: 9, color: C.muted, fontFamily: "monospace" }}>
              Entry {hash} · SOC-2 ready
            </div>
          </div>
        )}
      </div>
    </PhoneFrame>
  );
}

const SCENES = {
  1: Scene1_Availability,
  2: Scene2_Rate,
  3: Scene3_Reservation,
  4: Scene4_CheckIn,
  5: Scene5_FolioCharge,
  6: Scene6_Checkout,
  7: Scene7_Revenue,
};

export default function GuestScene({ step, result }) {
  const Scene = SCENES[step];
  if (!Scene) return null;
  return (
    <div style={{
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    }}>
      <Scene result={result} />
    </div>
  );
}

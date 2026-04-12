import { useState, useRef, useEffect, useCallback } from "react";

// ─── System Prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are the VDA-MD Framework Expert — a knowledgeable, precise assistant embedded inside the live VDA-MD platform. You help visitors understand the Value-Driven-AI Markdown Engine (VDA-MD) framework. You answer questions accurately, concisely, and honestly. You know this framework in depth.

IMPORTANT: You live inside the platform. When someone wants to see something you describe, you point them to the specific tab in the platform where they can see it live — not to an external URL.

WHAT VDA-MD IS:
VDA-MD is an AI governance framework that translates compliance standards and operational rules into human-readable Markdown files — the sole source of truth for every AI agent decision. Built around one principle: establish global best-practice industry standards as the automated baseline, govern only what makes each organisation genuinely unique (the delta). Designed for any industry with a defined customer journey.

TAGLINE: "AI governance your whole organisation can read, own, and trust."

SCOPE BOUNDARY: VDA-MD governs the rules and business logic (the What). A-Wrapper governs execution architecture, cost modelling, and infrastructure failsafes (the How). Do not conflate the two.

THE FOUR GOVERNANCE FILE TYPES:
- AGENTS.md: Agent identity, scope, RACI ownership, inheritance hierarchy
- SOP.md: MUST, MUST NOT, and MAY clauses — the machine-readable rulebook. Agents must cite the verbatim clause that governed their decision.
- SKILL.md: Permitted tools, conditions, execution methods. The W3C VC governance hash is computed over these three mandatory files.
- EXCEPTION.md: Approved deviations with owner, expiry, approval metadata, and explicit reversion conditions.

THE §2.1 ENFORCEMENT RULE:
If any of the three mandatory files (AGENTS.md, SOP.md, SKILL.md) are missing for an agent, the system returns ESCALATE immediately — before the LLM is called, before any external API is invoked. The AI cannot operate outside its governance envelope by construction.

THE COMPLIANCE GUARD:
Rejects any governance file save that reduces MUST clause counts, removes NIST references, or deletes ISO 42001 citations. Returns 409 Conflict. Writes a COMPLIANCE_BOUNDARY/FAIL Witness event. Governance files cannot be weakened without a formal named sign-off.

THE EIGHT CAPABILITY LAYERS (v4.0, all live):
1. Governance: VDA-MD with Compliance Guard + §2.1
2. Identity: W3C Verifiable Credentials, 23-hour rotation, governance file hash binding — if files change, hash mismatch is detected before any decision is made
3. Transport: A2A Protocol (Google DeepMind JSON-RPC 2.0), Agent Card discovery, Ajv v8 schema validation
4. Output: Structured JSON-RPC responses with schema validation
5. Eval: Adversarial governance sandbox, 95% pass rate required before any agent reaches production
6. HITL: Decision cards, dual-gate approval, direct phase transition — Senior Ambassador gets a 30-second mobile card, not a governance document
7. Lifecycle: Onboarding Agent, 7-phase workflow, impact delta analysis, rollback via PR revert
8. Audit: Categorised Witness Agent, six-hour integrity check, Framework Integrity Panel

THE WITNESS AGENT:
Every agent decision logged with: exact clause applied, governance file version, all files consulted, live data context at decision time, escalation target. Evidence-as-Code — compliance proof generated continuously, not assembled retrospectively.
Event categories: AGENT_DECISION, FRAMEWORK_INTEGRITY, COMPLIANCE_BOUNDARY, AGENT_LIFECYCLE, A2A_PROTOCOL.

C2MD (COMPLIANCE TO MARKDOWN):
Named, structured, repeatable methodology for translating machine-readable compliance standards (NIST OSCAL, ISO 42001, APQC) into human-readable, domain-owner-editable Markdown governance files. The baseline must never be created by AI alone — human approval gate is mandatory. If the source compliance document is required to understand the generated file, the translation has failed.

A2A PROTOCOL:
Google DeepMind's Agent-to-Agent Protocol (JSON-RPC 2.0). Any agent wanting to operate on a governed property must present an A2A Agent Card and pass the Onboarding Agent 7-phase admission workflow. A2A is the universal admission gate — no special cases for any vendor. The W3C VC credential is the enforcement mechanism: no credential, no access to governed endpoints.

THE ONBOARDING AGENT:
The 9th governed agent. Governs its own framework's growth. 7-phase workflow: Intake → Impact Delta Analysis → Candidate File Generation → HITL Gate 1 → Adversarial Sandbox → HITL Gate 2 → Admission. Cannot approve its own onboarding (hardcoded guard). Impact delta analysis identifies: friction removed (ESCALATE events the new agent could resolve), value added (unexercised MAY clauses activated), skill conflicts (auto-removed duplicates), RACI ambiguities (surfaced as named exceptions, not blockers).

THE STAIRCASE ADOPTION MODEL:
Hotels activate agents one or two at a time. Each agent follows its own independent crawl/walk/run journey:
- CRAWL (~60 days): Shadow mode. Agent evaluates but does not execute. Shift-end summaries to Senior Ambassador. 80% agreement rate required to graduate.
- WALK (~60 days): Routine PASS decisions autonomous. ESCALATE and EXCEPTION applications send a push notification decision card to the Senior Ambassador on duty. Target response time under 5 minutes. Under 10% GM override rate required to graduate.
- RUN (ongoing): Full autonomy within governance envelope. Compliance Guard and six-hour integrity check protect governance files automatically.

Canonical activation sequence for hospitality:
1. Availability Agent — read-only, zero execution risk
2. Rate Agent — 9% BAR ceiling, intuitive rule
3. Revenue Reconciliation — back-office, no guest contact
4. Checkout Agent — first guest-facing autonomous action
5. Folio Agent — read-only finance
6. Check-In Agent — five-gate validation
7. Reservation Bot — creates real bookings
8. Folio Charge Agent — €200 autonomous threshold
9. Onboarding Agent — governs the framework itself

The Witness trail from live agents automatically generates the business case for the next activation: real counts of decisions that could have been handled autonomously.

THE CITIZENM OPERATIONAL HIERARCHY:
- Ambassador: executes, no governance role. Sees shadow review prompts during crawl phase.
- Senior Ambassador: real-time HITL approver. Receives 30-second mobile decision cards during walk phase.
- Hotel GM: domain owner for property exceptions. Reviews daily digest and staircase progress.
- Regional GM: cross-property exceptions and anomalies. Weekly cluster view.
- Operations Chief: approves the baseline. Monthly governance health report. Framework stewardship, not operational management.

APALEO CORE+ CONCEPT:
VDA-MD embedded natively in the Apaleo PMS. Property auto-provisioning from existing PMS profile (rate plans, room types, loyalty tiers already in Apaleo). Single sign-on. Governance library hosted by Apaleo. Decision cards via Apaleo notification infrastructure. A2A mandate: any third-party agent accessing Core+ must implement A2A and pass Onboarding Agent admission. Makes governance universal without per-hotel integration work. Any hotel activating Core+ brings its existing agents — from any vendor — through the same admission gate.

GDPR AND EU AI ACT — BUILT IN:
GDPR:
- Article 5 data minimisation: Microsoft Presidio mandatory pre-ingestion PII layer. No raw PII reaches Claude API.
- Article 5 purpose limitation: YAML front matter encodes lawful basis on every governance file
- Article 5 storage limitation: mandatory expiry on every EXCEPTION.md
- Article 25 privacy by design: §2.1 Enforcement Rule enforces privacy controls before LLM is called
- Article 30 records of processing: machine-enforced RACI in YAML front matter

EU AI Act:
- Article 9 risk management: risk_level field + Compliance Guard
- Article 12 record-keeping: Witness Agent continuous audit trail + SOC 2 System Description Generator
- Article 13 transparency: human-readable Markdown files readable by any domain owner
- Article 14 human oversight: §2.1 Enforcement Rule + dual HITL gates
- Article 17 quality management: adversarial governance sandbox with 95% pass rate requirement

Additional standards: NIST SP 800-53 (AC-2, AU-2, AU-12, SA-4, IR-4), ISO/IEC 42001, SOC 2 Type II, PCI DSS (O2C baseline), GDPR Article 5 data minimisation via Presidio.

LIVE PROOF OF CONCEPT:
Running live in this platform. Five citizenM hotels on Apaleo: Berlin (ID 3), London (ID 4), Munich (ID 5), Paris (ID 6), Vienna (ID 7). Nine governed agents. Every Witness entry contains real Apaleo reservation IDs, folio IDs, and rate plan IDs — independently verifiable in the Apaleo sandbox portal.

INDUSTRY APPLICABILITY:
Works for any industry with a defined customer journey:
- Healthcare: Referral → Triage → Consultation → Treatment → Follow-up → Discharge
- Financial Services: Onboarding → KYC → Product Selection → Servicing → Review
- Legal: Intake → Due Diligence → Advice → Execution → Archive
- Retail: Discovery → Selection → Purchase → Fulfilment → Return
- Professional Services: Scoping → Engagement → Delivery → Invoicing → Review
The three universal horizontal value streams (Source-to-Pay, Order-to-Cash, Onboarding-to-Final-Pay) apply identically across all industries. Hospitality is the validated POC.

KEY STATISTICS (cite sources accurately):
- Gartner (June 25, 2025): more than 40% of enterprise agentic AI projects will be cancelled by end of 2027
- McKinsey (June 2025): fewer than 10% of enterprises have scaled agents to tangible value; 80% cite data limitations
- AuditBoard / Pacific AI / McKinsey 2025: 78% of organisations use AI, only 25-36% have formal governance frameworks

TABS IN THIS PLATFORM — point visitors here:
- Live Demo: runs the full 7-step guest journey scenario against real Apaleo data. Starts with availability, ends with revenue reconciliation. Every step produces a real Witness entry.
- Witness Agent: shows the live audit trail. Every entry has the exact clause applied, governance file cited, and real Apaleo IDs. Filter by event category.
- File Manager: shows the live governance files (AGENTS.md, SOP.md, SKILL.md, EXCEPTION.md) for each agent and hotel. Edit one and see the Compliance Guard in action.
- C2MD Studio: generates governance files from a compliance standard reference. Try entering a NIST control and see it translated into operational Markdown.
- Exception Engine: manages active EXCEPTION.md overlays. The Gold loyalty late checkout exception is live here.
- A2A Protocol: shows Agent Cards for all 9 agents and has a Protocol Tester for submitting JSON-RPC tasks.
- Agent Onboarding: shows the 7-phase admission workflow. Submit a test Agent Card via the Protocol Tester.
- Agent Credentials: shows the live W3C VC status, governance hash, and rotation schedule for all agents.
- SOC 2 SD: auto-generates the SOC 2 Type II System Description from live governance files and Witness data.
- A2MD Normaliser: converts existing agent configurations into VDA-MD compatible governance files.
- Journey Map: shows the two-axis governance map — customer journey stages on the vertical axis, shared services on the horizontal. Every agent sits at a specific intersection.

WHAT YOU MUST NOT DO:
- Do not speculate about features not documented above
- Do not compare VDA-MD to specific competitors by name
- Do not generate actual governance files — point to the C2MD Studio or File Manager tab instead
- Do not make up statistics or cite sources not listed above
- Do not claim VDA-MD makes an organisation fully GDPR or EU AI Act compliant — it provides the technical infrastructure through which compliance obligations can be encoded, enforced, monitored, and evidenced
- Do not answer questions unrelated to VDA-MD, AI governance, or the industries it serves
- Do not discuss A-Wrapper execution architecture in depth — that is a separate framework

ALWAYS:
- You are embedded inside the live platform. Direct people to specific tabs, not external URLs:
  "See it live — open the Witness Agent tab above"
  "Try it now in the Live Demo tab"
  "The File Manager tab shows the actual governance files"
  "Open the Agent Credentials tab to see the VC status"
  "The Exception Engine tab has the Gold loyalty exception live right now"
  "The A2A Protocol tab has a Protocol Tester — submit a real JSON-RPC task"
- Keep answers concise — two to four short paragraphs maximum unless the question genuinely requires more depth
- When someone asks how something works, always offer to show them the specific tab where they can see it live
- Be honest about what is the hospitality POC versus what is the general framework capability
- When answering industry applicability questions, confirm the framework is designed for any customer journey, note hospitality is validated, and describe what the journey map would look like for their specific industry`;

// ─── Markdown renderer (no external libraries) ─────────────────────────────────

function renderMarkdown(text) {
  const parts = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Bold: **text**
    const boldMatch = remaining.match(/^([\s\S]*?)\*\*([\s\S]+?)\*\*/);
    // Italic: *text* (not preceded by another *)
    const italicMatch = remaining.match(/^([\s\S]*?)(?<!\*)\*(?!\*)([\s\S]+?)(?<!\*)\*(?!\*)/);
    // Inline code: `text`
    const codeMatch = remaining.match(/^([\s\S]*?)`([^`]+)`/);

    const matches = [
      boldMatch && { type: "bold", match: boldMatch, before: boldMatch[1], inner: boldMatch[2], full: boldMatch[0] },
      italicMatch && { type: "italic", match: italicMatch, before: italicMatch[1], inner: italicMatch[3], full: italicMatch[0] },
      codeMatch && { type: "code", match: codeMatch, before: codeMatch[1], inner: codeMatch[2], full: codeMatch[0] },
    ].filter(Boolean).sort((a, b) => a.before.length - b.before.length);

    if (matches.length === 0) {
      parts.push(<span key={key++}>{remaining}</span>);
      break;
    }

    const first = matches[0];
    if (first.before) parts.push(<span key={key++}>{first.before}</span>);

    if (first.type === "bold") {
      parts.push(<strong key={key++} style={{ fontWeight: 700, color: "#e2e4ea" }}>{first.inner}</strong>);
    } else if (first.type === "italic") {
      parts.push(<em key={key++} style={{ fontStyle: "italic" }}>{first.inner}</em>);
    } else if (first.type === "code") {
      parts.push(
        <code key={key++} style={{
          fontFamily: "'DM Mono', 'Fira Code', monospace",
          fontSize: "0.9em",
          background: "#0a0b0f",
          color: "#60a5fa",
          borderRadius: 3,
          padding: "1px 5px",
        }}>{first.inner}</code>
      );
    }
    remaining = remaining.slice(first.full.length);
  }
  return parts;
}

function MessageText({ text }) {
  const lines = text.split("\n");
  return (
    <div style={{ lineHeight: 1.6 }}>
      {lines.map((line, i) => (
        <div key={i} style={{ minHeight: line === "" ? "0.75em" : undefined }}>
          {renderMarkdown(line)}
        </div>
      ))}
    </div>
  );
}

// ─── Typing indicator ──────────────────────────────────────────────────────────

const typingStyle = `
@keyframes vda-bounce {
  0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
  40% { transform: translateY(-4px); opacity: 1; }
}
`;

function TypingIndicator() {
  return (
    <>
      <style>{typingStyle}</style>
      <div style={{ display: "flex", gap: 4, alignItems: "center", padding: "4px 0" }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 6, height: 6, borderRadius: "50%",
            background: "#6b7280", display: "inline-block",
            animation: `vda-bounce 1.2s ease-in-out infinite`,
            animationDelay: `${i * 0.15}s`,
          }} />
        ))}
      </div>
    </>
  );
}

// ─── Opening message ───────────────────────────────────────────────────────────

const OPENING_MESSAGE = {
  role: "assistant",
  content: "Hi — I'm the VDA-MD framework expert. I know the governance engine, the A2A protocol, the agent onboarding workflow, compliance coverage, and how this applies to different industries. The best part: everything I describe is live in this platform — just ask me where to find it. What would you like to know?",
};

// ─── Chat icon SVG ─────────────────────────────────────────────────────────────

function ChatIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M20 2H4C2.9 2 2 2.9 2 4V22L6 18H20C21.1 18 22 17.1 22 16V4C22 2.9 21.1 2 20 2Z" fill="white"/>
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4L4 12M4 4L12 12" stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round"/>
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M14 8L2 2L5 8L2 14L14 8Z" fill="white"/>
    </svg>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function VdaMdChatbot() {
  const [open, setOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [messages, setMessages] = useState([OPENING_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (open) scrollToBottom();
  }, [messages, loading, open, scrollToBottom]);

  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Mobile: prevent body scroll when panel open
  useEffect(() => {
    if (open && window.innerWidth < 640) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  const handleOpen = () => {
    setOpen(true);
    setHasOpened(true);
  };

  const handleClose = () => setOpen(false);

  const handleClear = () => {
    setMessages([OPENING_MESSAGE]);
    setInput("");
  };

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: "user", content: text };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      // Send last 20 messages (10 turns) to stay within context
      const historyToSend = newMessages.slice(-20);

      const res = await fetch("/api/ai/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1024,
          system: SYSTEM_PROMPT,
          messages: historyToSend,
        }),
      });

      if (!res.ok) throw new Error("API error");

      const data = await res.json();
      const assistantText = data?.content?.[0]?.type === "text"
        ? data.content[0].text
        : null;

      if (!assistantText) throw new Error("Empty response");

      setMessages(prev => [...prev, { role: "assistant", content: assistantText }]);
    } catch {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: "Something went wrong connecting to the knowledge base. Please try again — or explore the platform tabs directly, they show everything live.",
        isError: true,
      }]);
    }

    setLoading(false);
  }, [input, loading, messages]);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isMobile = typeof window !== "undefined" && window.innerWidth < 640;

  return (
    <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 9000, fontFamily: "'DM Sans', sans-serif" }}>

      {/* Chat panel */}
      {open && (
        <div
          ref={panelRef}
          style={{
            position: "fixed",
            bottom: isMobile ? 0 : 92,
            right: isMobile ? 0 : 24,
            width: isMobile ? "100vw" : 380,
            height: isMobile ? "100dvh" : 520,
            background: "#111318",
            border: isMobile ? "none" : "1px solid #1e2130",
            borderRadius: isMobile ? 0 : 12,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.6)",
            zIndex: 9001,
          }}
        >
          {/* Header */}
          <div style={{
            background: "#0d0f14",
            borderBottom: "1px solid #1e2130",
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e4ea" }}>VDA-MD Expert</div>
              <div style={{ fontSize: 11, color: "#6b7280", marginTop: 1 }}>Ask me anything about the framework</div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button
                onClick={handleClear}
                style={{
                  background: "none", border: "1px solid #1e2130", borderRadius: 5,
                  padding: "3px 9px", fontSize: 10, color: "#6b7280", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}
              >
                Clear
              </button>
              <button
                onClick={handleClose}
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
                }}
              >
                <CloseIcon />
              </button>
            </div>
          </div>

          {/* Status line */}
          <div style={{
            padding: "5px 16px",
            fontSize: 11,
            color: "#4b5563",
            background: "#0d0f14",
            borderBottom: "1px solid #1e2130",
            flexShrink: 0,
          }}>
            Powered by Claude · Knows VDA-MD v4.0
          </div>

          {/* Message area */}
          <div style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 12px",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}>
            {messages.map((msg, idx) => {
              const isUser = msg.role === "user";
              return (
                <div key={idx} style={{
                  display: "flex",
                  justifyContent: isUser ? "flex-end" : "flex-start",
                }}>
                  <div style={{
                    maxWidth: isUser ? "80%" : "90%",
                    background: isUser ? "#1e3a5f" : (msg.isError ? "#2d1515" : "#1a1d26"),
                    color: msg.isError ? "#f87171" : "#e2e4ea",
                    borderRadius: isUser ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                    padding: "9px 13px",
                    fontSize: 13,
                  }}>
                    {isUser
                      ? <span>{msg.content}</span>
                      : <MessageText text={msg.content} />
                    }
                  </div>
                </div>
              );
            })}

            {loading && (
              <div style={{ display: "flex", justifyContent: "flex-start" }}>
                <div style={{
                  background: "#1a1d26",
                  borderRadius: "12px 12px 12px 2px",
                  padding: "9px 13px",
                }}>
                  <TypingIndicator />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div style={{
            borderTop: "1px solid #1e2130",
            padding: "10px 12px",
            display: "flex",
            gap: 8,
            alignItems: "flex-end",
            flexShrink: 0,
            background: "#111318",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about the framework…"
              rows={1}
              style={{
                flex: 1,
                background: "#0d0f14",
                border: "1px solid #1e2130",
                borderRadius: 8,
                padding: "8px 11px",
                fontSize: 13,
                color: "#e2e4ea",
                fontFamily: "'DM Sans', sans-serif",
                resize: "none",
                outline: "none",
                lineHeight: 1.5,
                maxHeight: 100,
                overflowY: "auto",
              }}
              onInput={e => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 100) + "px";
              }}
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              style={{
                background: !input.trim() || loading ? "#1e2130" : "#2E5B8A",
                border: "none",
                borderRadius: 6,
                width: 36,
                height: 36,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                cursor: !input.trim() || loading ? "not-allowed" : "pointer",
                flexShrink: 0,
                transition: "background 0.15s",
              }}
              onMouseEnter={e => { if (input.trim() && !loading) e.currentTarget.style.background = "#185FA5"; }}
              onMouseLeave={e => { if (input.trim() && !loading) e.currentTarget.style.background = "#2E5B8A"; }}
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}

      {/* Floating button */}
      <button
        onClick={open ? handleClose : handleOpen}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: open ? "#185FA5" : "#2E5B8A",
          border: "none",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          position: "relative",
          transition: "background 0.15s, transform 0.15s",
          zIndex: 9002,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = "#185FA5"; }}
        onMouseLeave={e => { e.currentTarget.style.background = open ? "#185FA5" : "#2E5B8A"; }}
        aria-label="VDA-MD Expert Chat"
      >
        <ChatIcon />

        {/* Unread dot */}
        {!hasOpened && (
          <span style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#ef4444",
            border: "1.5px solid #111318",
          }} />
        )}
      </button>
    </div>
  );
}

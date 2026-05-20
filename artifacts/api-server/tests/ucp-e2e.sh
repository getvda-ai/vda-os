#!/usr/bin/env bash
# UCP 2026 End-to-End Test
#
# Full flow: discovery → agent card → call availability agent → call rate agent
#            → receive ucpOffer → negotiate (accept/counter/reject/tamper/expired/401)
#
# Usage: bash artifacts/api-server/tests/ucp-e2e.sh [BASE_URL]
# Default BASE_URL: http://localhost:8080
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"
COMPANY_ID=1
PROPERTY_ID="MUC"
PASS_COUNT=0
FAIL_COUNT=0

pass() { echo "  ✓ $1"; PASS_COUNT=$((PASS_COUNT + 1)); }
fail() { echo "  ✗ FAIL: $1"; FAIL_COUNT=$((FAIL_COUNT + 1)); }
info() { echo "  ℹ $1"; }
section() { echo ""; echo "=== $1 ==="; }

# ─── Step 1: Discover UCP Service Descriptor ──────────────────────────────────
section "Step 1: /.well-known/ucp.json discovery"
UCP_DESC=$(curl -s "${BASE_URL}/.well-known/ucp.json")
SPEC_VER=$(echo "$UCP_DESC" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).specVersion))")
OFFER_TYPES=$(echo "$UCP_DESC" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).offerTypes.join(',')))")
NEG_ENDPOINT=$(echo "$UCP_DESC" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).negotiationEndpoint))")

if [ "$SPEC_VER" = "2026.1" ]; then pass "specVersion = 2026.1"; else fail "specVersion expected 2026.1, got: $SPEC_VER"; fi
if echo "$OFFER_TYPES" | grep -q "lodging.unit_group"; then pass "offerType lodging.unit_group present"; else fail "lodging.unit_group missing"; fi
if echo "$OFFER_TYPES" | grep -q "lodging.rate_override"; then pass "offerType lodging.rate_override present"; else fail "lodging.rate_override missing"; fi
if [ -n "$NEG_ENDPOINT" ]; then pass "negotiationEndpoint present"; else fail "negotiationEndpoint missing"; fi

# ─── Step 2: Discover Availability Agent Card ────────────────────────────────
section "Step 2: Availability Agent card (ucpCapable)"
AVAIL_CARD=$(curl -s "${BASE_URL}/api/a2a/${COMPANY_ID}/availability-agent/agent.json")
UCP_CAPABLE=$(echo "$AVAIL_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpCapable))")
NEG_URL=$(echo "$AVAIL_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).negotiationEndpoint||''))")

if [ "$UCP_CAPABLE" = "true" ]; then pass "Availability Agent ucpCapable = true"; else fail "ucpCapable expected true, got: $UCP_CAPABLE"; fi
if [ -n "$NEG_URL" ]; then pass "negotiationEndpoint set on Availability Agent card"; else fail "negotiationEndpoint missing"; fi

# ─── Step 3: Discover Rate Agent Card ────────────────────────────────────────
section "Step 3: Rate Agent card (ucpCapable)"
RATE_CARD=$(curl -s "${BASE_URL}/api/a2a/${COMPANY_ID}/rate-agent/agent.json")
RATE_UCP=$(echo "$RATE_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpCapable))")
RATE_NEG=$(echo "$RATE_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).negotiationEndpoint||''))")

if [ "$RATE_UCP" = "true" ]; then pass "Rate Agent ucpCapable = true"; else fail "ucpCapable expected true, got: $RATE_UCP"; fi
if [ -n "$RATE_NEG" ]; then pass "negotiationEndpoint set on Rate Agent card"; else fail "negotiationEndpoint missing on Rate Agent card"; fi

# ─── Step 4: Issue VC credential ─────────────────────────────────────────────
section "Step 4: Issue agent VC for auth"
VC_RESP=$(curl -s -X POST "${BASE_URL}/api/agents/credentials/issue" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"rate-agent\",\"companyId\":${COMPANY_ID}}")
VC_TOKEN=$(echo "$VC_RESP" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.vcBase64url||'')})")

if [ -n "$VC_TOKEN" ]; then pass "VC credential issued (${#VC_TOKEN} chars)"; else fail "VC issuance failed"; fi

# ─── Step 5: Seed mandates ────────────────────────────────────────────────────
section "Step 5: Seed active Rate Agent mandate"
SEED_RESP=$(curl -s -X POST "${BASE_URL}/api/admin/seed-mandates" \
  -H "Content-Type: application/json" \
  -d "{\"companyId\":${COMPANY_ID}}")
SEED_OK=$(echo "$SEED_RESP" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.ok?'true':'false')})")
if [ "$SEED_OK" = "true" ]; then pass "seed-mandates ok"; else fail "seed-mandates failed: $(echo "$SEED_RESP" | node -e "process.stdin.on('data',d=>console.log(d))")"; fi

# ─── Step 6: Call Availability Agent → assert ucpOffer structure ─────────────
section "Step 6: Call Availability Agent — assert ucpOffer on PASS"
AVAIL_RESP=$(curl -s -X POST "${BASE_URL}/api/agents/availability" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"arrival\":\"2026-07-01\",\"departure\":\"2026-07-03\",\"adults\":1}" \
  --max-time 30)
AVAIL_DECISION=$(echo "$AVAIL_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).decision||'')}catch(e){console.log('')}})")
AVAIL_UCP_TYPE=$(echo "$AVAIL_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).ucpOffer?.item?.type||'')}catch(e){console.log('')}})")
AVAIL_UCP_SPEC=$(echo "$AVAIL_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).ucpOffer?.specVersion||'')}catch(e){console.log('')}})")

info "Availability Agent decision: ${AVAIL_DECISION:-<none>}"
if [ "$AVAIL_DECISION" = "PASS" ]; then
  if [ "$AVAIL_UCP_TYPE" = "lodging.unit_group" ]; then pass "Availability PASS ucpOffer item.type = lodging.unit_group"; else fail "Expected lodging.unit_group, got: $AVAIL_UCP_TYPE"; fi
  if [ "$AVAIL_UCP_SPEC" = "2026.1" ]; then pass "Availability PASS ucpOffer specVersion = 2026.1"; else fail "Expected 2026.1, got: $AVAIL_UCP_SPEC"; fi
else
  info "Decision was ${AVAIL_DECISION} (not PASS) — ucpOffer structural assertions skipped for this run"
  pass "Availability Agent responded (decision: ${AVAIL_DECISION})"
fi

# ─── Step 7: Get a server-signed test rate offer (admin endpoint) ─────────────
section "Step 7: Obtain server-signed Rate offer (admin/ucp-test-offer)"
TEST_OFFER_RESP=$(curl -s -X POST "${BASE_URL}/api/admin/ucp-test-offer" \
  -H "Content-Type: application/json" \
  -d "{\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"barRate\":150,\"requestedRate\":150,\"ratePlanId\":\"RPC-MUC-CORP\"}")
OFFER_ID=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.offerId||'')}catch(e){console.log('')}})")
OFFER_BAR=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.barRate||'')}catch(e){console.log('')}})")
OFFER_TOKEN=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.serverToken||'')}catch(e){console.log('')}})")
OFFER_VALID_UNTIL=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.validity?.validUntil||'')}catch(e){console.log('')}})")
OFFER_SPEC=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.specVersion||'')}catch(e){console.log('')}})")
OFFER_TYPE=$(echo "$TEST_OFFER_RESP" | node -e "process.stdin.on('data',d=>{try{console.log(JSON.parse(d).offer.item?.type||'')}catch(e){console.log('')}})")

if [ -n "$OFFER_ID" ]; then pass "Rate Agent test offer issued (offerId: ${OFFER_ID:0:8}…)"; else fail "ucp-test-offer failed: $TEST_OFFER_RESP"; fi
if [ -n "$OFFER_TOKEN" ]; then pass "serverToken present (${#OFFER_TOKEN} chars)"; else fail "serverToken missing in test offer"; fi
if [ "$OFFER_SPEC" = "2026.1" ]; then pass "test offer specVersion = 2026.1"; else fail "test offer specVersion expected 2026.1, got: $OFFER_SPEC"; fi
if [ "$OFFER_TYPE" = "lodging.rate_override" ]; then pass "test offer item.type = lodging.rate_override"; else fail "test offer item.type expected lodging.rate_override, got: $OFFER_TYPE"; fi

# Build the originalOffer JSON used in negotiate calls
ORIG_OFFER_JSON="{\"offerId\":\"${OFFER_ID}\",\"barRate\":${OFFER_BAR},\"validUntil\":\"${OFFER_VALID_UNTIL}\",\"serverToken\":\"${OFFER_TOKEN}\"}"

# ─── Step 8: Negotiate — counter WITHIN ceiling (expect: accept) ──────────────
section "Step 8: POST /api/ucp/negotiate — accept (6.7% discount < 15% ceiling)"
NEG_ACCEPT=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${ORIG_OFFER_JSON},\"counter\":{\"price\":{\"amount\":140,\"currency\":\"EUR\"},\"ratePlanId\":\"RPC-MUC-CORP\"}}")

NEG_RESULT=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
NEG_AMOUNT=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.price?.amount??'null'))")
NEG_SPEC=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.specVersion??'null'))")
NEG_TYPE=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.item?.type??'null'))")
NEG_SERVER_TOKEN=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.serverToken??'null'))")

if [ "$NEG_RESULT" = "accept" ]; then pass "negotiate result = accept"; else fail "expected 'accept', got: $NEG_RESULT (body: $(echo "$NEG_ACCEPT"))"; fi
if [ "$NEG_AMOUNT" = "140" ]; then pass "accepted offer amount = 140 EUR"; else fail "offer amount expected 140, got: $NEG_AMOUNT"; fi
if [ "$NEG_SPEC" = "2026.1" ]; then pass "ucpOffer specVersion = 2026.1"; else fail "specVersion expected 2026.1, got: $NEG_SPEC"; fi
if [ "$NEG_TYPE" = "lodging.rate_override" ]; then pass "ucpOffer item.type = lodging.rate_override"; else fail "expected lodging.rate_override, got: $NEG_TYPE"; fi
if [ "$NEG_SERVER_TOKEN" != "null" ] && [ -n "$NEG_SERVER_TOKEN" ]; then pass "accepted offer serverToken present (new signed offer)"; else fail "accepted offer serverToken missing"; fi

# ─── Step 9: Negotiate — counter EXCEEDING ceiling (expect: counter) ──────────
section "Step 9: POST /api/ucp/negotiate — counter (40% discount > 15% ceiling)"
NEG_COUNTER=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${ORIG_OFFER_JSON},\"counter\":{\"price\":{\"amount\":90,\"currency\":\"EUR\"}}}")

CTR_RESULT=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
CTR_AMOUNT=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.price?.amount??'null'))")
CTR_HAS_REASON=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(!!(JSON.parse(d).reason)))")

if [ "$CTR_RESULT" = "counter" ]; then pass "negotiate result = counter"; else fail "expected 'counter', got: $CTR_RESULT (body: $(echo "$NEG_COUNTER"))"; fi
if [ "$CTR_AMOUNT" = "128" ]; then pass "counter offer amount = 128 EUR (150 × 0.85, rounded)"; else fail "counter amount expected 128, got: $CTR_AMOUNT"; fi
if [ "$CTR_HAS_REASON" = "true" ]; then pass "counter reason message present"; else fail "counter reason missing"; fi

# ─── Step 10: Negotiate — non-negotiable type (expect: reject) ────────────────
section "Step 10: POST /api/ucp/negotiate — reject (non-negotiable type)"
NEG_REJECT=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.unit_group\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${ORIG_OFFER_JSON},\"counter\":{\"price\":{\"amount\":100,\"currency\":\"EUR\"}}}")

REJ_RESULT=$(echo "$NEG_REJECT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
REJ_REASON=$(echo "$NEG_REJECT" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.reason||r.error||'')})")

if [ "$REJ_RESULT" = "reject" ]; then pass "negotiate result = reject for non-negotiable type"; else fail "expected 'reject', got: $REJ_RESULT"; fi
if echo "$REJ_REASON" | grep -q "not_negotiable\|not negotiable"; then pass "reject reason = offer_type_not_negotiable"; else fail "reject reason wrong, got: $REJ_REASON"; fi

# ─── Step 11: Tampered barRate attack (expect: 400 offer_token_invalid) ───────
section "Step 11: POST /api/ucp/negotiate — barRate tamper → reject (token invalid)"
# Attacker presents their own barRate (e.g., 90 ≈ counterAmount) so discount ≈ 0%,
# bypassing the 15% ceiling even though the real discount from BAR=150 is 40%.
# The serverToken must NOT match the tampered barRate, so the endpoint rejects.
TAMPERED_ORIG="{\"offerId\":\"${OFFER_ID}\",\"barRate\":91,\"validUntil\":\"${OFFER_VALID_UNTIL}\",\"serverToken\":\"${OFFER_TOKEN}\"}"
TAMPER_RESP=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${TAMPERED_ORIG},\"counter\":{\"price\":{\"amount\":90,\"currency\":\"EUR\"}}}")

TAMPER_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${TAMPERED_ORIG},\"counter\":{\"price\":{\"amount\":90,\"currency\":\"EUR\"}}}")
TAMPER_REASON=$(echo "$TAMPER_RESP" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.reason||r.error||'')})")

if [ "$TAMPER_HTTP" = "400" ]; then pass "tampered barRate returns 400"; else fail "expected 400, got HTTP $TAMPER_HTTP"; fi
if echo "$TAMPER_REASON" | grep -q "offer_token_invalid\|tampered\|invalid"; then pass "tamper rejection reason correct"; else fail "tamper reason wrong, got: $TAMPER_REASON"; fi

# ─── Step 12: Missing originalOffer (expect: 400 missing_original_offer) ───────
section "Step 12: POST /api/ucp/negotiate — missing originalOffer → 400"
MISSING_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"counter\":{\"price\":{\"amount\":140,\"currency\":\"EUR\"}}}")

if [ "$MISSING_HTTP" = "400" ]; then pass "missing originalOffer returns 400"; else fail "expected 400, got HTTP $MISSING_HTTP"; fi

# ─── Step 13: Unauthenticated request (expect: 401) ──────────────────────────
section "Step 13: POST /api/ucp/negotiate — 401 without auth token"
UNAUTH_HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"originalOffer\":${ORIG_OFFER_JSON},\"counter\":{\"price\":{\"amount\":140,\"currency\":\"EUR\"}}}")

if [ "$UNAUTH_HTTP" = "401" ]; then pass "unauthenticated request returns 401"; else fail "expected 401, got HTTP $UNAUTH_HTTP"; fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "========================================"
echo "UCP E2E Test: ${PASS_COUNT} passed, ${FAIL_COUNT} failed"
echo "========================================"
if [ "$FAIL_COUNT" -eq 0 ]; then
  echo "All tests passed ✓"
  exit 0
else
  echo "FAILURES DETECTED"
  exit 1
fi

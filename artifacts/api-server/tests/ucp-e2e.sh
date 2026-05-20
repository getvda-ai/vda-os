#!/usr/bin/env bash
# UCP 2026 End-to-End Test
# Covers: discovery → agent card → negotiate (accept) → negotiate (counter) → reject + auth
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

# ─── Step 2: Discover Availability Agent Card (ucpCapable) ────────────────────
section "Step 2: Availability Agent card discovery"
AVAIL_CARD=$(curl -s "${BASE_URL}/api/a2a/${COMPANY_ID}/availability-agent/agent.json")
UCP_CAPABLE=$(echo "$AVAIL_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpCapable))")
NEG_URL=$(echo "$AVAIL_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).negotiationEndpoint||''))")

if [ "$UCP_CAPABLE" = "true" ]; then pass "Availability Agent ucpCapable = true"; else fail "ucpCapable expected true, got: $UCP_CAPABLE"; fi
if [ -n "$NEG_URL" ]; then pass "negotiationEndpoint set on Availability Agent card"; else fail "negotiationEndpoint missing"; fi

# ─── Step 3: Discover Rate Agent Card (ucpCapable) ────────────────────────────
section "Step 3: Rate Agent card discovery"
RATE_CARD=$(curl -s "${BASE_URL}/api/a2a/${COMPANY_ID}/rate-agent/agent.json")
RATE_UCP=$(echo "$RATE_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpCapable))")
RATE_NEG=$(echo "$RATE_CARD" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).negotiationEndpoint||''))")

if [ "$RATE_UCP" = "true" ]; then pass "Rate Agent ucpCapable = true"; else fail "ucpCapable expected true, got: $RATE_UCP"; fi
if [ -n "$RATE_NEG" ]; then pass "negotiationEndpoint set on Rate Agent card"; else fail "negotiationEndpoint missing on Rate Agent card"; fi

# ─── Step 4: Issue VC credential for negotiation auth ─────────────────────────
section "Step 4: Issue agent VC for negotiation auth"
VC_RESP=$(curl -s -X POST "${BASE_URL}/api/agents/credentials/issue" \
  -H "Content-Type: application/json" \
  -d "{\"agentId\":\"rate-agent\",\"companyId\":${COMPANY_ID}}")
VC_TOKEN=$(echo "$VC_RESP" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.vcBase64url||'')})")

if [ -n "$VC_TOKEN" ]; then pass "VC credential issued (${#VC_TOKEN} chars)"; else fail "VC issuance failed"; fi

# ─── Step 5: Ensure active rate-agent mandate exists ──────────────────────────
section "Step 5: Ensure active Rate Agent mandate"
SEED_RESP=$(curl -s -X POST "${BASE_URL}/api/admin/seed-mandates" \
  -H "Content-Type: application/json" \
  -d "{\"companyId\":${COMPANY_ID}}")
SEED_OK=$(echo "$SEED_RESP" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.ok?'true':'false')})")
if [ "$SEED_OK" = "true" ]; then pass "seed-mandates ok"; else fail "seed-mandates failed"; fi

# ─── Step 6: Negotiate — counter WITHIN mandate ceiling (expect: accept) ──────
section "Step 6: POST /api/ucp/negotiate — accept (6.7% discount)"
NEG_ACCEPT=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"counter\":{\"price\":{\"amount\":140,\"currency\":\"EUR\"},\"barRate\":150,\"ratePlanId\":\"RPC-MUC-CORP\"}}")

NEG_RESULT=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
NEG_AMOUNT=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.price?.amount??'null'))")
NEG_SPEC=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.specVersion??'null'))")
NEG_TYPE=$(echo "$NEG_ACCEPT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.item?.type??'null'))")

if [ "$NEG_RESULT" = "accept" ]; then pass "negotiate result = accept"; else fail "expected 'accept', got: $NEG_RESULT"; fi
if [ "$NEG_AMOUNT" = "140" ]; then pass "accepted offer amount = 140 EUR"; else fail "offer amount expected 140, got: $NEG_AMOUNT"; fi
if [ "$NEG_SPEC" = "2026.1" ]; then pass "ucpOffer specVersion = 2026.1"; else fail "specVersion expected 2026.1, got: $NEG_SPEC"; fi
if [ "$NEG_TYPE" = "lodging.rate_override" ]; then pass "ucpOffer item.type = lodging.rate_override"; else fail "expected lodging.rate_override, got: $NEG_TYPE"; fi

# ─── Step 7: Negotiate — counter EXCEEDING ceiling (expect: counter) ──────────
section "Step 7: POST /api/ucp/negotiate — counter (40% discount > 15% ceiling)"
NEG_COUNTER=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"counter\":{\"price\":{\"amount\":90,\"currency\":\"EUR\"},\"barRate\":150}}")

CTR_RESULT=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
CTR_AMOUNT=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).ucpOffer?.price?.amount??'null'))")
CTR_HAS_REASON=$(echo "$NEG_COUNTER" | node -e "process.stdin.on('data',d=>console.log(!!(JSON.parse(d).reason)))")

if [ "$CTR_RESULT" = "counter" ]; then pass "negotiate result = counter"; else fail "expected 'counter', got: $CTR_RESULT"; fi
if [ "$CTR_AMOUNT" = "128" ]; then pass "counter offer amount = 128 EUR (150 * 0.85, rounded)"; else fail "counter amount expected 128, got: $CTR_AMOUNT"; fi
if [ "$CTR_HAS_REASON" = "true" ]; then pass "counter reason message present"; else fail "counter reason missing"; fi

# ─── Step 8: Negotiate — non-negotiable offer type (expect: reject) ───────────
section "Step 8: POST /api/ucp/negotiate — reject (non-negotiable type)"
NEG_REJECT=$(curl -s -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${VC_TOKEN}" \
  -d "{\"offerType\":\"lodging.unit_group\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"counter\":{\"price\":{\"amount\":100,\"currency\":\"EUR\"},\"barRate\":150}}")

REJ_RESULT=$(echo "$NEG_REJECT" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d).result))")
REJ_REASON=$(echo "$NEG_REJECT" | node -e "process.stdin.on('data',d=>{const r=JSON.parse(d); console.log(r.reason||r.error||'')})")

if [ "$REJ_RESULT" = "reject" ]; then pass "negotiate result = reject for non-negotiable type"; else fail "expected 'reject', got: $REJ_RESULT"; fi
if echo "$REJ_REASON" | grep -q "not_negotiable\|not negotiable"; then pass "reject reason = offer_type_not_negotiable"; else fail "reject reason wrong, got: $REJ_REASON"; fi

# ─── Step 9: Negotiate — unauthenticated request (expect: 401) ───────────────
section "Step 9: POST /api/ucp/negotiate — 401 without auth token"
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${BASE_URL}/api/ucp/negotiate" \
  -H "Content-Type: application/json" \
  -d "{\"offerType\":\"lodging.rate_override\",\"companyId\":${COMPANY_ID},\"propertyId\":\"${PROPERTY_ID}\",\"counter\":{\"price\":{\"amount\":140,\"currency\":\"EUR\"},\"barRate\":150}}")

if [ "$HTTP_STATUS" = "401" ]; then pass "unauthenticated request returns 401"; else fail "expected 401, got HTTP $HTTP_STATUS"; fi

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

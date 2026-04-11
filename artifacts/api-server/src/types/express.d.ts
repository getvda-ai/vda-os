declare namespace Express {
  interface Request {
    vcVerified?: boolean;
    vcPayload?: import("../lib/agentCredentialIssuer.js").VerificationResult | null;
  }
}

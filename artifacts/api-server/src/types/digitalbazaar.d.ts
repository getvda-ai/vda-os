declare module "@digitalbazaar/ed25519-signature-2020" {
  export class Ed25519Signature2020 {
    static readonly CONTEXT_URL: string;
    static readonly CONTEXT: Record<string, unknown>;
    constructor(options?: { key?: unknown; date?: string });
  }
}

declare module "@digitalbazaar/ed25519-verification-key-2020" {
  export class Ed25519VerificationKey2020 {
    id: string;
    controller: string;
    static generate(): Promise<Ed25519VerificationKey2020>;
    static from(options: Record<string, unknown>): Promise<Ed25519VerificationKey2020>;
    fingerprint(): string;
    export(options: { publicKey?: boolean; privateKey?: boolean }): Promise<Record<string, unknown>>;
    signer(): unknown;
    verifier(): unknown;
  }
}

declare module "@digitalbazaar/vc" {
  export function issue(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: (url: string) => Promise<{ document: Record<string, unknown> }>;
  }): Promise<Record<string, unknown>>;

  export function verifyCredential(options: {
    credential: Record<string, unknown>;
    suite: unknown;
    documentLoader: (url: string) => Promise<{ document: Record<string, unknown> }>;
  }): Promise<{ verified: boolean; error?: unknown }>;
}

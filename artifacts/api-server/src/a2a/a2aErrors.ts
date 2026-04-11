export const A2A_ERRORS = {
  PARSE_ERROR:            { code: -32700, message: "Parse error" },
  INVALID_REQUEST:        { code: -32600, message: "Invalid request" },
  METHOD_NOT_FOUND:       { code: -32601, message: "Method not found" },
  INVALID_PARAMS:         { code: -32602, message: "Invalid params" },
  AUTH_REQUIRED:          { code: -32001, message: "Authentication required: present a W3C Verifiable Credential as Bearer token" },
  AGENT_ESCALATION:       { code: -32002, message: "Agent escalation required: human approval needed" },
  TASK_NOT_FOUND:         { code: -32003, message: "Task not found" },
  TASK_ALREADY_CANCELLED: { code: -32004, message: "Task already cancelled" },
  GOVERNANCE_VIOLATION:   { code: -32005, message: "Governance envelope violation: §2.1 mandatory governance files missing" },
} as const;

export type A2AErrorCode = (typeof A2A_ERRORS)[keyof typeof A2A_ERRORS]["code"];

export function jsonRpcError(
  id: string | number | null,
  error: { code: number; message: string },
  detail?: string
) {
  return {
    jsonrpc: "2.0" as const,
    id,
    error: {
      code: error.code,
      message: detail ? `${error.message}: ${detail}` : error.message,
    },
  };
}

export function jsonRpcResult(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}

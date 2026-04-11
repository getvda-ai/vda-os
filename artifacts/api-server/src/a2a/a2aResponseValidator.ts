import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const a2aTaskResponseSchema = {
  type: "object",
  required: ["id", "status"],
  properties: {
    id: { type: "string" },
    sessionId: { type: "string" },
    status: {
      type: "object",
      required: ["state"],
      properties: {
        state: {
          type: "string",
          enum: ["submitted", "working", "completed", "failed", "cancelled"],
        },
      },
      additionalProperties: true,
    },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        required: ["parts"],
        properties: {
          parts: {
            type: "array",
            items: {
              type: "object",
              required: ["type"],
              properties: {
                type: { type: "string" },
                text: { type: "string" },
              },
              additionalProperties: true,
            },
          },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
};

export const validateA2ATaskResponse = ajv.compile(a2aTaskResponseSchema);

export function getA2AValidationErrors(): string {
  return ajv.errorsText(validateA2ATaskResponse.errors);
}

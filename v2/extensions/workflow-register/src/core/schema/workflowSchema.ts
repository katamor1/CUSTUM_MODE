const transitionConditionSchema = {
  type: "object",
  required: ["stateKey"],
  properties: {
    stateKey: { type: "string", minLength: 1 },
    equals: {},
    notEquals: {},
    "in": { type: "array" },
    exists: { type: "boolean" },
    truthy: { type: "boolean" }
  },
  additionalProperties: false
} as const

const transitionSchema = {
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "when", "goto"],
        properties: {
          id: { type: "string", minLength: 1 },
          when: transitionConditionSchema,
          goto: { type: "string", minLength: 1 },
          loop: { type: "string", minLength: 1 }
        },
        additionalProperties: false
      }
    },
    default: { type: "string", minLength: 1 }
  },
  additionalProperties: false
} as const

const manualFormSchema = {
  type: "object",
  required: ["resultKey"],
  properties: {
    resultKey: { type: "string", minLength: 1 },
    fields: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "type"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string" },
          type: { enum: ["string", "number", "boolean", "select"] },
          required: { type: "boolean" },
          multiline: { type: "boolean" },
          options: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const

const manualApprovalSchema = {
  type: "object",
  required: ["resultKey"],
  properties: {
    resultKey: { type: "string", minLength: 1 },
    approveLabel: { type: "string" },
    rejectLabel: { type: "string" },
    message: { type: "string" }
  },
  additionalProperties: false
} as const

const userActionSchema = {
  type: "object",
  properties: {
    message: { type: "string" },
    completeLabel: { type: "string" },
    confirmOnComplete: { type: "boolean" },
    confirmMessage: { type: "string" }
  },
  additionalProperties: false
} as const

const branchingSchema = {
  type: "object",
  properties: {
    enabled: { type: "boolean" },
    loops: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "entryStep"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string" },
          entryStep: { type: "string", minLength: 1 },
          maxIterations: { type: "number" },
          extensionSize: { type: "number" },
          checkpoint: {
            type: "object",
            properties: {
              title: { type: "string" },
              message: { type: "string" }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false
      }
    }
  },
  additionalProperties: false
} as const

export const workflowV1Schema = {
  type: "object",
  required: ["name", "description"],
  properties: {
    schemaVersion: { const: "workflow-register/v1" },
    id: { type: "string" },
    name: { type: "string", minLength: 1, pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" },
    description: { type: "string", minLength: 1 },
    title: { type: "string" },
    label: { type: "string" },
    menuLabel: { type: "string" },
    mode: { type: "string" },
    category: { type: "string" },
    todo: { type: "boolean" },
    todoRequired: { type: "boolean" },
    todoAsSteps: { type: "boolean" },
    stepCompletion: { enum: ["auto", "manual"] },
    stepMessage: { enum: ["full", "current", "silent", "step"] },
    stepExecution: {
      type: "object",
      properties: {
        mode: { enum: ["full", "todo", "engineSteps"] },
        allowOutOfOrder: { type: "boolean" },
        showInBob: { type: "boolean" }
      },
      additionalProperties: false
    },
    stepReview: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        pauseAfter: { enum: ["everyStep", "agentAndCommand", "none"] },
        requireAcceptBeforeNext: { type: "boolean" },
        allowRetry: { type: "boolean" },
        allowEditBeforeRetry: { type: "boolean" },
        preserveAttempts: { type: "boolean" }
      },
      additionalProperties: false
    },
    branching: branchingSchema,
    autoApproval: { type: "boolean" },
    workspaceRequired: { type: "boolean" },
    hidden: { type: "boolean" },
    prompt: { type: "string" },
    command: { type: "string" },
    commandArgs: { type: "array" },
    todos: {
      type: "array",
      items: {
        anyOf: [
          { type: "string" },
          { type: "object", minProperties: 1, maxProperties: 1, additionalProperties: { type: "string" } }
        ]
      }
    },
    permissions: { type: "array", items: { type: "string" } },
    requires: {
      type: "object",
      properties: {
        workspace: { type: "boolean" },
        bob: { type: "object", properties: { minVersion: { type: "string" } }, additionalProperties: false },
        files: { type: "array", items: { type: "string" } }
      },
      additionalProperties: false
    },
    inputs: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["type"],
        properties: {
          type: { enum: ["string", "number", "boolean", "select"] },
          title: { type: "string" },
          required: { type: "boolean" },
          requiredWhen: { type: "string" },
          prompt: { type: "boolean" },
          default: {},
          options: { type: "array", items: { type: "string" } }
        },
        additionalProperties: false
      }
    },
    preflight: {
      type: "array",
      items: {
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string" },
          required: { type: "boolean" },
          checks: { type: "array", items: { type: "string" } },
          files: { type: "array", items: { type: "string" } },
          failurePolicy: { enum: ["stop", "continue", "warn"] }
        },
        additionalProperties: false
      }
    },
    tools: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          purpose: { type: "string" },
          required: { type: "boolean" },
          outputKey: { type: "string" },
          inputSource: { type: "string" },
          failurePolicy: { enum: ["stop", "continue", "warn"] }
        },
        additionalProperties: false
      }
    },
    guardrails: {
      type: "object",
      properties: {
        allowedCommands: { type: "array", items: { type: "string" } },
        deniedCommands: { type: "array", items: { type: "string" } },
        allowedCommandIds: { type: "array", items: { type: "string" } },
        deniedCommandIds: { type: "array", items: { type: "string" } },
        requireApproval: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, when: { type: "string" }, message: { type: "string" } },
            additionalProperties: false
          }
        }
      },
      additionalProperties: false
    },
    artifacts: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "path"],
        properties: { id: { type: "string", minLength: 1 }, producedBy: { type: "string" }, path: { type: "string", minLength: 1 }, schema: { type: "string" } },
        additionalProperties: false
      }
    },
    completion: {
      type: "object",
      properties: {
        summary: { type: "string" },
        includeArtifacts: { type: "boolean" },
        validateResult: { type: "boolean" },
        visualization: { type: "object", properties: { type: { type: "string" }, enabled: { type: "boolean" } }, additionalProperties: false }
      },
      additionalProperties: false
    },
    steps: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "title", "type"],
        properties: {
          id: { type: "string", minLength: 1 },
          title: { type: "string", minLength: 1 },
          type: { enum: ["command", "agent", "manual", "result"] },
          required: { type: "boolean" },
          action: { type: "object", required: ["provider"], properties: { provider: { type: "string", minLength: 1 }, args: {} }, additionalProperties: false },
          prompt: { type: "string" },
          sendResult: { type: "boolean" },
          completeOnSuccess: { type: "boolean" },
          includeState: { type: "array", items: { type: "string" } },
          maxResultBytes: { type: "number" },
          stateRequired: { type: "boolean" },
          resultKey: { type: "string" },
          transition: transitionSchema,
          userAction: userActionSchema,
          form: manualFormSchema,
          approval: manualApprovalSchema,
          result: {
            type: "object",
            required: ["source", "sinks"],
            properties: {
              source: { enum: ["state", "literal", "agent"] },
              stateKey: { type: "string" },
              text: { type: "string" },
              sinks: { type: "array", items: { type: "object", required: ["type"], properties: { type: { enum: ["command", "file"] }, command: { type: "string" }, args: { type: "array" }, path: { type: "string" }, encoding: { type: "string" } }, additionalProperties: false } }
            },
            additionalProperties: false
          }
        },
        additionalProperties: false,
        allOf: [
          { if: { properties: { type: { const: "command" } }, required: ["type"] }, then: { required: ["action"] } },
          { if: { properties: { type: { const: "result" } }, required: ["type"] }, then: { required: ["result"] } }
        ]
      }
    }
  },
  additionalProperties: true
} as const

export const knownWorkflowV1TopLevelFields = new Set(Object.keys(workflowV1Schema.properties))

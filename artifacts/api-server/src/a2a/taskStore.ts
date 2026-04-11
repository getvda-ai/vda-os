import { db, a2aTasks, type A2ATask } from "@workspace/db";
import { eq, and, desc, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export type TaskStatus = "submitted" | "working" | "completed" | "failed" | "cancelled";

export interface A2AMessage {
  role: "user" | "agent";
  parts: Array<{ type: "text"; text: string }>;
}

export interface A2AArtifact {
  index: number;
  parts: Array<{ type: "text"; text: string }>;
  lastChunk: boolean;
}

export interface A2ATaskRecord {
  id: string;
  sessionId: string;
  companyId: number;
  agentId: string;
  status: { state: TaskStatus };
  message: A2AMessage;
  artifacts: A2AArtifact[];
  errorMessage: string | null;
  externalAgentDid: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRecord(row: A2ATask): A2ATaskRecord {
  return {
    id: row.id,
    sessionId: row.sessionId,
    companyId: row.companyId,
    agentId: row.agentId,
    status: { state: row.statusState as TaskStatus },
    message: row.inputMessage as A2AMessage,
    artifacts: (row.outputArtifacts as A2AArtifact[]) ?? [],
    errorMessage: row.errorMessage ?? null,
    externalAgentDid: row.externalAgentDid ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function createTask(
  companyId: number,
  agentId: string,
  sessionId: string,
  inputMessage: A2AMessage,
  externalAgentDid?: string | null
): Promise<A2ATaskRecord> {
  const id = randomUUID();
  const now = new Date();
  const [row] = await db
    .insert(a2aTasks)
    .values({
      id,
      sessionId,
      companyId,
      agentId,
      statusState: "submitted",
      inputMessage: inputMessage as unknown as Record<string, unknown>,
      outputArtifacts: [] as unknown as Record<string, unknown>,
      externalAgentDid: externalAgentDid ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return toRecord(row);
}

export async function getTask(taskId: string): Promise<A2ATaskRecord | null> {
  const rows = await db.select().from(a2aTasks).where(eq(a2aTasks.id, taskId)).limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function updateTask(
  taskId: string,
  updates: {
    statusState?: TaskStatus;
    outputArtifacts?: A2AArtifact[];
    errorMessage?: string | null;
  }
): Promise<A2ATaskRecord> {
  const [row] = await db
    .update(a2aTasks)
    .set({
      ...(updates.statusState !== undefined && { statusState: updates.statusState }),
      ...(updates.outputArtifacts !== undefined && { outputArtifacts: updates.outputArtifacts as unknown as Record<string, unknown> }),
      ...(updates.errorMessage !== undefined && { errorMessage: updates.errorMessage }),
      updatedAt: new Date(),
    })
    .where(eq(a2aTasks.id, taskId))
    .returning();
  return toRecord(row);
}

export async function cancelTask(taskId: string): Promise<A2ATaskRecord | null> {
  const existing = await getTask(taskId);
  if (!existing) return null;
  if (existing.status.state === "cancelled") return existing;
  return updateTask(taskId, { statusState: "cancelled" });
}

export async function listTasksForCompany(
  companyId: number,
  limit = 50
): Promise<A2ATaskRecord[]> {
  const rows = await db
    .select()
    .from(a2aTasks)
    .where(eq(a2aTasks.companyId, companyId))
    .orderBy(desc(a2aTasks.createdAt))
    .limit(limit);
  return rows.map(toRecord);
}

export async function listTasksForSession(
  companyId: number,
  agentId: string,
  sessionId: string
): Promise<A2ATaskRecord[]> {
  const rows = await db
    .select()
    .from(a2aTasks)
    .where(
      and(
        eq(a2aTasks.companyId, companyId),
        eq(a2aTasks.agentId, agentId),
        eq(a2aTasks.sessionId, sessionId)
      )
    )
    .orderBy(a2aTasks.createdAt);
  return rows.map(toRecord);
}

export async function isNewSession(
  companyId: number,
  agentId: string,
  sessionId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: a2aTasks.id })
    .from(a2aTasks)
    .where(
      and(
        eq(a2aTasks.companyId, companyId),
        eq(a2aTasks.agentId, agentId),
        eq(a2aTasks.sessionId, sessionId)
      )
    )
    .limit(1);
  return rows.length === 0;
}

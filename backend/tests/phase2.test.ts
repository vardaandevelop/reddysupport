import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { execFileSync } from "node:child_process";
import { createApp } from "../src/app.js";
import { prisma } from "../src/config/database.js";
import { hashPassword } from "../src/services/password.service.js";

const app = createApp();

beforeAll(async () => {
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], { stdio: "ignore", env: process.env });
  } catch {
    throw new Error("Test PostgreSQL unavailable. Start docker-compose.test.yml");
  }
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.auditLog.deleteMany(), prisma.attachment.deleteMany(), prisma.message.deleteMany(),
    prisma.conversationAssignment.deleteMany(), prisma.customerStatusHistory.deleteMany(),
    prisma.customerNote.deleteMany(), prisma.customerSession.deleteMany(), prisma.conversation.deleteMany(),
    prisma.customer.deleteMany(), prisma.managementSession.deleteMany(), prisma.staffQueueAccess.deleteMany(),
    prisma.userPermission.deleteMany(), prisma.rolePermission.deleteMany(), prisma.user.deleteMany(),
    prisma.quickAction.deleteMany(), prisma.permission.deleteMany(), prisma.settings.deleteMany(),
  ]);
  await prisma.settings.create({ data: { id: 1, welcomeMessage: "Welcome", newClientEvaluationDays: 20 } });
});

async function superAdmin() {
  const user = await prisma.user.create({
    data: { name: "Root", username: "root", passwordHash: await hashPassword("correct-password"), role: "SUPER_ADMIN" },
  });
  const agent = request.agent(app);
  await agent.post("/api/auth/login").send({ username: "root", password: "correct-password" }).expect(200);
  return { agent, user };
}

async function recurringStaff() {
  const user = await prisma.user.create({
    data: { name: "Rec Staff", username: "recstaff", passwordHash: await hashPassword("correct-password"), role: "STAFF" },
  });
  await prisma.staffQueueAccess.create({ data: { userId: user.id, queue: "RECURRING_CLIENTS" } });
  return user;
}

const send = (agent: ReturnType<typeof request.agent>, conversationId: string, clientMessageId: string, text: string) =>
  agent.post(`/api/conversations/${conversationId}/messages`).send({ text, messageType: "TEXT", clientMessageId });

describe("Phase 2 — messaging", () => {
  it("stores one message per clientMessageId (idempotent retry)", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const conversationId = session.body.conversation.id;
    const first = await send(customer, conversationId, "cm-1", "Hello").expect(201);
    const retry = await send(customer, conversationId, "cm-1", "Hello").expect(200);
    expect(retry.body.id).toBe(first.body.id);
    expect(await prisma.message.count({ where: { conversationId, messageType: "TEXT" } })).toBe(1);
  });

  it("derives the sender from the session and returns server ids", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const message = await send(customer, session.body.conversation.id, "cm-2", "Mine").expect(201);
    expect(message.body.senderType).toBe("CUSTOMER");
    expect(message.body.senderId).toBe(session.body.customer.id);
    expect(message.body.id).toMatch(/[0-9a-f-]{36}/);
  });

  it("persists read receipts for inbound messages only", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const conversationId = session.body.conversation.id;
    await send(customer, conversationId, "cm-3", "Question").expect(201);
    const { agent: admin } = await superAdmin();
    await admin.post(`/api/conversations/${conversationId}/messages/read`).send({}).expect(204);
    const readCustomerMessages = await prisma.message.count({ where: { conversationId, senderType: "CUSTOMER", readAt: { not: null } } });
    expect(readCustomerMessages).toBe(1);
  });

  it("blocks foreign conversation access", async () => {
    const a = request.agent(app);
    const b = request.agent(app);
    await a.post("/api/customer/session").send({}).expect(201);
    const other = await b.post("/api/customer/session").send({}).expect(201);
    await send(a, other.body.conversation.id, "cm-4", "Nope").expect(403);
  });
});

describe("Phase 2 — conversion and sessions", () => {
  it("keeps the same customer, conversation and history, and upgrades the live session", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const customerId = session.body.customer.id;
    const conversationId = session.body.conversation.id;
    await send(customer, conversationId, "cm-5", "Before conversion").expect(201);

    const { agent: admin, user: admin_ } = await superAdmin();
    const staff = await recurringStaff();
    const result = await admin
      .post(`/api/customers/${customerId}/convert`)
      .send({ username: "client_one", password: "a-strong-password", assignedStaffId: staff.id })
      .expect(200);

    expect(result.body.customer.id).toBe(customerId);
    expect(result.body.conversation.id).toBe(conversationId);
    expect(result.body.customer.clientType).toBe("RECURRING");
    expect(await prisma.message.count({ where: { conversationId } })).toBe(2);

    // The live temporary session silently became authenticated — no re-login.
    const me = await customer.get("/api/customer/auth/me").expect(200);
    expect(me.body.customer.id).toBe(customerId);
    const sessions = await prisma.customerSession.findMany({ where: { customerId } });
    expect(sessions.every((row) => row.sessionType === "AUTHENTICATED")).toBe(true);

    // Never stores or returns the plaintext password.
    const stored = await prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(stored.passwordHash).not.toBe("a-strong-password");
    expect(stored.passwordHash?.startsWith("$argon2id$")).toBe(true);
    expect(JSON.stringify(result.body)).not.toContain("passwordHash");

    // History + audit trail
    expect(await prisma.customerStatusHistory.count({ where: { customerId, newType: "RECURRING" } })).toBe(1);
    expect(await prisma.conversationAssignment.count({ where: { conversationId, toStaffId: staff.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "CUSTOMER_CONVERTED", actorId: admin_.id } })).toBe(1);
  });

  it("lets the converted client log in from another device and keeps full history", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    await send(customer, session.body.conversation.id, "cm-6", "Old message").expect(201);
    const { agent: admin } = await superAdmin();
    const staff = await recurringStaff();
    await admin
      .post(`/api/customers/${session.body.customer.id}/convert`)
      .send({ username: "client_two", password: "a-strong-password", assignedStaffId: staff.id })
      .expect(200);

    const otherDevice = request.agent(app);
    const login = await otherDevice
      .post("/api/customer/auth/login")
      .send({ username: "client_two", password: "a-strong-password" })
      .expect(200);
    expect(login.body.customer.id).toBe(session.body.customer.id);
    expect(login.body.conversation.id).toBe(session.body.conversation.id);
    const history = await otherDevice.get(`/api/conversations/${session.body.conversation.id}/messages`).expect(200);
    expect(history.body.length).toBe(2);

    // Two live devices at once.
    const active = await prisma.customerSession.count({
      where: { customerId: session.body.customer.id, revokedAt: null },
    });
    expect(active).toBe(2);
  });

  it("rejects a wrong password and a blocked customer", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const { agent: admin } = await superAdmin();
    const staff = await recurringStaff();
    await admin
      .post(`/api/customers/${session.body.customer.id}/convert`)
      .send({ username: "client_three", password: "a-strong-password", assignedStaffId: staff.id })
      .expect(200);

    await request(app)
      .post("/api/customer/auth/login")
      .send({ username: "client_three", password: "wrong-password" })
      .expect(401);

    await admin.post(`/api/customers/${session.body.customer.id}/block`).expect(200);
    await request(app)
      .post("/api/customer/auth/login")
      .send({ username: "client_three", password: "a-strong-password" })
      .expect(403);
    expect(await prisma.customerSession.count({ where: { customerId: session.body.customer.id, revokedAt: null } })).toBe(0);
  });

  it("refuses conversion twice and refuses a staff member without the recurring queue", async () => {
    const customer = request.agent(app);
    const session = await customer.post("/api/customer/session").send({}).expect(201);
    const { agent: admin } = await superAdmin();
    const wrongQueueStaff = await prisma.user.create({
      data: { name: "New only", username: "newonly", passwordHash: await hashPassword("correct-password"), role: "STAFF" },
    });
    await prisma.staffQueueAccess.create({ data: { userId: wrongQueueStaff.id, queue: "NEW_CLIENTS" } });

    await admin
      .post(`/api/customers/${session.body.customer.id}/convert`)
      .send({ username: "client_four", password: "a-strong-password", assignedStaffId: wrongQueueStaff.id })
      .expect(422);
    // Rolled back: still a NEW customer with no username.
    const untouched = await prisma.customer.findUniqueOrThrow({ where: { id: session.body.customer.id } });
    expect(untouched.clientType).toBe("NEW");
    expect(untouched.username).toBeNull();

    const staff = await recurringStaff();
    await admin
      .post(`/api/customers/${session.body.customer.id}/convert`)
      .send({ username: "client_four", password: "a-strong-password", assignedStaffId: staff.id })
      .expect(200);
    await admin
      .post(`/api/customers/${session.body.customer.id}/convert`)
      .send({ username: "client_five", password: "a-strong-password", assignedStaffId: staff.id })
      .expect(409);
  });

  it("lists and revokes customer device sessions", async () => {
    const customer = request.agent(app);
    await customer.post("/api/customer/session").send({ device: "Pixel" }).expect(201);
    const list = await customer.get("/api/customers/sessions").expect(200);
    expect(list.body.length).toBe(1);
    await customer.post(`/api/customers/sessions/${list.body[0].id}/revoke`).expect(204);
    const after = await customer.get("/api/customers/sessions").expect(200);
    expect(after.body.length).toBe(0);
  });
});

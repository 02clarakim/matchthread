import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";

interface FakeSession {
  user: { id: string };
}

const sessionState: { current: FakeSession | null } = { current: null };

vi.mock("@/auth", () => ({
  auth: () => Promise.resolve(sessionState.current),
}));

const { GET, POST } = await import("@/app/api/user/favorite-teams/route");
const { DELETE } = await import("@/app/api/user/favorite-teams/[teamId]/route");

function jsonRequest(body: unknown) {
  return new Request("http://test/api/user/favorite-teams", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("favorite-teams API (real Postgres, mocked session)", () => {
  const suffix = randomUUID();
  let userA: { id: string };
  let userB: { id: string };
  let team: { id: string };

  beforeAll(async () => {
    userA = await prisma.user.create({ data: { email: `a-${suffix}@test.com`, passwordHash: "x" } });
    userB = await prisma.user.create({ data: { email: `b-${suffix}@test.com`, passwordHash: "x" } });
    team = await prisma.team.create({ data: { externalId: `test-team-${suffix}`, name: "Test Team" } });
  });

  afterAll(async () => {
    await prisma.userFavoriteTeam.deleteMany({ where: { teamId: team.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } });
  });

  it("GET is unauthorized when there is no session", async () => {
    sessionState.current = null;
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("POST rejects a missing teamId", async () => {
    sessionState.current = { user: { id: userA.id } };
    const res = await POST(jsonRequest({}));
    expect(res.status).toBe(400);
  });

  it("POST 404s for a team that does not exist", async () => {
    sessionState.current = { user: { id: userA.id } };
    const res = await POST(jsonRequest({ teamId: "does-not-exist" }));
    expect(res.status).toBe(404);
  });

  it("POST adds the team to the authenticated user's favorites", async () => {
    sessionState.current = { user: { id: userA.id } };
    const postRes = await POST(jsonRequest({ teamId: team.id }));
    expect(postRes.status).toBe(201);

    const listRes = await GET();
    const body = await listRes.json();
    expect(body.teams.map((t: { id: string }) => t.id)).toContain(team.id);
  });

  it("a user can never remove another user's favorite via DELETE", async () => {
    // userB independently favorites the same team
    await prisma.userFavoriteTeam.create({ data: { userId: userB.id, teamId: team.id } });

    // userB deletes — this must only ever be able to affect userB's own row,
    // regardless of what teamId is in the URL, because the query is scoped
    // to the session's own userId server-side (never a client-supplied id).
    sessionState.current = { user: { id: userB.id } };
    const res = await DELETE(new Request("http://test"), { params: Promise.resolve({ teamId: team.id }) });
    expect(res.status).toBe(204);

    const userAsFavorite = await prisma.userFavoriteTeam.findUnique({
      where: { userId_teamId: { userId: userA.id, teamId: team.id } },
    });
    expect(userAsFavorite).not.toBeNull();

    const userBsFavorite = await prisma.userFavoriteTeam.findUnique({
      where: { userId_teamId: { userId: userB.id, teamId: team.id } },
    });
    expect(userBsFavorite).toBeNull();
  });
});

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store"
    }
  });
}

async function bodyJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function makeId() {
  return crypto.randomUUID();
}

function roomCode() {
  const values = new Uint8Array(5);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 24);
}

function cleanCode(code) {
  return String(code || "").trim().toUpperCase();
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function publicRoom(room, viewerId) {
  const viewer = room.players.find((player) => player.id === viewerId);
  return {
    code: room.code,
    hostId: room.hostId,
    viewerId,
    phase: room.phase,
    round: room.round,
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
      isHost: player.id === room.hostId,
      isYou: player.id === viewerId,
      hasVoted: Boolean(room.votes[player.id]),
      revealedCard: room.phase === "results" ? player.card : null,
      revealedIsJoker: room.phase === "results" ? player.isJoker : false
    })),
    me: viewer ? {
      id: viewer.id,
      name: viewer.name,
      alive: viewer.alive,
      card: viewer.card,
      isJoker: viewer.isJoker,
      targetIds: viewer.targetIds
    } : null,
    votes: room.phase === "results" ? room.votes : {},
    log: room.log.slice(-8)
  };
}

function deal(room) {
  const players = room.players;
  if (players.length < 3) throw new Error("You need at least 3 players.");

  const jokerIndex = crypto.getRandomValues(new Uint32Array(1))[0] % players.length;
  const joker = players[jokerIndex];
  const possibleTargets = players.filter((player) => player.id !== joker.id);
  const targetCount = Math.min(2, Math.max(1, Math.floor(players.length / 3)));
  const targets = shuffle(possibleTargets).slice(0, targetCount);

  room.phase = "playing";
  room.round += 1;
  room.votes = {};
  room.log = [`Round ${room.round} started. Cards are secret.`];

  players.forEach((player) => {
    player.alive = true;
    player.isJoker = player.id === joker.id;
    player.targetIds = player.isJoker ? targets.map((target) => target.id) : [];
    player.card = player.isJoker
      ? "JOKER"
      : targets.some((target) => target.id === player.id)
        ? "TARGET"
        : "PLAYER";
  });
}

function makeRoom(code, hostName) {
  const playerId = makeId();
  return {
    playerId,
    room: {
      code,
      hostId: playerId,
      phase: "lobby",
      round: 0,
      players: [{
        id: playerId,
        name: hostName,
        alive: true,
        card: null,
        isJoker: false,
        targetIds: []
      }],
      votes: {},
      log: []
    }
  };
}

async function roomRequest(env, code, path, init = {}) {
  const id = env.ROOMS.idFromName(code);
  const stub = env.ROOMS.get(id);
  return stub.fetch(new Request(`https://room.local${path}`, init));
}

async function handleApi(request, env) {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/api/create") {
    const body = await bodyJson(request);
    const name = cleanName(body.name);
    if (!name) return json({ error: "Enter your name." }, 400);

    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = roomCode();
      const response = await roomRequest(env, code, "/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, code })
      });
      if (response.ok) return response;
    }

    return json({ error: "Could not create a room. Try again." }, 500);
  }

  if (request.method === "GET" && url.pathname === "/api/room") {
    const code = cleanCode(url.searchParams.get("code"));
    const playerId = String(url.searchParams.get("playerId") || "");
    if (!code) return json({ error: "Room not found." }, 404);
    return roomRequest(env, code, `/room?playerId=${encodeURIComponent(playerId)}`, { method: "GET" });
  }

  if (request.method === "POST") {
    const body = await bodyJson(request);
    const code = cleanCode(body.code);
    if (!code) return json({ error: "Room not found." }, 404);
    const path = url.pathname.replace("/api", "");
    return roomRequest(env, code, path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  return json({ error: "Not found." }, 404);
}

export class RoomObject {
  constructor(state) {
    this.state = state;
    this.room = null;
  }

  async loadRoom() {
    if (!this.room) this.room = await this.state.storage.get("room");
    return this.room;
  }

  async saveRoom() {
    await this.state.storage.put("room", this.room);
  }

  async fetch(request) {
    try {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await bodyJson(request) : {};

      if (request.method === "POST" && url.pathname === "/create") {
        const existing = await this.loadRoom();
        if (existing) return json({ error: "Room already exists." }, 409);

        const name = cleanName(body.name);
        const code = cleanCode(body.code);
        if (!name || !code) return json({ error: "Enter your name." }, 400);

        const { room, playerId } = makeRoom(code, name);
        this.room = room;
        await this.saveRoom();
        return json({ room: publicRoom(room, playerId), playerId });
      }

      const room = await this.loadRoom();
      if (!room) return json({ error: "Room not found." }, 404);

      if (request.method === "POST" && url.pathname === "/join") {
        const name = cleanName(body.name);
        if (!name) return json({ error: "Enter your name." }, 400);
        if (room.phase !== "lobby") return json({ error: "This round already started." }, 400);
        if (room.players.length >= 20) return json({ error: "Room is full." }, 400);

        const playerId = makeId();
        room.players.push({ id: playerId, name, alive: true, card: null, isJoker: false, targetIds: [] });
        room.log.push(`${name} joined.`);
        await this.saveRoom();
        return json({ room: publicRoom(room, playerId), playerId });
      }

      if (request.method === "GET" && url.pathname === "/room") {
        const playerId = String(url.searchParams.get("playerId") || "");
        return json({ room: publicRoom(room, playerId) });
      }

      if (request.method === "POST" && url.pathname === "/start") {
        if (room.hostId !== body.playerId) return json({ error: "Only the host can start." }, 403);
        deal(room);
        await this.saveRoom();
        return json({ room: publicRoom(room, body.playerId) });
      }

      if (request.method === "POST" && url.pathname === "/dead") {
        const player = room.players.find((item) => item.id === body.playerId);
        if (!player) return json({ error: "Player not found." }, 404);
        if (room.phase !== "playing") return json({ error: "The game is not in play." }, 400);
        player.alive = false;
        room.log.push(`${player.name} is dead.`);
        await this.saveRoom();
        return json({ room: publicRoom(room, body.playerId) });
      }

      if (request.method === "POST" && url.pathname === "/vote") {
        if (!room.players.some((player) => player.id === body.targetId)) {
          return json({ error: "Choose a player." }, 400);
        }
        room.votes[body.playerId] = body.targetId;
        room.phase = "voting";
        if (Object.keys(room.votes).length >= room.players.length) room.phase = "results";
        await this.saveRoom();
        return json({ room: publicRoom(room, body.playerId) });
      }

      if (request.method === "POST" && url.pathname === "/reveal") {
        if (room.hostId !== body.playerId) return json({ error: "Only the host can reveal." }, 403);
        room.phase = "results";
        await this.saveRoom();
        return json({ room: publicRoom(room, body.playerId) });
      }

      if (request.method === "POST" && url.pathname === "/reset") {
        if (room.hostId !== body.playerId) return json({ error: "Only the host can reset." }, 403);
        room.phase = "lobby";
        room.votes = {};
        room.log = ["Back in the lobby."];
        room.players.forEach((player) => {
          player.alive = true;
          player.card = null;
          player.isJoker = false;
          player.targetIds = [];
        });
        await this.saveRoom();
        return json({ room: publicRoom(room, body.playerId) });
      }

      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({ error: error.message || "Something went wrong." }, 500);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  }
};

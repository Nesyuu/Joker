const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 4173;
const PUBLIC_DIR = path.join(__dirname, "public");

const rooms = new Map();

function id(size = 8) {
  return crypto.randomBytes(size).toString("hex");
}

function roomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

function makeRoom(hostName) {
  let code = roomCode();
  while (rooms.has(code)) code = roomCode();

  const playerId = id();
  const room = {
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
  };
  rooms.set(code, room);
  return { room, playerId };
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

function getBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1e6) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function deal(room) {
  const players = room.players;
  if (players.length < 3) throw new Error("You need at least 3 players.");

  const jokerIndex = Math.floor(Math.random() * players.length);
  const joker = players[jokerIndex];
  const possibleTargets = players.filter((player) => player.id !== joker.id);
  const targetCount = Math.min(2, Math.max(1, Math.floor(players.length / 3)));
  const targets = possibleTargets
    .sort(() => Math.random() - 0.5)
    .slice(0, targetCount);

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

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.normalize(path.join(PUBLIC_DIR, url.pathname === "/" ? "index.html" : url.pathname));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const ext = path.extname(filePath);
    const type = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json"
    }[ext] || "application/octet-stream";

    res.writeHead(200, { "content-type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  try {
    if (req.method === "POST" && url.pathname === "/api/create") {
      const body = await getBody(req);
      const name = String(body.name || "").trim().slice(0, 24);
      if (!name) return sendJson(res, 400, { error: "Enter your name." });
      const { room, playerId } = makeRoom(name);
      return sendJson(res, 200, { room: publicRoom(room, playerId), playerId });
    }

    if (req.method === "POST" && url.pathname === "/api/join") {
      const body = await getBody(req);
      const name = String(body.name || "").trim().slice(0, 24);
      const code = String(body.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!name) return sendJson(res, 400, { error: "Enter your name." });
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      if (room.phase !== "lobby") return sendJson(res, 400, { error: "This round already started." });
      if (room.players.length >= 20) return sendJson(res, 400, { error: "Room is full." });

      const playerId = id();
      room.players.push({ id: playerId, name, alive: true, card: null, isJoker: false, targetIds: [] });
      room.log.push(`${name} joined.`);
      return sendJson(res, 200, { room: publicRoom(room, playerId), playerId });
    }

    if (req.method === "GET" && url.pathname === "/api/room") {
      const code = String(url.searchParams.get("code") || "").toUpperCase();
      const playerId = String(url.searchParams.get("playerId") || "");
      const room = rooms.get(code);
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      return sendJson(res, 200, { room: publicRoom(room, playerId) });
    }

    if (req.method === "POST" && url.pathname === "/api/start") {
      const body = await getBody(req);
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      if (room.hostId !== body.playerId) return sendJson(res, 403, { error: "Only the host can start." });
      deal(room);
      return sendJson(res, 200, { room: publicRoom(room, body.playerId) });
    }

    if (req.method === "POST" && url.pathname === "/api/dead") {
      const body = await getBody(req);
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      const player = room.players.find((item) => item.id === body.playerId);
      if (!player) return sendJson(res, 404, { error: "Player not found." });
      if (room.phase !== "playing") return sendJson(res, 400, { error: "The game is not in play." });
      player.alive = false;
      room.log.push(`${player.name} is dead.`);
      return sendJson(res, 200, { room: publicRoom(room, body.playerId) });
    }

    if (req.method === "POST" && url.pathname === "/api/vote") {
      const body = await getBody(req);
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      if (!room.players.some((player) => player.id === body.targetId)) {
        return sendJson(res, 400, { error: "Choose a player." });
      }
      room.votes[body.playerId] = body.targetId;
      room.phase = "voting";
      if (Object.keys(room.votes).length >= room.players.length) room.phase = "results";
      return sendJson(res, 200, { room: publicRoom(room, body.playerId) });
    }

    if (req.method === "POST" && url.pathname === "/api/reveal") {
      const body = await getBody(req);
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      if (room.hostId !== body.playerId) return sendJson(res, 403, { error: "Only the host can reveal." });
      room.phase = "results";
      return sendJson(res, 200, { room: publicRoom(room, body.playerId) });
    }

    if (req.method === "POST" && url.pathname === "/api/reset") {
      const body = await getBody(req);
      const room = rooms.get(String(body.code || "").toUpperCase());
      if (!room) return sendJson(res, 404, { error: "Room not found." });
      if (room.hostId !== body.playerId) return sendJson(res, 403, { error: "Only the host can reset." });
      room.phase = "lobby";
      room.votes = {};
      room.log = ["Back in the lobby."];
      room.players.forEach((player) => {
        player.alive = true;
        player.card = null;
        player.isJoker = false;
        player.targetIds = [];
      });
      return sendJson(res, 200, { room: publicRoom(room, body.playerId) });
    }

    return serveStatic(req, res);
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Something went wrong." });
  }
});

server.listen(PORT, () => {
  console.log(`Joker Card Game running on http://localhost:${PORT}`);
});

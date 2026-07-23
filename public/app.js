import { firebaseConfig } from "./firebase-config.js";

const entry = document.querySelector("#entry");
const game = document.querySelector("#game");
const nameInput = document.querySelector("#nameInput");
const codeInput = document.querySelector("#codeInput");
const createBtn = document.querySelector("#createBtn");
const joinBtn = document.querySelector("#joinBtn");
const copyCodeBtn = document.querySelector("#copyCodeBtn");
const topLeaveBtn = document.querySelector("#topLeaveBtn");
const phaseLabel = document.querySelector("#phaseLabel");
const secretCard = document.querySelector("#secretCard");
const cardTitle = document.querySelector("#cardTitle");
const cardText = document.querySelector("#cardText");
const targetList = document.querySelector("#targetList");
const actions = document.querySelector("#actions");
const playerCount = document.querySelector("#playerCount");
const playersList = document.querySelector("#playersList");
const logList = document.querySelector("#logList");
const toast = document.querySelector("#toast");

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const databaseURL = String(firebaseConfig.databaseURL || "").replace(/\/$/, "");
const testRoomCode = "TESST";

let state = {
  code: localStorage.getItem("joker.code") || "",
  playerId: localStorage.getItem("joker.playerId") || "",
  room: null,
  poll: null,
  lastDealtCardKey: ""
};

codeInput.value = state.code;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 5200);
}

function makeId() {
  return crypto.randomUUID();
}

function cleanName(name) {
  return String(name || "").trim().slice(0, 24);
}

function cleanCode(code) {
  return String(code || "").trim().toUpperCase();
}

function roomCode() {
  let code = "";
  const values = new Uint8Array(5);
  crypto.getRandomValues(values);
  values.forEach((value) => {
    code += alphabet[value % alphabet.length];
  });
  return code;
}

function roomUrl(code) {
  if (!databaseURL || databaseURL.includes("PASTE_")) {
    throw new Error("Firebase database URL is missing.");
  }
  return `${databaseURL}/rooms/${encodeURIComponent(code)}.json`;
}

async function firebaseFetch(url, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 9000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data?.error || `Firebase error ${response.status}`;
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Firebase did not answer. Check database URL and rules.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function getRoom(code) {
  return normalizeRoom(await firebaseFetch(roomUrl(code)));
}

async function putRoom(room) {
  await firebaseFetch(roomUrl(room.code), {
    method: "PUT",
    body: JSON.stringify(room)
  });
  return room;
}

function normalizeRoom(room) {
  if (!room) return null;
  return {
    ...room,
    players: Array.isArray(room.players) ? room.players : [],
    votes: room.votes || {},
    log: Array.isArray(room.log) ? room.log : []
  };
}

function publicRoom(room, viewerId) {
  const safeRoom = normalizeRoom(room);
  const viewer = safeRoom.players.find((player) => player.id === viewerId);
  return {
    code: safeRoom.code,
    hostId: safeRoom.hostId,
    viewerId,
    phase: safeRoom.phase,
    round: safeRoom.round,
    players: safeRoom.players.map((player) => ({
      id: player.id,
      name: player.name,
      alive: player.alive,
      isHost: player.id === safeRoom.hostId,
      isYou: player.id === viewerId,
      hasVoted: Boolean(safeRoom.votes[player.id]),
      revealedCard: safeRoom.phase === "results" ? player.card : null,
      revealedIsJoker: safeRoom.phase === "results" ? player.isJoker : false
    })),
    me: viewer ? {
      id: viewer.id,
      name: viewer.name,
      alive: viewer.alive,
      card: viewer.card,
      isJoker: viewer.isJoker,
      targetIds: viewer.targetIds || []
    } : null,
    votes: safeRoom.phase === "results" ? safeRoom.votes : {},
    log: safeRoom.log.slice(-8)
  };
}

function saveSession(code, playerId) {
  state.code = code;
  state.playerId = playerId || state.playerId;
  localStorage.setItem("joker.code", state.code);
  localStorage.setItem("joker.playerId", state.playerId);
  startPolling();
}

function returnToEntry() {
  if (state.poll) window.clearInterval(state.poll);
  state.poll = null;
  state.code = "";
  state.playerId = "";
  state.room = null;
  state.lastDealtCardKey = "";
  localStorage.removeItem("joker.code");
  localStorage.removeItem("joker.playerId");
  codeInput.value = "";
  copyCodeBtn.textContent = "-----";
  topLeaveBtn.disabled = false;
  phaseLabel.textContent = "Lobby";
  secretCard.dataset.card = "WAITING";
  secretCard.classList.remove("is-new");
  cardTitle.textContent = "Waiting";
  cardText.textContent = "Create or join a room to begin.";
  targetList.innerHTML = "";
  actions.innerHTML = "";
  playersList.innerHTML = "";
  logList.innerHTML = "";
  playerCount.textContent = "0";
  entry.classList.remove("hidden");
  game.classList.add("hidden");
  window.setTimeout(() => nameInput.focus(), 50);
}

function startPolling() {
  if (state.poll) window.clearInterval(state.poll);
  state.poll = window.setInterval(refreshRoom, 1200);
  refreshRoom();
}

async function refreshRoom() {
  if (!state.code || !state.playerId) return;
  try {
    const room = await getRoom(state.code);
    if (!room) return;
    state.room = publicRoom(room, state.playerId);
    render();
  } catch (error) {
    console.error(error);
  }
}

async function updateRoom(code, updater) {
  const room = await getRoom(code);
  if (!room) throw new Error("Room not found.");
  const nextRoom = normalizeRoom(structuredClone(room));
  updater(nextRoom);
  await putRoom(nextRoom);
  state.room = publicRoom(nextRoom, state.playerId);
  render();
  return nextRoom;
}

async function leaveRoom() {
  const code = state.code;
  const playerId = state.playerId;
  if (!code || !playerId) {
    returnToEntry();
    return;
  }

  try {
    const room = await getRoom(code);
    if (!room) {
      returnToEntry();
      return;
    }

    const nextRoom = normalizeRoom(structuredClone(room));
    const leavingPlayer = nextRoom.players.find((player) => player.id === playerId);
    nextRoom.players = nextRoom.players.filter((player) => player.id !== playerId);
    delete nextRoom.votes[playerId];
    Object.keys(nextRoom.votes).forEach((voterId) => {
      if (!nextRoom.players.some((player) => player.id === nextRoom.votes[voterId])) {
        delete nextRoom.votes[voterId];
      }
    });

    if (!nextRoom.players.length) {
      await firebaseFetch(roomUrl(code), { method: "DELETE" });
      returnToEntry();
      return;
    }

    if (nextRoom.hostId === playerId) nextRoom.hostId = nextRoom.players[0].id;
    if (leavingPlayer) nextRoom.log.push(`${leavingPlayer.name} left the room.`);
    if (nextRoom.phase === "results") nextRoom.phase = "lobby";
    await putRoom(nextRoom);
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not leave room.");
  } finally {
    returnToEntry();
  }
}


function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = crypto.getRandomValues(new Uint32Array(1))[0] % (index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function deal(room) {
  const players = room.players;
  const isTestingRoom = cleanCode(room.code) === testRoomCode;
  if (!isTestingRoom && players.length < 3) throw new Error("You need at least 3 players.");

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
    player.card = player.isJoker ? "JOKER" : "TARGET";
  });
}

async function createRoom() {
  const name = cleanName(nameInput.value);
  if (!name) throw new Error("Enter your name.");

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = roomCode();
    const existingRoom = await getRoom(code);
    if (existingRoom) continue;

    const playerId = makeId();
    const room = {
      code,
      hostId: playerId,
      phase: "lobby",
      round: 0,
      players: [{
        id: playerId,
        name,
        alive: true,
        card: null,
        isJoker: false,
        targetIds: []
      }],
      votes: {},
      log: []
    };

    await putRoom(room);
    saveSession(code, playerId);
    return;
  }

  throw new Error("Could not create a room. Try again.");
}

async function joinRoom() {
  const name = cleanName(nameInput.value);
  const code = cleanCode(codeInput.value);
  if (!name) throw new Error("Enter your name.");
  if (!code) throw new Error("Enter a room code.");

  const playerId = makeId();
  if (code === testRoomCode) {
    const existingRoom = await getRoom(code);
    if (!existingRoom) {
      const room = {
        code,
        hostId: playerId,
        phase: "lobby",
        round: 0,
        players: [{ id: playerId, name, alive: true, card: null, isJoker: false, targetIds: [] }],
        votes: {},
        log: ["Secret test room created."]
      };
      await putRoom(room);
      saveSession(code, playerId);
      return;
    }
  }

  const room = await updateRoom(code, (nextRoom) => {
    if (nextRoom.phase !== "lobby") throw new Error("This round already started.");
    if (nextRoom.players.length >= 20) throw new Error("Room is full.");
    nextRoom.players.push({ id: playerId, name, alive: true, card: null, isJoker: false, targetIds: [] });
    nextRoom.log.push(`${name} joined.`);
  });

  if (!room.players.some((player) => player.id === playerId)) throw new Error("Could not join room.");
  saveSession(code, playerId);
}

function phaseName(phase) {
  return {
    lobby: "Lobby",
    playing: "Playing",
    voting: "Voting",
    results: "Reveal"
  }[phase] || "Lobby";
}

function cardCopy(room) {
  const me = room.me;
  if (!me || room.phase === "lobby") {
    return ["Waiting", "The host starts the round when everyone is in."];
  }
  if (me.isJoker) {
    return ["JOKER", "Give a subtle real-life hint to your target players. Do not make it too easy."];
  }
  if (me.card === "TARGET") {
    return ["TARGET", "The Joker may hint to you. If you catch it, tap Im dead."];
  }
  return ["TARGET", "The Joker may hint to you. If you catch it, tap Im dead."];
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener("click", onClick);
  return el;
}

function leaveRoomButton() {
  const el = button("", "leave-room", leaveRoom);
  el.innerHTML = `
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M10 5H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h4" />
      <path d="M15 8l4 4-4 4" />
      <path d="M8 12h11" />
    </svg>
    <span>Leave room</span>
  `;
  return el;
}

function waitingButton(label, message) {
  const el = button(label, "muted", () => showToast(message));
  el.type = "button";
  return el;
}

function renderActions(room) {
  actions.innerHTML = "";
  const isHost = room.hostId === room.viewerId;

  if (room.phase === "lobby") {
    if (isHost) {
      actions.append(button("Start round", "primary", async () => {
        try {
          await updateRoom(room.code, (nextRoom) => {
            if (nextRoom.hostId !== state.playerId) throw new Error("Only the host can start.");
            deal(nextRoom);
          });
        } catch (error) {
          showToast(error.message);
        }
      }));
    }
    actions.append(button("Copy invite", "", copyInvite));
    return;
  }

  if (room.phase === "playing") {
    actions.append(button("Im dead", "danger", async () => {
      try {
        await updateRoom(room.code, (nextRoom) => {
          const player = nextRoom.players.find((item) => item.id === state.playerId);
          if (!player) throw new Error("Player not found.");
          if (nextRoom.phase !== "playing") throw new Error("The game is not in play.");
          player.alive = false;
          nextRoom.log.push(`${player.name} is dead.`);
        });
      } catch (error) {
        showToast(error.message);
      }
    }));
    if (isHost) {
      actions.append(button("Reveal", "", async () => {
        try {
          await updateRoom(room.code, (nextRoom) => {
            if (nextRoom.hostId !== state.playerId) throw new Error("Only the host can reveal.");
            nextRoom.phase = "results";
          });
        } catch (error) {
          showToast(error.message);
        }
      }));
    }
    return;
  }

  if (room.phase === "voting") {
    actions.append(button("Waiting for votes", "", () => showToast("Players can vote from the list.")));
    if (isHost) {
      actions.append(button("Reveal", "primary", async () => {
        try {
          await updateRoom(room.code, (nextRoom) => {
            if (nextRoom.hostId !== state.playerId) throw new Error("Only the host can reveal.");
            nextRoom.phase = "results";
          });
        } catch (error) {
          showToast(error.message);
        }
      }));
    }
    return;
  }

  if (room.phase === "results") {
    if (isHost) {
      actions.append(button("Next round", "good", async () => {
        try {
          await updateRoom(room.code, (nextRoom) => {
            if (nextRoom.hostId !== state.playerId) throw new Error("Only the host can reset.");
            nextRoom.phase = "lobby";
            nextRoom.votes = {};
            nextRoom.log = ["Back in the lobby."];
            nextRoom.players.forEach((player) => {
              player.alive = true;
              player.card = null;
              player.isJoker = false;
              player.targetIds = [];
            });
          });
        } catch (error) {
          showToast(error.message);
        }
      }));
      return;
    }
    actions.append(waitingButton("Waiting for host", "The host starts the next round."));
  }
}

function renderPlayers(room) {
  playersList.innerHTML = "";
  playerCount.textContent = String(room.players.length);
  const canVote = room.phase === "playing" || room.phase === "voting";

  room.players.forEach((player) => {
    const row = document.createElement("div");
    row.className = `player ${player.alive ? "" : "dead"}`;

    const left = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = player.isYou ? `${player.name} (you)` : player.name;
    left.append(name);

    if (canVote && !player.isYou) {
      const vote = document.createElement("button");
      vote.className = "vote-btn";
      vote.textContent = `Vote ${player.name}`;
      vote.addEventListener("click", async () => {
        try {
          await updateRoom(room.code, (nextRoom) => {
            if (!nextRoom.players.some((item) => item.id === player.id)) throw new Error("Choose a player.");
            nextRoom.votes[state.playerId] = player.id;
            nextRoom.phase = "voting";
            if (Object.keys(nextRoom.votes).length >= nextRoom.players.length) nextRoom.phase = "results";
          });
        } catch (error) {
          showToast(error.message);
        }
      });
      left.append(vote);
    }

    const badges = document.createElement("div");
    badges.className = "badges";
    if (player.isHost) badges.append(badge("Host", "host"));
    if (!player.alive) badges.append(badge("Dead", "dead"));
    if (player.hasVoted) badges.append(badge("Voted", ""));
    if (player.revealedCard === "TARGET") badges.append(badge("Target", ""));
    if (player.revealedIsJoker) badges.append(badge("Joker", "dead"));

    row.append(left, badges);
    playersList.append(row);
  });
}

function badge(text, kind) {
  const el = document.createElement("span");
  el.className = `badge ${kind}`;
  el.textContent = text;
  return el;
}

function renderLog(room) {
  logList.innerHTML = "";
  if (!room.log.length) {
    const item = document.createElement("div");
    item.className = "log-item";
    item.textContent = "No activity yet.";
    logList.append(item);
    return;
  }

  room.log.slice().reverse().forEach((message) => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.textContent = message;
    logList.append(item);
  });
}

function renderTargets(room) {
  targetList.innerHTML = "";
  if (!room.me?.isJoker) return;

  const targets = room.me.targetIds
    .map((targetId) => room.players.find((player) => player.id === targetId))
    .filter(Boolean);

  targets.forEach((target) => {
    const pill = document.createElement("span");
    pill.className = "target-pill";
    pill.textContent = target.name;
    targetList.append(pill);
  });
}

function renderResults(room) {
  if (room.phase !== "results") return;
  const joker = room.players.find((player) => player.revealedIsJoker);
  const votes = Object.values(room.votes).reduce((counts, targetId) => {
    counts[targetId] = (counts[targetId] || 0) + 1;
    return counts;
  }, {});
  const mostVotes = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  if (mostVotes) {
    const votedPlayer = room.players.find((player) => player.id === mostVotes[0]);
    if (votedPlayer) {
      const pill = document.createElement("span");
      pill.className = "target-pill";
      pill.textContent = `Most votes: ${votedPlayer.name}`;
      targetList.append(pill);
    }
  }
  if (joker) {
    const pill = document.createElement("span");
    pill.className = "target-pill";
    pill.textContent = `Joker: ${joker.name}`;
    targetList.append(pill);
  }
}

function render() {
  const room = state.room;
  if (!room) return;

  entry.classList.add("hidden");
  game.classList.remove("hidden");
  copyCodeBtn.textContent = room.code;
  phaseLabel.textContent = phaseName(room.phase);

  const [title, text] = cardCopy(room);
  secretCard.dataset.card = room.me?.card || "WAITING";
  const cardKey = `${room.round}-${room.viewerId}-${room.me?.card || "WAITING"}`;
  const shouldAnimateCard = room.me?.card && room.phase === "playing" && cardKey !== state.lastDealtCardKey;
  if (shouldAnimateCard) {
    secretCard.classList.remove("is-new");
    void secretCard.offsetWidth;
    secretCard.classList.add("is-new");
    window.setTimeout(() => secretCard.classList.remove("is-new"), 650);
    state.lastDealtCardKey = cardKey;
  }
  cardTitle.textContent = title;
  cardText.textContent = text;
  renderTargets(room);
  renderResults(room);
  renderActions(room);
  renderPlayers(room);
  renderLog(room);
}

async function copyInvite() {
  const url = `${location.origin}/?room=${state.code}`;
  await navigator.clipboard?.writeText(url);
  showToast("Invite link copied.");
}

function setBusy(isBusy, buttonEl, busyLabel, normalLabel) {
  createBtn.disabled = isBusy;
  joinBtn.disabled = isBusy;
  buttonEl.textContent = isBusy ? busyLabel : normalLabel;
  if (!isBusy) {
    createBtn.textContent = "Create room";
    joinBtn.textContent = "Join room";
  }
}

createBtn.addEventListener("click", async () => {
  setBusy(true, createBtn, "Creating...", "Create room");
  try {
    await createRoom();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not create room.");
  } finally {
    setBusy(false, createBtn, "Creating...", "Create room");
  }
});

joinBtn.addEventListener("click", async () => {
  setBusy(true, joinBtn, "Joining...", "Join room");
  try {
    await joinRoom();
  } catch (error) {
    console.error(error);
    showToast(error.message || "Could not join room.");
  } finally {
    setBusy(false, joinBtn, "Joining...", "Join room");
  }
});

copyCodeBtn.addEventListener("click", copyInvite);
topLeaveBtn.addEventListener("click", leaveRoom);

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) codeInput.value = roomFromUrl.toUpperCase();

if (state.code && state.playerId) startPolling();

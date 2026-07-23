const entry = document.querySelector("#entry");
const game = document.querySelector("#game");
const nameInput = document.querySelector("#nameInput");
const codeInput = document.querySelector("#codeInput");
const createBtn = document.querySelector("#createBtn");
const joinBtn = document.querySelector("#joinBtn");
const copyCodeBtn = document.querySelector("#copyCodeBtn");
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

let state = {
  code: localStorage.getItem("joker.code") || "",
  playerId: localStorage.getItem("joker.playerId") || "",
  room: null,
  poll: null,
  lastCardKey: ""
};

codeInput.value = state.code;

function showToast(message) {
  toast.textContent = message;
  toast.classList.remove("hidden");
  window.setTimeout(() => toast.classList.add("hidden"), 2100);
}

async function api(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Something went wrong.");
  return data;
}

function saveSession(room, playerId) {
  state.room = room;
  state.code = room.code;
  state.playerId = playerId || state.playerId;
  localStorage.setItem("joker.code", state.code);
  localStorage.setItem("joker.playerId", state.playerId);
  render();
  startPolling();
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
  return ["PLAYER", "Watch everyone. If people start dying, discuss who the Joker might be."];
}

function button(label, className, onClick) {
  const el = document.createElement("button");
  el.textContent = label;
  if (className) el.className = className;
  el.addEventListener("click", onClick);
  return el;
}

function renderActions(room) {
  actions.innerHTML = "";
  const isHost = room.hostId === room.viewerId;

  if (room.phase === "lobby") {
    if (isHost) {
      actions.append(button("Start round", "primary", async () => {
        try {
          const data = await api("/api/start", { code: room.code, playerId: state.playerId });
          saveSession(data.room);
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
        const data = await api("/api/dead", { code: room.code, playerId: state.playerId });
        saveSession(data.room);
      } catch (error) {
        showToast(error.message);
      }
    }));
    if (isHost) {
      actions.append(button("Reveal", "", async () => {
        const data = await api("/api/reveal", { code: room.code, playerId: state.playerId });
        saveSession(data.room);
      }));
    }
    return;
  }

  if (room.phase === "voting") {
    actions.append(button("Waiting for votes", "", () => showToast("Players can vote from the list.")));
    if (isHost) {
      actions.append(button("Reveal", "primary", async () => {
        const data = await api("/api/reveal", { code: room.code, playerId: state.playerId });
        saveSession(data.room);
      }));
    }
    return;
  }

  if (room.phase === "results") {
    if (isHost) {
      actions.append(button("Next round", "good", async () => {
        const data = await api("/api/reset", { code: room.code, playerId: state.playerId });
        saveSession(data.room);
      }));
    }
    actions.append(button("Copy invite", "", copyInvite));
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
          const data = await api("/api/vote", { code: room.code, playerId: state.playerId, targetId: player.id });
          saveSession(data.room);
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
  const cardKey = `${room.round}-${room.viewerId}-${room.me?.card || "WAITING"}-${room.phase}`;
  if (cardKey !== state.lastCardKey) {
    secretCard.classList.remove("is-new");
    void secretCard.offsetWidth;
    secretCard.classList.add("is-new");
    window.setTimeout(() => secretCard.classList.remove("is-new"), 650);
    state.lastCardKey = cardKey;
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

function startPolling() {
  if (state.poll) return;
  state.poll = window.setInterval(async () => {
    if (!state.code || !state.playerId) return;
    try {
      const response = await fetch(`/api/room?code=${encodeURIComponent(state.code)}&playerId=${encodeURIComponent(state.playerId)}`);
      const data = await response.json();
      if (response.ok) {
        state.room = data.room;
        render();
      }
    } catch {
      // The next poll will try again.
    }
  }, 1200);
}

createBtn.addEventListener("click", async () => {
  try {
    const data = await api("/api/create", { name: nameInput.value });
    saveSession(data.room, data.playerId);
  } catch (error) {
    showToast(error.message);
  }
});

joinBtn.addEventListener("click", async () => {
  try {
    const data = await api("/api/join", { name: nameInput.value, code: codeInput.value });
    saveSession(data.room, data.playerId);
  } catch (error) {
    showToast(error.message);
  }
});

copyCodeBtn.addEventListener("click", copyInvite);

const roomFromUrl = new URLSearchParams(location.search).get("room");
if (roomFromUrl) codeInput.value = roomFromUrl.toUpperCase();

if (state.code && state.playerId) {
  fetch(`/api/room?code=${encodeURIComponent(state.code)}&playerId=${encodeURIComponent(state.playerId)}`)
    .then((response) => response.json().then((data) => ({ response, data })))
    .then(({ response, data }) => {
      if (response.ok && data.room.me) saveSession(data.room);
    })
    .catch(() => {});
}

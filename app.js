(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const els = {
    lobby: $("lobby"), lobbyTitle: $("lobbyTitle"), lobbyText: $("lobbyText"),
    inviteWrap: $("inviteWrap"), inviteLink: $("inviteLink"), copyInvite: $("copyInvite"),
    shareInvite: $("shareInvite"), joinHint: $("joinHint"), joinHintText: $("joinHintText"),
    connectionBadge: $("connectionBadge"), game: $("game"), tower: $("tower"), ghost: $("ghost"),
    towerCount: $("towerCount"), wobbleReadout: $("wobbleReadout"), turnChip: $("turnChip"),
    player0: $("player0"), player1: $("player1"), cardFace: $("cardFace"), drawCard: $("drawCard"),
    rack: $("rack"), placementControls: $("placementControls"), positionRange: $("positionRange"),
    dropCube: $("dropCube"), actionHint: $("actionHint"), gameOver: $("gameOver"),
    gameOverTitle: $("gameOverTitle"), gameOverText: $("gameOverText"), restartGame: $("restartGame")
  };

  const params = new URLSearchParams(location.search);
  const roomId = params.get("room");
  const isHost = !roomId;
  const myIndex = isHost ? 0 : 1;
  const myName = isHost ? "Joey" : (params.get("guest") || "Sabrina");
  const otherName = isHost ? "Sabrina" : "Joey";
  const FLOOR_H = 27;
  const MAX_STACK_HEIGHT = 330;

  let peer = null;
  let conn = null;
  let state = null;
  let localSelected = null;
  let localPosition = 50;
  let connected = false;

  function makeCubes() {
    const raw = [
      ["p1","pink","square",24,52,-1.5,-1.8],["p2","pink","wide",30,45,2.3,2.1],["p3","pink","tall",21,61,-2.6,-1.0],["p4","pink","square",25,54,1.2,1.5],["p5","pink","wide",29,47,-1.0,-2.0],
      ["b1","blue","wide",31,46,-2.0,-1.8],["b2","blue","square",24,54,2.5,1.3],["b3","blue","tall",21,63,-1.2,-1.1],["b4","blue","square",26,52,1.8,2.0],["b5","blue","wide",29,48,-2.8,-1.4],
      ["y1","yellow","tall",21,62,1.6,1.6],["y2","yellow","square",25,53,-2.2,-1.3],["y3","yellow","wide",31,45,2.0,1.7],["y4","yellow","square",24,55,-1.5,-1.5],["y5","yellow","wide",28,49,2.7,2.1]
    ];
    return raw.map(([id,color,size,w,h,rot,bias]) => ({id,color,size,w,h,rot,bias,used:false}));
  }

  function makeDeck() {
    const cards = [
      ["pink","any"],["blue","any"],["yellow","any"],["any","square"],["any","wide"],["any","tall"],
      ["pink","wide"],["pink","square"],["pink","tall"],["blue","wide"],["blue","square"],["blue","tall"],
      ["yellow","wide"],["yellow","square"],["yellow","tall"],["any","any"],["any","any"],["any","any"],
      ["pink","any"],["blue","any"],["yellow","any"]
    ].map((x,i)=>({id:"c"+i,color:x[0],size:x[1]}));
    for (let i=cards.length-1;i>0;i--) {
      const j=Math.floor(Math.random()*(i+1));
      [cards[i],cards[j]]=[cards[j],cards[i]];
    }
    return cards;
  }

  function freshState() {
    return {
      phase:"await_draw",
      turn:0,
      players:["Joey","Sabrina"],
      card:null,
      deck:makeDeck(),
      cubes:makeCubes(),
      stack:[],
      winner:null,
      loser:null,
      safety:100,
      message:"Joey draws first."
    };
  }

  function cubeById(id) {
    return state ? state.cubes.find(c => c.id === id) : null;
  }

  function cardAllows(cube, card) {
    if (!cube || !card || cube.used) return false;
    return (card.color === "any" || cube.color === card.color) &&
           (card.size === "any" || cube.size === card.size);
  }

  function nextPlayableCard(s) {
    while (s.deck.length) {
      const card = s.deck.shift();
      if (s.cubes.some(c => !c.used && (card.color === "any" || c.color === card.color) && (card.size === "any" || c.size === card.size))) return card;
    }
    const available = s.cubes.filter(c=>!c.used);
    if (!available.length) return null;
    return {id:"fallback-"+Date.now(),color:"any",size:"any"};
  }

  function stabilityFor(stack) {
    if (!stack.length) return {stable:true,margin:100};
    let margin = 100;

    for (let i = 1; i < stack.length; i++) {
      const supportPlacement = stack[i - 1];
      const supportCube = cubeById(supportPlacement.cubeId);
      const currentPlacement = stack[i];
      const currentCube = cubeById(currentPlacement.cubeId);
      if (!supportCube || !currentCube) continue;

      const supportLeft = supportPlacement.x - supportCube.w / 2;
      const supportRight = supportPlacement.x + supportCube.w / 2;
      const currentLeft = currentPlacement.x - currentCube.w / 2;
      const currentRight = currentPlacement.x + currentCube.w / 2;
      const overlap = Math.max(0, Math.min(supportRight,currentRight) - Math.max(supportLeft,currentLeft));
      const minOverlap = Math.min(8.5, currentCube.w * 0.27);
      if (overlap < minOverlap) return {stable:false,margin:-1};

      const above = stack.slice(i);
      let totalMass = 0;
      let weightedX = 0;
      above.forEach(p => {
        const c = cubeById(p.cubeId);
        if (!c) return;
        const m = c.w * c.h;
        totalMass += m;
        weightedX += (p.x + c.bias) * m;
      });
      const com = weightedX / Math.max(1,totalMass);
      const safeInset = Math.max(2.2, supportCube.w * 0.12);
      const safeLeft = supportLeft + safeInset;
      const safeRight = supportRight - safeInset;
      const localMargin = Math.min(com - safeLeft, safeRight - com);
      margin = Math.min(margin, localMargin);
      if (com < safeLeft || com > safeRight) return {stable:false,margin:localMargin};
    }

    const totalHeight = stack.reduce((sum,p) => {
      const c = cubeById(p.cubeId); return sum + (c ? c.h : 0);
    },0);
    if (totalHeight > MAX_STACK_HEIGHT + 34) margin = Math.min(margin, 2.5);
    return {stable:true,margin};
  }

  function setBadge(text, cls) {
    els.connectionBadge.textContent = text;
    els.connectionBadge.className = "badge " + cls;
  }

  function toast(text) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = text;
    document.body.appendChild(node);
    setTimeout(()=>node.remove(),1800);
  }

  function send(payload) {
    if (conn && conn.open) conn.send(payload);
  }

  function broadcastState() {
    if (!isHost || !state) return;
    send({type:"state",state});
    render();
  }

  function startConnectedGame() {
    connected = true;
    setBadge("CONNECTED","online");
    els.lobby.classList.add("hidden");
    els.game.classList.remove("hidden");
    if (isHost && !state) state = freshState();
    render();
  }

  function handleHostAction(action, actor) {
    if (!state || (state.phase === "gameover" && action.type !== "restart")) return;
    if (action.type !== "restart" && actor !== state.turn) return;

    if (action.type === "draw") {
      if (state.phase !== "await_draw") return;
      const card = nextPlayableCard(state);
      if (!card) {
        state.phase = "gameover";
        state.winner = 1 - state.turn;
        state.loser = state.turn;
        state.message = "No legal cubes left.";
      } else {
        state.card = card;
        state.phase = "placing";
        state.message = state.players[state.turn] + " must place " + describeCard(card) + ".";
      }
      broadcastState();
      return;
    }

    if (action.type === "drop") {
      if (state.phase !== "placing" || !state.card) return;
      const cube = state.cubes.find(c=>c.id===action.cubeId);
      const x = Math.max(12,Math.min(88,Number(action.x)||50));
      if (!cube || !cardAllows(cube,state.card)) return;
      cube.used = true;
      state.stack.push({cubeId:cube.id,x});
      const result = stabilityFor(state.stack);
      state.safety = result.margin;

      if (!result.stable) {
        state.phase = "gameover";
        state.loser = actor;
        state.winner = 1 - actor;
        state.message = state.players[actor] + " knocked it down.";
      } else if (state.cubes.every(c=>c.used)) {
        state.phase = "gameover";
        state.winner = actor;
        state.loser = 1 - actor;
        state.message = state.players[actor] + " survived the final cube.";
      } else {
        state.turn = 1 - state.turn;
        state.phase = "await_draw";
        state.card = null;
        state.message = state.players[state.turn] + "'s turn to draw.";
      }
      broadcastState();
      return;
    }

    if (action.type === "restart") {
      state = freshState();
      state.turn = Math.random() < .5 ? 0 : 1;
      state.message = state.players[state.turn] + " draws first.";
      localSelected = null;
      broadcastState();
    }
  }

  function describeCard(card) {
    if (!card) return "";
    const color = card.color === "any" ? "ANY COLOR" : card.color.toUpperCase();
    const size = card.size === "any" ? "ANY SHAPE" : card.size.toUpperCase();
    return color + " · " + size;
  }

  function setupConnection() {
    if (typeof Peer === "undefined") {
      setBadge("RELAY ERROR","error");
      els.lobbyTitle.textContent = "The multiplayer relay did not load.";
      els.lobbyText.textContent = "Check your connection and reload. The game itself is static, but the two-player link needs the PeerJS relay.";
      els.joinHint.classList.add("hidden");
      return;
    }

    try {
      peer = new Peer();
    } catch (e) {
      failConnection("Could not create a room.");
      return;
    }

    peer.on("open", (id) => {
      if (isHost) {
        const invite = new URL(location.href);
        invite.search = "";
        invite.searchParams.set("room",id);
        invite.searchParams.set("guest","Sabrina");
        els.inviteLink.value = invite.toString();
        els.inviteWrap.classList.remove("hidden");
        els.lobbyTitle.textContent = "Room ready. Send Sabrina the link.";
        els.lobbyText.textContent = "You are the host. Keep this page open while she joins.";
        els.joinHintText.textContent = "Waiting for Sabrina…";
        setBadge("WAITING","waiting");
      } else {
        els.lobbyTitle.textContent = "Joining Joey's tower…";
        els.lobbyText.textContent = "Connecting directly to Joey's browser.";
        els.joinHintText.textContent = "Knocking on the room door…";
        setBadge("JOINING","waiting");
        conn = peer.connect(roomId,{reliable:true,metadata:{name:myName}});
        wireConnection(conn);
      }
    });

    if (isHost) {
      peer.on("connection", (incoming) => {
        if (conn && conn.open) {
          incoming.on("open",()=>incoming.close());
          return;
        }
        conn = incoming;
        wireConnection(conn);
      });
    }

    peer.on("error", (err) => {
      console.error(err);
      if (!connected) failConnection(err.type === "peer-unavailable" ? "That room is gone. Ask Joey for a fresh invite link." : "The room connection failed. Reload and try again.");
    });
  }

  function wireConnection(c) {
    c.on("open", () => {
      if (isHost) {
        state = freshState();
        const guestName = (c.metadata && c.metadata.name) || "Sabrina";
        state.players = ["Joey",guestName];
        c.send({type:"hello",index:1,state});
        startConnectedGame();
        broadcastState();
      } else {
        send({type:"join",name:myName});
      }
    });

    c.on("data", (data) => {
      if (!data || typeof data !== "object") return;
      if (isHost) {
        if (data.type === "join" && state) {
          state.players[1] = String(data.name || "Sabrina").slice(0,24);
          broadcastState();
        } else if (data.type === "action") {
          handleHostAction(data.action,1);
        }
      } else if (data.type === "hello" || data.type === "state") {
        state = data.state;
        startConnectedGame();
      }
    });

    c.on("close", () => {
      setBadge("DISCONNECTED","error");
      connected = false;
      if (state && state.phase !== "gameover") els.actionHint.textContent = otherName + " disconnected. The room is paused.";
      render();
    });

    c.on("error", (err) => {
      console.error(err);
      setBadge("CONNECTION ERROR","error");
    });
  }

  function failConnection(text) {
    setBadge("OFFLINE","error");
    els.lobbyTitle.textContent = "Multiplayer hiccup.";
    els.lobbyText.textContent = text;
    els.joinHint.classList.add("hidden");
  }

  function renderCard() {
    const card = state && state.card;
    if (!card) {
      els.cardFace.className = "game-card card-back";
      els.cardFace.innerHTML = '<div class="card-corner">W</div><div class="card-main"><div class="mini-stack"><i></i><i></i><i></i></div><strong>DRAW</strong><small>to find your cube</small></div>';
      return;
    }
    const colorClass = card.color;
    const colorText = card.color === "any" ? "ANY COLOR" : card.color.toUpperCase();
    const sizeText = card.size === "any" ? "ANY SHAPE" : card.size.toUpperCase();
    els.cardFace.className = "game-card revealed";
    els.cardFace.innerHTML = '<div class="card-corner">W</div><div class="card-main"><div class="card-color-block '+colorClass+'"></div><strong>'+colorText+'</strong><div class="card-rule">'+sizeText+'</div></div>';
  }

  function renderRack() {
    if (!state) return;
    const myTurn = state.turn === myIndex && connected;
    const canPlace = myTurn && state.phase === "placing" && state.card;
    els.rack.innerHTML = "";
    state.cubes.forEach((cube) => {
      if (cube.used) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rack-cube" + (localSelected === cube.id ? " selected" : "");
      btn.dataset.color = cube.color;
      btn.style.setProperty("--tilt", cube.rot + "deg");
      btn.style.height = Math.max(44, Math.round(cube.h*.8)) + "px";
      btn.title = cube.color + " " + cube.size + " cube";
      btn.setAttribute("aria-label", cube.color + " " + cube.size + " cube");
      btn.disabled = !canPlace || !cardAllows(cube,state.card);
      btn.innerHTML = '<span class="size">'+cube.size+'</span>';
      btn.addEventListener("click", () => {
        localSelected = cube.id;
        localPosition = Number(els.positionRange.value) || 50;
        render();
      });
      els.rack.appendChild(btn);
    });
  }

  function renderTower() {
    if (!state) return;
    Array.from(els.tower.querySelectorAll(".cube:not(.ghost)")).forEach(n=>n.remove());
    let bottom = FLOOR_H;
    state.stack.forEach((p,idx) => {
      const cube = cubeById(p.cubeId);
      if (!cube) return;
      const div = document.createElement("div");
      div.className = "cube";
      div.dataset.color = cube.color;
      div.style.width = cube.w + "%";
      div.style.height = cube.h + "px";
      div.style.left = p.x + "%";
      div.style.bottom = bottom + "px";
      div.style.transform = "translateX(-50%) rotate(" + cube.rot + "deg)";
      div.style.zIndex = String(idx+1);
      const fallX = Math.max(5,Math.min(95,p.x + (idx%2===0 ? -24 : 27))) + "%";
      const fallR = ((idx%2===0?-1:1)*(35+idx*8)) + "deg";
      div.style.setProperty("--fall-x",fallX);
      div.style.setProperty("--fall-r",fallR);
      els.tower.insertBefore(div,els.ghost);
      bottom += cube.h - 2;
    });

    const safety = Number(state.safety);
    els.tower.classList.remove("danger","scary");
    if (state.phase !== "gameover") {
      if (safety < 3.5) els.tower.classList.add("scary");
      else if (safety < 7) els.tower.classList.add("danger");
    }
    els.tower.classList.toggle("collapsed", state.phase === "gameover" && state.loser !== null && state.stack.length > 0 && state.message.includes("knocked"));

    els.towerCount.textContent = state.stack.length + (state.stack.length===1?" cube stacked":" cubes stacked");
    if (state.stack.length < 2) els.wobbleReadout.textContent = "Stable";
    else if (safety < 3.5) els.wobbleReadout.textContent = "VERY sketchy";
    else if (safety < 7) els.wobbleReadout.textContent = "Wobbling";
    else els.wobbleReadout.textContent = "Stable";

    const selected = localSelected ? cubeById(localSelected) : null;
    const showGhost = selected && state.turn===myIndex && state.phase==="placing" && connected;
    if (showGhost) {
      const totalBottom = state.stack.reduce((sum,p)=>{
        const c=cubeById(p.cubeId); return sum + (c ? c.h-2 : 0);
      },FLOOR_H);
      els.ghost.classList.remove("hidden");
      els.ghost.dataset.color = selected.color;
      els.ghost.style.width = selected.w + "%";
      els.ghost.style.height = selected.h + "px";
      els.ghost.style.left = localPosition + "%";
      els.ghost.style.bottom = totalBottom + "px";
      els.ghost.style.transform = "translateX(-50%) rotate("+selected.rot+"deg)";
    } else {
      els.ghost.classList.add("hidden");
    }
  }

  function render() {
    if (!state || !connected) return;

    const myTurn = state.turn === myIndex;
    const p0 = state.players[0] || "Joey";
    const p1 = state.players[1] || "Sabrina";
    els.player0.querySelector("strong").textContent = p0;
    els.player1.querySelector("strong").textContent = p1;
    els.player0.classList.toggle("inactive",state.turn!==0);
    els.player1.classList.toggle("inactive",state.turn!==1);
    els.turnChip.textContent = (state.players[state.turn] || ("PLAYER "+(state.turn+1))).toUpperCase() + "'S TURN";

    if (state.phase !== "placing") localSelected = null;

    els.drawCard.disabled = !(myTurn && state.phase==="await_draw" && connected);
    els.drawCard.textContent = myTurn ? "Draw a card" : "Their turn";
    els.placementControls.classList.toggle("hidden", !(myTurn && state.phase==="placing"));
    els.dropCube.disabled = !localSelected || !myTurn || state.phase!=="placing";

    if (state.phase === "await_draw") {
      els.actionHint.textContent = myTurn ? "Your turn. Draw a card and accept your fate." : (state.players[state.turn] + " is drawing.");
    } else if (state.phase === "placing") {
      if (myTurn) els.actionHint.textContent = localSelected ? "Slide the ghost cube, then drop it. Gravity is judging you." : "Pick one of the highlighted cubes that matches the card.";
      else els.actionHint.textContent = state.players[state.turn] + " is choosing where to place the cube.";
    } else {
      els.actionHint.textContent = state.message;
    }

    renderCard();
    renderRack();
    renderTower();

    const over = state.phase === "gameover";
    els.gameOver.classList.toggle("hidden",!over);
    if (over) {
      const winnerName = state.players[state.winner] || "Someone";
      const loserName = state.players[state.loser] || "Someone";
      if (state.message.includes("final cube")) {
        els.gameOverTitle.textContent = winnerName + " survives the whole tower!";
        els.gameOverText.textContent = "All 15 cubes are up. Somehow. This architecture should not be trusted.";
      } else {
        els.gameOverTitle.textContent = winnerName + " wins.";
        els.gameOverText.textContent = loserName + " was the final tiny shove the laws of physics needed.";
      }
    }
  }

  els.drawCard.addEventListener("click", () => {
    if (!state || state.turn !== myIndex || state.phase !== "await_draw") return;
    if (isHost) handleHostAction({type:"draw"},0);
    else send({type:"action",action:{type:"draw"}});
  });

  els.positionRange.addEventListener("input", () => {
    localPosition = Number(els.positionRange.value) || 50;
    renderTower();
  });

  els.dropCube.addEventListener("click", () => {
    if (!localSelected || !state || state.turn !== myIndex || state.phase !== "placing") return;
    const action = {type:"drop",cubeId:localSelected,x:localPosition};
    localSelected = null;
    if (isHost) handleHostAction(action,0);
    else send({type:"action",action});
  });

  els.restartGame.addEventListener("click", () => {
    if (isHost) handleHostAction({type:"restart"},0);
    else send({type:"action",action:{type:"restart"}});
  });

  els.copyInvite.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(els.inviteLink.value);
      toast("Invite link copied");
    } catch {
      els.inviteLink.focus();
      els.inviteLink.select();
      toast("Link selected. Copy it from the field.");
    }
  });

  els.shareInvite.addEventListener("click", async () => {
    const url = els.inviteLink.value;
    const shareData = {title:"Wonky Tower",text:"Play Wonky Tower with me. Try not to murder the cube tower.",url};
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      try { await navigator.clipboard.writeText(url); toast("Invite link copied"); }
      catch { els.inviteLink.focus(); els.inviteLink.select(); }
    }
  });

  setupConnection();
})();

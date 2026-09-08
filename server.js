const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 12 * 60 * 60 * 1000;
const rooms = new Map();
let cardSerial = 0;

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function makeCubes() {
  const raw = [
    ['ps','pink','small',1.42,1.08,1.28,-0.16,0.07,-0.08,0.04],
    ['pm','pink','medium',1.76,1.23,1.56,0.13,-0.08,0.08,-0.05],
    ['pl','pink','large',2.12,1.42,1.82,-0.12,0.10,-0.10,0.06],
    ['bs','blue','small',1.38,1.11,1.31,0.15,-0.05,0.08,0.04],
    ['bm','blue','medium',1.72,1.26,1.60,-0.14,0.09,-0.07,-0.06],
    ['bl','blue','large',2.08,1.46,1.86,0.11,-0.10,0.10,-0.04],
    ['ys','yellow','small',1.45,1.06,1.25,-0.13,-0.07,-0.06,0.05],
    ['ym','yellow','medium',1.79,1.20,1.53,0.12,0.08,0.07,-0.05],
    ['yl','yellow','large',2.15,1.40,1.79,-0.10,-0.09,-0.09,-0.05]
  ];
  return raw.map(([id,color,size,w,h,d,slantX,slantZ,biasX,biasZ], index) => ({
    id,color,size,w,h,d,slantX,slantZ,biasX,biasZ,
    wobbleSeed:(index * 37 + 11) % 97,
    used:false
  }));
}

function card(type, color='any', size='any') {
  return { id:`c-${Date.now().toString(36)}-${cardSerial++}`, type, color, size };
}

function makeDeck() {
  const cards = [];
  const colors = ['pink','blue','yellow'];
  const sizes = ['small','medium','large'];

  // Exact block cards, two of each.
  for (let copy = 0; copy < 2; copy++) {
    for (const color of colors) for (const size of sizes) cards.push(card('stack', color, size));
  }
  // Flexible stack cards.
  for (const color of colors) {
    cards.push(card('stack', color, 'any'));
    cards.push(card('stack', color, 'any'));
  }
  for (const size of sizes) {
    cards.push(card('stack', 'any', size));
    cards.push(card('stack', 'any', size));
  }
  for (let i = 0; i < 4; i++) cards.push(card('wild'));

  // Action cards adapted for a two-player digital duel.
  for (let i = 0; i < 4; i++) cards.push(card('pass'));
  for (let i = 0; i < 3; i++) cards.push(card('skip'));
  for (let i = 0; i < 3; i++) cards.push(card('combo_disrupt'));
  for (let i = 0; i < 2; i++) cards.push(card('combo_skip'));
  return shuffle(cards);
}

function isStackCard(c) {
  return c && ['stack','wild','combo_disrupt','combo_skip'].includes(c.type);
}

function cardAllows(cube, c) {
  if (!cube || !c || cube.used || !isStackCard(c)) return false;
  if (['wild','combo_disrupt','combo_skip'].includes(c.type)) return true;
  return (c.color === 'any' || cube.color === c.color) && (c.size === 'any' || cube.size === c.size);
}

function cardPlayable(state, c) {
  if (!c) return false;
  if (c.type === 'pass' || c.type === 'skip') return true;
  return state.cubes.some(cube => cardAllows(cube, c));
}

function drawOne(state) {
  if (!state.drawPile.length && state.discard.length) {
    state.drawPile = shuffle(state.discard.splice(0));
  }
  return state.drawPile.shift() || null;
}

function fillHand(state, idx) {
  const hand = state.hands[idx];
  while (hand.length < 4) {
    const next = drawOne(state);
    if (!next) break;
    hand.push(next);
  }
  while (hand.length < 4) hand.push(card('wild'));
}

function ensurePlayableHand(state, idx) {
  const hand = state.hands[idx];
  fillHand(state, idx);
  let guard = 0;
  while (!hand.some(c => cardPlayable(state, c)) && guard++ < 30) {
    const dead = hand.findIndex(c => !cardPlayable(state, c));
    if (dead < 0) break;
    state.discard.push(hand.splice(dead, 1)[0]);
    const replacement = drawOne(state) || card('wild');
    hand.push(replacement);
  }
  if (!hand.some(c => cardPlayable(state, c))) {
    state.discard.push(hand.shift());
    hand.push(card('wild'));
  }
}

function freshGame(names=['Joey','Sabrina']) {
  const state = {
    phase:'choose_card',
    turn:0,
    players:names,
    cubes:makeCubes(),
    stack:[],
    hands:[[],[]],
    drawPile:makeDeck(),
    discard:[],
    activeCard:null,
    winner:null,
    loser:null,
    message:`${names[0]}'s turn. Pick a card.`,
    round:1,
    collapsed:false,
    lastEffect:null
  };
  fillHand(state,0);
  fillHand(state,1);
  ensurePlayableHand(state,0);
  return state;
}

function cubeById(state, id) {
  return state.cubes.find(c => c.id === id);
}

function publicState(state) {
  if (!state) return null;
  return {
    phase:state.phase,
    turn:state.turn,
    players:state.players,
    cubes:state.cubes,
    stack:state.stack,
    activeCard:state.activeCard,
    winner:state.winner,
    loser:state.loser,
    message:state.message,
    round:state.round,
    collapsed:state.collapsed,
    lastEffect:state.lastEffect
  };
}

function roomView(room, index=null) {
  return {
    id:room.id,
    players:room.players.map((p,i)=>p?{name:p.name,connected:!!p.connected,index:i}:null),
    state:publicState(room.state),
    myHand:index === 0 || index === 1 ? room.state?.hands[index] || [] : [],
    handCounts:room.state ? room.state.hands.map(h=>h.length) : [0,0],
    deckCount:room.state?.drawPile.length || 0,
    createdAt:room.createdAt,
    expiresAt:room.expiresAt
  };
}

function touch(room) {
  room.lastTouched = Date.now();
  room.expiresAt = room.lastTouched + ROOM_TTL_MS;
}

function emitRoom(io, room) {
  for (let i = 0; i < 2; i++) {
    const p = room.players[i];
    if (p?.connected && p.socketId) io.to(p.socketId).emit('room:update', roomView(room, i));
  }
}

function advanceTurn(state, target=1-state.turn) {
  state.turn = target;
  state.phase = 'choose_card';
  state.activeCard = null;
  ensurePlayableHand(state, state.turn);
  state.message = `${state.players[state.turn]}'s turn. Pick one of four cards.`;
}

function replaceRandomCard(state, idx) {
  const hand = state.hands[idx];
  if (!hand.length) return;
  const slot = Math.floor(Math.random() * hand.length);
  state.discard.push(hand.splice(slot,1)[0]);
  hand.splice(slot,0,drawOne(state) || card('wild'));
  ensurePlayableHand(state, idx);
}

function clampNumber(v, min, max, fallback=0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function sanitizeTransform(t) {
  const p = Array.isArray(t?.position) ? t.position : [];
  const q = Array.isArray(t?.quaternion) ? t.quaternion : [];
  const position = [
    clampNumber(p[0],-8,8,0),
    clampNumber(p[1],-2,20,1),
    clampNumber(p[2],-8,8,0)
  ];
  let quaternion = [
    clampNumber(q[0],-1,1,0),
    clampNumber(q[1],-1,1,0),
    clampNumber(q[2],-1,1,0),
    clampNumber(q[3],-1,1,1)
  ];
  const len = Math.hypot(...quaternion) || 1;
  quaternion = quaternion.map(v => v / len);
  return {cubeId:String(t.cubeId||''), position, quaternion};
}

function mergeTransforms(state, currentCubeId, incoming) {
  const existingIds = state.stack.map(s => s.cubeId);
  const order = [...existingIds, currentCubeId];
  const allowed = new Set(order);
  const map = new Map(state.stack.map(s => [s.cubeId, s]));
  for (const raw of Array.isArray(incoming) ? incoming.slice(0,12) : []) {
    const t = sanitizeTransform(raw);
    if (allowed.has(t.cubeId)) map.set(t.cubeId, t);
  }
  if (!map.has(currentCubeId)) return null;
  return order.map(id => map.get(id)).filter(Boolean);
}

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors:{origin:true,credentials:false},
  pingTimeout:25000,
  pingInterval:10000
});

const threeRoot = path.resolve(path.dirname(require.resolve('three')), '..');
const cannonRoot = path.resolve(path.dirname(require.resolve('cannon-es')), '..');
app.use('/vendor/three', express.static(threeRoot, {maxAge:'7d'}));
app.use('/vendor/cannon', express.static(cannonRoot, {maxAge:'7d'}));
app.use(express.static(path.join(__dirname,'public'), {maxAge:0}));
app.get('/api/health', (req,res)=>res.json({ok:true,rooms:rooms.size,version:'3.0.0'}));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

io.on('connection', socket => {
  socket.on('room:create', (payload={}, cb=()=>{}) => {
    try {
      const roomId = crypto.randomUUID();
      const playerId = String(payload.playerId || crypto.randomUUID());
      const name = String(payload.name || 'Joey').slice(0,24);
      const room = {
        id:roomId,
        createdAt:Date.now(),
        lastTouched:Date.now(),
        expiresAt:Date.now()+ROOM_TTL_MS,
        players:[{id:playerId,name,connected:true,socketId:socket.id},null],
        state:null
      };
      rooms.set(roomId, room);
      socket.join(roomId);
      socket.data.roomId = roomId;
      socket.data.playerId = playerId;
      socket.data.index = 0;
      cb({ok:true,room:roomView(room,0),index:0});
      emitRoom(io,room);
    } catch {
      cb({ok:false,error:'Could not create room.'});
    }
  });

  socket.on('room:join', (payload={}, cb=()=>{}) => {
    const roomId = String(payload.roomId || '');
    const room = rooms.get(roomId);
    if (!room) return cb({ok:false,error:'That room expired or does not exist.'});
    const desired = payload.role === 'host' ? 0 : 1;
    const playerId = String(payload.playerId || crypto.randomUUID());
    const name = String(payload.name || (desired===0?'Joey':'Sabrina')).slice(0,24);
    const slot = room.players[desired];

    if (slot && slot.connected && slot.id !== playerId) {
      return cb({ok:false,error:desired===0?'Host is already connected.':'That player spot is already connected.'});
    }
    if (slot && slot.id === playerId) {
      slot.connected = true;
      slot.socketId = socket.id;
      slot.name = name || slot.name;
    } else if (!slot || !slot.connected) {
      room.players[desired] = {id:playerId,name,connected:true,socketId:socket.id};
    }

    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.playerId = playerId;
    socket.data.index = desired;
    touch(room);

    if (room.players[0] && room.players[1] && !room.state) {
      room.state = freshGame([room.players[0].name, room.players[1].name]);
    }
    if (room.state && room.players[0] && room.players[1]) {
      room.state.players = [room.players[0].name, room.players[1].name];
    }
    cb({ok:true,room:roomView(room,desired),index:desired});
    emitRoom(io,room);
  });

  socket.on('game:action', (payload={}, cb=()=>{}) => {
    const room = rooms.get(String(payload.roomId || socket.data.roomId || ''));
    if (!room || !room.state) return cb({ok:false,error:'Room is not ready.'});
    const idx = socket.data.index;
    const state = room.state;
    const action = payload.action || {};
    if (idx !== 0 && idx !== 1) return cb({ok:false,error:'Not seated in this room.'});
    if (action.type !== 'rematch' && idx !== state.turn) return cb({ok:false,error:'Not your turn.'});

    if (action.type === 'play_card') {
      if (state.phase !== 'choose_card') return cb({ok:false,error:'Finish the current move first.'});
      const hand = state.hands[idx];
      const at = hand.findIndex(c => c.id === String(action.cardId || ''));
      if (at < 0) return cb({ok:false,error:'That card is not in your hand.'});
      const played = hand[at];
      if (!cardPlayable(state, played)) return cb({ok:false,error:'That card has no legal block right now.'});

      state.discard.push(played);
      hand.splice(at,1,drawOne(state) || card('wild')); // Replace only the card that was played.
      state.lastEffect = {type:'card_played',player:idx,card:played};

      if (played.type === 'pass') {
        state.message = `${state.players[idx]} passes. No block required.`;
        advanceTurn(state,1-idx);
      } else if (played.type === 'skip') {
        state.phase = 'choose_card';
        state.activeCard = null;
        state.turn = idx;
        ensurePlayableHand(state,idx);
        state.message = `${state.players[idx]} skips the rival and goes again.`;
        state.lastEffect = {type:'skip',player:idx};
      } else {
        state.activeCard = {...played,owner:idx};
        state.phase = 'placing';
        state.message = `${state.players[idx]} chose a block card. Drag a matching block onto the tower.`;
      }
    } else if (action.type === 'place_result') {
      if (state.phase !== 'placing' || !state.activeCard || state.activeCard.owner !== idx) {
        return cb({ok:false,error:'Choose a card first.'});
      }
      const cube = cubeById(state,String(action.cubeId || ''));
      if (!cardAllows(cube,state.activeCard)) return cb({ok:false,error:'That block does not match the card.'});
      const merged = mergeTransforms(state,cube.id,action.transforms);
      if (!merged) return cb({ok:false,error:'The block placement did not include a valid final pose.'});

      const played = state.activeCard;
      const collapsed = !!action.collapsed;
      state.stack = merged;
      cube.used = true;
      state.collapsed = collapsed;

      if (collapsed) {
        state.phase = 'gameover';
        state.loser = idx;
        state.winner = 1-idx;
        state.message = `${state.players[idx]} brought the tower down. ${state.players[1-idx]} wins the round.`;
        state.lastEffect = {type:'collapse',player:idx};
      } else if (state.stack.length >= 9) {
        state.phase = 'gameover';
        state.winner = idx;
        state.loser = 1-idx;
        state.message = `${state.players[idx]} landed the ninth block and wins instantly.`;
        state.lastEffect = {type:'ninth_block',player:idx};
      } else if (played.type === 'combo_disrupt') {
        replaceRandomCard(state,1-idx);
        state.lastEffect = {type:'disrupt',player:idx,target:1-idx};
        advanceTurn(state,1-idx);
        state.message = `${state.players[idx]} lands the combo and scrambles one of ${state.players[1-idx]}'s cards.`;
      } else if (played.type === 'combo_skip') {
        state.turn = idx;
        state.phase = 'choose_card';
        state.activeCard = null;
        state.lastEffect = {type:'combo_skip',player:idx};
        ensurePlayableHand(state,idx);
        state.message = `${state.players[idx]} sticks the combo and gets another turn.`;
      } else {
        advanceTurn(state,1-idx);
      }
    } else if (action.type === 'rematch') {
      const names = [room.players[0]?.name || 'Joey', room.players[1]?.name || 'Sabrina'];
      const next = freshGame(names);
      next.turn = Math.random() < 0.5 ? 0 : 1;
      ensurePlayableHand(next,next.turn);
      next.message = `${next.players[next.turn]}'s turn. Pick one of four cards.`;
      next.round = (state.round || 1) + 1;
      room.state = next;
    } else {
      return cb({ok:false,error:'Unknown action.'});
    }

    touch(room);
    emitRoom(io,room);
    cb({ok:true});
  });

  socket.on('disconnect', () => {
    const room = rooms.get(socket.data.roomId);
    if (!room) return;
    const idx = socket.data.index;
    const p = room.players[idx];
    if (p && p.socketId === socket.id) {
      p.connected = false;
      p.socketId = null;
    }
    touch(room);
    emitRoom(io,room);
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id,room] of rooms) {
    const anyoneOnline = room.players.some(p => p && p.connected);
    if (!anyoneOnline && room.expiresAt < now) rooms.delete(id);
  }
},60000).unref();

server.listen(PORT,'0.0.0.0',()=>console.log(`Wonky Tower Duel listening on ${PORT}`));





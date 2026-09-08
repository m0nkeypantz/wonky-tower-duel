const express = require('express');
const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT || 3000);
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const rooms = new Map();

function makeCubes() {
  const raw = [
    ['p1','pink','square',30,54,16,-2,-1.2],['p2','pink','wide',38,46,18,3,1.7],['p3','pink','tall',25,66,15,-3,-0.8],['p4','pink','square',31,56,17,2,1.0],['p5','pink','wide',39,47,18,-1,-1.5],['p6','pink','tall',26,64,16,3,0.9],
    ['b1','blue','wide',40,46,19,-2,-1.6],['b2','blue','square',30,55,16,3,1.1],['b3','blue','tall',25,67,15,-2,-0.7],['b4','blue','square',32,53,17,2,1.6],['b5','blue','wide',39,48,18,-3,-1.2],['b6','blue','tall',26,65,16,2,0.8],
    ['y1','yellow','tall',25,66,15,2,1.0],['y2','yellow','square',31,54,16,-3,-1.0],['y3','yellow','wide',40,45,19,3,1.4],['y4','yellow','square',30,56,17,-2,-1.3],['y5','yellow','wide',38,49,18,3,1.8],['y6','yellow','tall',26,63,15,-1,-0.6]
  ];
  return raw.map(([id,color,size,w,h,d,rot,bias]) => ({id,color,size,w,h,d,rot,bias,used:false}));
}

function makeDeck() {
  const cards = [
    ['pink','any'],['blue','any'],['yellow','any'],['any','square'],['any','wide'],['any','tall'],
    ['pink','wide'],['pink','square'],['pink','tall'],['blue','wide'],['blue','square'],['blue','tall'],
    ['yellow','wide'],['yellow','square'],['yellow','tall'],['any','any'],['any','any'],['any','any'],
    ['pink','any'],['blue','any'],['yellow','any'],['any','wide'],['any','square'],['any','tall']
  ].map((x,i)=>({id:'c'+i,color:x[0],size:x[1]}));
  for (let i=cards.length-1;i>0;i--) {
    const j = Math.floor(Math.random()*(i+1));
    [cards[i],cards[j]]=[cards[j],cards[i]];
  }
  return cards;
}

function freshGame(names=['Joey','Sabrina']) {
  return {
    phase:'await_draw', turn:0, players:names, card:null, deck:makeDeck(), cubes:makeCubes(), stack:[],
    winner:null, loser:null, safety:100, message:`${names[0]}'s turn to draw.`, round:1
  };
}

function cardAllows(cube, card) {
  return !!cube && !!card && !cube.used && (card.color==='any'||cube.color===card.color) && (card.size==='any'||cube.size===card.size);
}

function nextPlayableCard(state) {
  while (state.deck.length) {
    const c = state.deck.shift();
    if (state.cubes.some(cube=>cardAllows(cube,c))) return c;
  }
  return state.cubes.some(c=>!c.used) ? {id:'wild-'+Date.now(),color:'any',size:'any'} : null;
}

function cubeById(state,id){ return state.cubes.find(c=>c.id===id); }

function stabilityFor(state, stack) {
  if (stack.length < 2) return {stable:true,margin:100};
  let margin = 100;
  for (let i=1;i<stack.length;i++) {
    const supportPlacement = stack[i-1];
    const supportCube = cubeById(state,supportPlacement.cubeId);
    const currentPlacement = stack[i];
    const currentCube = cubeById(state,currentPlacement.cubeId);
    if (!supportCube || !currentCube) continue;
    const supportLeft=supportPlacement.x-supportCube.w/2;
    const supportRight=supportPlacement.x+supportCube.w/2;
    const currentLeft=currentPlacement.x-currentCube.w/2;
    const currentRight=currentPlacement.x+currentCube.w/2;
    const overlap=Math.max(0,Math.min(supportRight,currentRight)-Math.max(supportLeft,currentLeft));
    const minOverlap=Math.min(9,currentCube.w*0.26);
    if (overlap<minOverlap) return {stable:false,margin:-1};
    const above=stack.slice(i);
    let mass=0, weighted=0;
    for (const p of above) {
      const c=cubeById(state,p.cubeId); if(!c) continue;
      const m=c.w*c.h*(c.d||16); mass+=m; weighted+=(p.x+c.bias)*m;
    }
    const com=weighted/Math.max(1,mass);
    const inset=Math.max(2.2,supportCube.w*0.12);
    const safeLeft=supportLeft+inset;
    const safeRight=supportRight-inset;
    const local=Math.min(com-safeLeft,safeRight-com);
    margin=Math.min(margin,local);
    if (com<safeLeft || com>safeRight) return {stable:false,margin:local};
  }
  return {stable:true,margin};
}

function publicRoom(room) {
  return {
    id:room.id,
    players:room.players.map((p,i)=>p?{name:p.name,connected:!!p.connected,index:i}:null),
    state:room.state,
    createdAt:room.createdAt,
    expiresAt:room.expiresAt
  };
}

function emitRoom(io,room){ io.to(room.id).emit('room:update',publicRoom(room)); }
function touch(room){ room.lastTouched=Date.now(); room.expiresAt=room.lastTouched+ROOM_TTL_MS; }

const app=express();
const server=http.createServer(app);
const io=new Server(server,{cors:{origin:true,credentials:false},pingTimeout:20000,pingInterval:10000});
app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));
app.get('/api/health',(req,res)=>res.json({ok:true,rooms:rooms.size,version:'2.0.0'}));
app.use((req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

io.on('connection',(socket)=>{
  socket.on('room:create',(payload={},cb=()=>{})=>{
    try {
      const roomId=crypto.randomUUID();
      const playerId=String(payload.playerId||crypto.randomUUID());
      const name=String(payload.name||'Joey').slice(0,24);
      const room={id:roomId,createdAt:Date.now(),lastTouched:Date.now(),expiresAt:Date.now()+ROOM_TTL_MS,players:[{id:playerId,name,connected:true,socketId:socket.id},null],state:null};
      rooms.set(roomId,room); socket.join(roomId); socket.data.roomId=roomId; socket.data.playerId=playerId; socket.data.index=0;
      cb({ok:true,room:publicRoom(room),index:0}); emitRoom(io,room);
    } catch(e){ cb({ok:false,error:'Could not create room.'}); }
  });

  socket.on('room:join',(payload={},cb=()=>{})=>{
    const roomId=String(payload.roomId||''); const room=rooms.get(roomId);
    if(!room) return cb({ok:false,error:'That room expired or does not exist.'});
    const desired=payload.role==='host'?0:1;
    const playerId=String(payload.playerId||crypto.randomUUID());
    const name=String(payload.name||(desired===0?'Joey':'Sabrina')).slice(0,24);
    const slot=room.players[desired];
    if(slot && slot.connected && slot.id!==playerId) return cb({ok:false,error:desired===0?'Host is already connected.':'That player spot is already connected.'});
    if(slot && slot.id===playerId){ slot.connected=true; slot.socketId=socket.id; slot.name=name||slot.name; }
    else if(!slot || !slot.connected){ room.players[desired]={id:playerId,name,connected:true,socketId:socket.id}; }
    socket.join(roomId); socket.data.roomId=roomId; socket.data.playerId=playerId; socket.data.index=desired; touch(room);
    if(room.players[0]&&room.players[1]&&!room.state){ room.state=freshGame([room.players[0].name,room.players[1].name]); }
    if(room.state && room.players[0] && room.players[1]) room.state.players=[room.players[0].name,room.players[1].name];
    cb({ok:true,room:publicRoom(room),index:desired}); emitRoom(io,room);
  });

  socket.on('game:action',(payload={},cb=()=>{})=>{
    const room=rooms.get(String(payload.roomId||socket.data.roomId||''));
    if(!room||!room.state) return cb({ok:false,error:'Room is not ready.'});
    const idx=socket.data.index; const state=room.state; const action=payload.action||{};
    if(idx!==0&&idx!==1) return cb({ok:false,error:'Not seated in this room.'});
    if(action.type!=='rematch' && idx!==state.turn) return cb({ok:false,error:'Not your turn.'});
    if(action.type==='draw'){
      if(state.phase!=='await_draw') return cb({ok:false,error:'Card already drawn.'});
      const card=nextPlayableCard(state);
      if(!card){ state.phase='gameover'; state.winner=1-state.turn; state.loser=state.turn; state.message='No playable cubes remain.'; }
      else { state.card=card; state.phase='placing'; state.message=`${state.players[state.turn]} must place ${card.color==='any'?'any color':card.color} Â· ${card.size==='any'?'any shape':card.size}.`; }
    } else if(action.type==='drop'){
      if(state.phase!=='placing'||!state.card) return cb({ok:false,error:'Draw a card first.'});
      const cube=cubeById(state,String(action.cubeId||'')); const x=Math.max(12,Math.min(88,Number(action.x)||50));
      if(!cardAllows(cube,state.card)) return cb({ok:false,error:'That cube does not match the card.'});
      cube.used=true; state.stack.push({cubeId:cube.id,x});
      const result=stabilityFor(state,state.stack); state.safety=result.margin;
      if(!result.stable){ state.phase='gameover'; state.loser=idx; state.winner=1-idx; state.message=`${state.players[idx]} knocked the tower down.`; }
      else if(state.cubes.every(c=>c.used)){ state.phase='gameover'; state.winner=idx; state.loser=1-idx; state.message=`${state.players[idx]} survived the final cube.`; }
      else { state.turn=1-state.turn; state.phase='await_draw'; state.card=null; state.message=`${state.players[state.turn]}'s turn to draw.`; }
    } else if(action.type==='rematch'){
      const names=[room.players[0]?.name||'Joey',room.players[1]?.name||'Sabrina'];
      const next=freshGame(names); next.turn=Math.random()<0.5?0:1; next.message=`${next.players[next.turn]}'s turn to draw.`; next.round=(state.round||1)+1; room.state=next;
    } else return cb({ok:false,error:'Unknown action.'});
    touch(room); emitRoom(io,room); cb({ok:true});
  });

  socket.on('disconnect',()=>{
    const room=rooms.get(socket.data.roomId); if(!room) return;
    const idx=socket.data.index; const p=room.players[idx];
    if(p && p.socketId===socket.id){ p.connected=false; p.socketId=null; }
    touch(room); emitRoom(io,room);
  });
});

setInterval(()=>{
  const now=Date.now();
  for(const [id,room] of rooms){
    const anyoneOnline=room.players.some(p=>p&&p.connected);
    if(!anyoneOnline && room.expiresAt<now) rooms.delete(id);
  }
},60000).unref();

server.listen(PORT,'0.0.0.0',()=>console.log(`Wonky Tower listening on ${PORT}`));



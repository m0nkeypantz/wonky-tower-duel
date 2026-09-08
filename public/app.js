import * as THREE from 'three';
import * as CANNON from '/vendor/cannon/dist/cannon-es.js';
import { RoundedBoxGeometry } from '/vendor/three/examples/jsm/geometries/RoundedBoxGeometry.js';

const $ = id => document.getElementById(id);
const el = {
  homeBtn:$('homeBtn'), soundBtn:$('soundBtn'), home:$('homeScreen'), lobby:$('vsLobby'), game:$('gameScreen'),
  soloModeBtn:$('soloModeBtn'), vsModeBtn:$('vsModeBtn'), lobbyTitle:$('lobbyTitle'), lobbyText:$('lobbyText'),
  playerName:$('playerName'), createRoomBtn:$('createRoomBtn'), inviteBox:$('inviteBox'), inviteStatus:$('inviteStatus'),
  inviteLink:$('inviteLink'), copyInviteBtn:$('copyInviteBtn'), shareInviteBtn:$('shareInviteBtn'), lobbyError:$('lobbyError'),
  scoreTitle:$('scoreTitle'), scoreValue:$('scoreValue'), modeLabel:$('modeLabel'), turnLabel:$('turnLabel'), bestTitle:$('bestTitle'),
  bestValue:$('bestValue'), arenaShell:$('arenaShell'), towerCanvas:$('towerCanvas'), towerMood:$('towerMood'), connectionBadge:$('connectionBadge'),
  settleCounter:$('settleCounter'), effectBanner:$('effectBanner'), stackValue:$('stackValue'), actionHint:$('actionHint'), blockDock:$('blockDock'),
  dockTitle:$('dockTitle'), dockHint:$('dockHint'), rotateBtn:$('rotateBtn'), cubeRack:$('cubeRack'), handCount:$('handCount'), cardHand:$('cardHand'),
  soloMeta:$('soloMeta'), comboValue:$('comboValue'), braveryValue:$('braveryValue'), soloBestMini:$('soloBestMini'),
  gameOverPanel:$('gameOverPanel'), gameOverTitle:$('gameOverTitle'), gameOverText:$('gameOverText'), finalScoreWrap:$('finalScoreWrap'),
  finalScore:$('finalScore'), rematchBtn:$('rematchBtn'), toast:$('toast')
};

const COLORS = {pink:0xf50073, blue:0x28a9e8, yellow:0xffe61f};
const CSS_COLORS = {pink:'#f50073', blue:'#28a9e8', yellow:'#ffe61f'};
let mode = null;
let room = null;
let myIndex = null;
let solo = null;
let settling = false;
let dragging = null;
let secondaryRotate = null;
let rotationQuarter = 0;
let rotationYawOffset = 0;
let rotationPitch = 0;
let cardGesture = null;
let suppressCardClickUntil = 0;
let toastTimer = null;
let effectTimer = null;
let lastEffectKey = '';
let audioCtx = null;
let soundOn = localStorage.getItem('wonkySound') !== 'off';
let playerId = localStorage.getItem('wonkyPlayerId');
if (!playerId) {
  playerId = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random();
  localStorage.setItem('wonkyPlayerId', playerId);
}
const socket = io({reconnection:true,reconnectionDelay:400,reconnectionDelayMax:2200});

function setSoundIcon(){ el.soundBtn.textContent=soundOn?'\u266A':'\u00D7'; }
setSoundIcon();
function beep(kind='tap') {
  if (!soundOn) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain(), now=audioCtx.currentTime;
    const map={tap:[280,.045,.035],card:[520,.11,.045],drag:[360,.04,.025],drop:[135,.08,.07],good:[690,.15,.05],boom:[70,.35,.12],win:[840,.28,.07],skip:[420,.16,.05]};
    const [f,d,v]=map[kind]||map.tap;
    o.type=kind==='boom'?'sawtooth':'sine'; o.frequency.setValueAtTime(f,now);
    if(kind==='card')o.frequency.exponentialRampToValueAtTime(850,now+d);
    if(kind==='boom')o.frequency.exponentialRampToValueAtTime(38,now+d);
    if(kind==='win')o.frequency.exponentialRampToValueAtTime(1200,now+d);
    g.gain.setValueAtTime(v,now); g.gain.exponentialRampToValueAtTime(.001,now+d);
    o.connect(g); g.connect(audioCtx.destination); o.start(now); o.stop(now+d);
  } catch {}
}
function haptic(pattern=18){ try{ navigator.vibrate && navigator.vibrate(pattern); }catch{} }
function toast(text){ clearTimeout(toastTimer); el.toast.textContent=text; el.toast.classList.remove('hidden'); toastTimer=setTimeout(()=>el.toast.classList.add('hidden'),1700); }
function showEffect(text){ clearTimeout(effectTimer); el.effectBanner.textContent=text; el.effectBanner.classList.remove('hidden'); effectTimer=setTimeout(()=>el.effectBanner.classList.add('hidden'),1500); }
function setError(text=''){ el.lobbyError.textContent=text; el.lobbyError.classList.toggle('hidden',!text); }
function showOnly(which){ el.home.classList.toggle('hidden',which!=='home'); el.lobby.classList.toggle('hidden',which!=='lobby'); el.game.classList.toggle('hidden',which!=='game'); el.homeBtn.classList.toggle('hidden',which==='home'); if(which==='game')setTimeout(()=>towerWorld.resize(),30); }

function makeCubes(){
  const raw=[
    ['ps','pink','small',1.42,1.08,1.28,-.16,.07,-.08,.04],['pm','pink','medium',1.76,1.23,1.56,.13,-.08,.08,-.05],['pl','pink','large',2.12,1.42,1.82,-.12,.10,-.10,.06],
    ['bs','blue','small',1.38,1.11,1.31,.15,-.05,.08,.04],['bm','blue','medium',1.72,1.26,1.60,-.14,.09,-.07,-.06],['bl','blue','large',2.08,1.46,1.86,.11,-.10,.10,-.04],
    ['ys','yellow','small',1.45,1.06,1.25,-.13,-.07,-.06,.05],['ym','yellow','medium',1.79,1.20,1.53,.12,.08,.07,-.05],['yl','yellow','large',2.15,1.40,1.79,-.10,-.09,-.09,-.05]
  ];
  return raw.map(([id,color,size,w,h,d,slantX,slantZ,biasX,biasZ],index)=>({id,color,size,w,h,d,slantX,slantZ,biasX,biasZ,wobbleSeed:(index*37+11)%97,used:false}));
}
function shuffle(items){for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]]}return items}
let soloCardSerial=0;
function sCard(type,color='any',size='any'){return{id:`s-${Date.now().toString(36)}-${soloCardSerial++}`,type,color,size}}
function makeSoloDeck(){
  const a=[],colors=['pink','blue','yellow'],sizes=['small','medium','large'];
  for(let copy=0;copy<2;copy++)for(const c of colors)for(const s of sizes)a.push(sCard('stack',c,s));
  for(const c of colors)a.push(sCard('stack',c,'any'));
  for(const s of sizes)a.push(sCard('stack','any',s));
  for(let i=0;i<4;i++)a.push(sCard('wild'));
  return shuffle(a);
}
function isStackCard(c){return !!c&&['stack','wild','combo_disrupt','combo_skip'].includes(c.type)}
function cardAllows(cube,card){if(!cube||!card||cube.used||!isStackCard(card))return false;if(['wild','combo_disrupt','combo_skip'].includes(card.type))return true;return(card.color==='any'||cube.color===card.color)&&(card.size==='any'||cube.size===card.size)}
function cardPlayable(state,card){if(!card)return false;if(card.type==='pass'||card.type==='skip')return true;return state.cubes.some(c=>cardAllows(c,card))}
function cubeById(state,id){return state?.cubes?.find(c=>c.id===id)||null}
function drawSoloCard(state){if(!state.deck.length&&state.discard.length)state.deck=shuffle(state.discard.splice(0));return state.deck.shift()||sCard('wild')}
function fillSoloHand(state){while(state.hand.length<4)state.hand.push(drawSoloCard(state))}
function ensureSoloPlayable(state){fillSoloHand(state);let guard=0;while(!state.hand.some(c=>cardPlayable(state,c))&&guard++<20){const dead=state.hand.findIndex(c=>!cardPlayable(state,c));if(dead<0)break;state.discard.push(state.hand[dead]);state.hand.splice(dead,1,drawSoloCard(state))}if(!state.hand.some(c=>cardPlayable(state,c)))state.hand.splice(0,1,sCard('wild'))}
function freshSolo(){const s={phase:'choose_card',activeCard:null,cubes:makeCubes(),stack:[],deck:makeSoloDeck(),discard:[],hand:[],score:0,combo:1,bravery:0,message:'Pick one of four cards.',completed:false,collapsed:false};fillSoloHand(s);ensureSoloPlayable(s);return s}
function saveSolo(){if(mode==='solo'&&solo)localStorage.setItem('wonkySoloStateV3',JSON.stringify(solo))}
function loadSolo(){try{const s=JSON.parse(localStorage.getItem('wonkySoloStateV3')||'null');if(s&&s.cubes?.length===9&&Array.isArray(s.hand))return s}catch{}return null}

class TowerWorld {
  constructor(canvas){
    this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.renderer.toneMapping=THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=1.08;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=THREE.PCFSoftShadowMap;
    this.scene=new THREE.Scene();
    this.camera=new THREE.PerspectiveCamera(33,1,.1,100);
    this.camera.position.set(5.5,5.3,8.2);
    this.camera.lookAt(0,2.1,0);
    this.meshes=new Map();
    this.bodies=new Map();
    this.preview=null;
    this.landingGuide=null;
    this.landingFootprint=null;
    this.previewDrop=null;
    this.simulating=false;
    this.simResolve=null;
    this.simOrder=[];
    this.simCubes=[];
    this.simEnd=0;
    this.lastTick=performance.now();
    this.lastCount=null;
    this.onCount=null;
    this.world=new CANNON.World({gravity:new CANNON.Vec3(0,-9.82,0)});
    this.world.allowSleep=true;
    this.world.solver.iterations=14;
    this.blockMat=new CANNON.Material('block');
    this.groundMat=new CANNON.Material('ground');
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.blockMat,this.blockMat,{friction:.58,restitution:.015,contactEquationStiffness:1e8}));
    this.world.addContactMaterial(new CANNON.ContactMaterial(this.blockMat,this.groundMat,{friction:.72,restitution:.01,contactEquationStiffness:1e8}));
    this.groundBody=new CANNON.Body({mass:0,material:this.groundMat,shape:new CANNON.Box(new CANNON.Vec3(3.15,.16,2.6)),position:new CANNON.Vec3(0,-.16,0)});
    this.world.addBody(this.groundBody);
    this.setupScene();
    new ResizeObserver(()=>this.resize()).observe(canvas.parentElement);
    requestAnimationFrame(t=>this.loop(t));
  }
  setupScene(){
    const hemi=new THREE.HemisphereLight(0xffffff,0x6b4e75,2.0);this.scene.add(hemi);
    const key=new THREE.DirectionalLight(0xffffff,3.0);key.position.set(4.5,8,5);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-5;key.shadow.camera.right=5;key.shadow.camera.top=10;key.shadow.camera.bottom=-2;this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xffb4de,1.3);fill.position.set(-5,4,2);this.scene.add(fill);
    const platform=new THREE.Mesh(new THREE.CylinderGeometry(3.12,3.25,.34,64),new THREE.MeshStandardMaterial({color:0x9b5c2d,roughness:.62,metalness:.02}));platform.position.y=-.18;platform.receiveShadow=true;this.scene.add(platform);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(2.82,.055,12,64),new THREE.MeshStandardMaterial({color:0xd28b48,roughness:.5}));rim.rotation.x=Math.PI/2;rim.position.y=.005;this.scene.add(rim);
    const shadow=new THREE.Mesh(new THREE.CircleGeometry(3.1,64),new THREE.ShadowMaterial({opacity:.20}));shadow.rotation.x=-Math.PI/2;shadow.position.y=.01;shadow.receiveShadow=true;this.scene.add(shadow);
  }
  resize(){
    const r=this.canvas.parentElement.getBoundingClientRect();if(!r.width||!r.height)return;
    this.renderer.setSize(r.width,r.height,false);this.camera.aspect=r.width/r.height;this.camera.updateProjectionMatrix();
  }
  cubeGeometry(c){
    const g=new RoundedBoxGeometry(c.w,c.h,c.d,4,Math.min(.14,c.h*.11));
    const p=g.attributes.position;
    const curveSign=(c.wobbleSeed%2?1:-1);
    for(let i=0;i<p.count;i++){
      const x=p.getX(i),y=p.getY(i),z=p.getZ(i),yn=y/Math.max(.001,c.h);
      const bow=Math.sin(((x/c.w)+.5)*Math.PI)*Math.sin(((z/c.d)+.5)*Math.PI)*curveSign*.035;
      p.setXYZ(i,x+yn*c.slantX,z?y+bow:y+bow,z+yn*c.slantZ);
    }
    p.needsUpdate=true;g.computeVertexNormals();return g;
  }
  cubeMesh(c,opacity=1){
    const mat=new THREE.MeshStandardMaterial({color:COLORS[c.color],roughness:.54,metalness:.025,transparent:opacity<1,opacity});
    const mesh=new THREE.Mesh(this.cubeGeometry(c),mat);mesh.castShadow=true;mesh.receiveShadow=true;return mesh;
  }
  clearStack(){
    this.cancelPreview();
    for(const m of this.meshes.values()){this.scene.remove(m);m.geometry.dispose();m.material.dispose()}this.meshes.clear();
    for(const b of this.bodies.values())this.world.removeBody(b);this.bodies.clear();
  }
  loadState(state){
    if(this.simulating||!state)return;
    this.clearStack();
    for(const t of state.stack||[]){const c=cubeById(state,t.cubeId);if(!c)continue;const m=this.cubeMesh(c);m.position.fromArray(t.position||[0,c.h/2,0]);m.quaternion.fromArray(t.quaternion||[0,0,0,1]);this.scene.add(m);this.meshes.set(c.id,m)}
    this.frameCamera(state);
  }
  towerBounds(state,extraCube=null){
    let minY=0,maxY=.35,maxX=1.7,maxZ=1.45;
    for(const t of state?.stack||[]){
      const c=cubeById(state,t.cubeId);if(!c)continue;
      const y=t.position?.[1]??c.h/2;
      const x=Math.abs(t.position?.[0]||0),z=Math.abs(t.position?.[2]||0);
      maxY=Math.max(maxY,y+c.h*.72);minY=Math.min(minY,y-c.h*.72);
      maxX=Math.max(maxX,x+Math.max(c.w,c.d)*.72);
      maxZ=Math.max(maxZ,z+Math.max(c.w,c.d)*.72);
    }
    if(extraCube){maxY=Math.max(maxY,this.topY(state)+Math.max(extraCube.w,extraCube.h,extraCube.d)*.9)}
    return{minY,maxY,maxX,maxZ,height:Math.max(1.5,maxY-minY)};
  }
  setCameraForBounds(state,{placement=false,extraCube=null}={}){
    const b=this.towerBounds(state,extraCube);
    const aspect=Math.max(.55,this.camera.aspect||1);
    const fov=placement?31:34;
    this.camera.fov=fov;this.camera.updateProjectionMatrix();
    const vfov=THREE.MathUtils.degToRad(fov);
    const hfov=2*Math.atan(Math.tan(vfov/2)*aspect);
    // Fit both height and width, with extra breathing room for shadows, wobble,
    // and the block currently under the player's finger.
    const targetY=(b.minY+b.maxY)/2+Math.min(.28,b.height*.04);
    const needV=(b.height*.61)/Math.tan(vfov/2);
    const needH=(b.maxX*1.12)/Math.tan(hfov/2);
    const needZ=(b.maxZ*1.15)/Math.tan(hfov/2);
    const distance=Math.max(5.4,needV,needH,needZ)+(placement?.45:.75);
    const side=placement?Math.min(3.05,distance*.42):Math.min(4.6,distance*.48);
    const rise=placement?Math.min(2.35,distance*.31):Math.min(3.4,distance*.34);
    this.camera.position.set(side,targetY+rise,distance);
    this.camera.lookAt(0,targetY,0);
  }
  frameCamera(state){this.setCameraForBounds(state,{placement:false})}
  focusPlacement(state){this.setCameraForBounds(state,{placement:true,extraCube:this.preview?.cube||null})}
  topY(state){let top=0;for(const t of state?.stack||[]){const c=cubeById(state,t.cubeId);if(c)top=Math.max(top,(t.position?.[1]||0)+c.h*.58)}return top}
  pointerToWorld(clientX,clientY,planeY){
    const r=this.canvas.getBoundingClientRect();
    // Do NOT clamp. The pointer ray should continue naturally even while the
    // finger is just outside the canvas so the block never "snaps" at an edge.
    const ndc=new THREE.Vector2(
      ((clientX-r.left)/r.width)*2-1,
      -(((clientY-r.top)/r.height)*2-1)
    );
    const raycaster=new THREE.Raycaster();
    raycaster.setFromCamera(ndc,this.camera);
    const plane=new THREE.Plane(new THREE.Vector3(0,1,0),-planeY);
    const hit=new THREE.Vector3();
    return raycaster.ray.intersectPlane(plane,hit)?hit:null;
  }
  pointerRay(clientX,clientY){
    const r=this.canvas.getBoundingClientRect();
    const ndc=new THREE.Vector2(((clientX-r.left)/r.width)*2-1,-(((clientY-r.top)/r.height)*2-1));
    const raycaster=new THREE.Raycaster();raycaster.setFromCamera(ndc,this.camera);return raycaster.ray;
  }
  supportSurface(state){
    const stack=state?.stack||[];
    if(!stack.length)return{point:new THREE.Vector3(0,.018,0),normal:new THREE.Vector3(0,1,0),support:null};
    const top=stack[stack.length-1],c=cubeById(state,top.cubeId);
    if(!c)return{point:new THREE.Vector3(0,this.topY(state),0),normal:new THREE.Vector3(0,1,0),support:null};
    const q=new THREE.Quaternion(...(top.quaternion||[0,0,0,1]));
    const axes=[
      {v:new THREE.Vector3(1,0,0).applyQuaternion(q),half:c.w*.47},
      {v:new THREE.Vector3(0,1,0).applyQuaternion(q),half:c.h*.47},
      {v:new THREE.Vector3(0,0,1).applyQuaternion(q),half:c.d*.47}
    ];
    let best=0;for(let i=1;i<3;i++)if(Math.abs(axes[i].v.y)>Math.abs(axes[best].v.y))best=i;
    const normal=axes[best].v.clone().normalize();if(normal.y<0)normal.multiplyScalar(-1);
    const center=new THREE.Vector3(...(top.position||[0,c.h/2,0]));
    const point=center.clone().addScaledVector(normal,axes[best].half+.014);
    return{point,normal,support:{transform:top,cube:c,axis:best}};
  }
  pointerToSupport(state,clientX,clientY){
    const surface=this.supportSurface(state),ray=this.pointerRay(clientX,clientY);
    // Prefer the actual rendered surface of the block underneath. That makes
    // the marker feel painted onto the block instead of floating on a helper plane.
    const supportId=surface.support?.transform?.cubeId;
    const mesh=supportId?this.meshes.get(supportId):null;
    if(mesh){
      mesh.updateMatrixWorld(true);
      const rc=new THREE.Raycaster(ray.origin,ray.direction,.001,100);
      const hits=rc.intersectObject(mesh,false);
      const normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
      for(const h of hits){
        if(!h.face)continue;
        const worldNormal=h.face.normal.clone().applyMatrix3(normalMatrix).normalize();
        if(worldNormal.dot(surface.normal)>.42)return{...surface,hit:h.point.clone(),normal:worldNormal,mesh};
      }
    }
    const plane=new THREE.Plane().setFromNormalAndCoplanarPoint(surface.normal,surface.point);
    const hit=new THREE.Vector3();
    return ray.intersectPlane(plane,hit)?{...surface,hit,mesh}:null;
  }
  projectMarkerPoint(surface,point){
    if(!surface.mesh)return point.clone().addScaledVector(surface.normal,.018);
    const normal=surface.normal.clone().normalize();
    const origin=point.clone().addScaledVector(normal,1.5);
    const rc=new THREE.Raycaster(origin,normal.clone().multiplyScalar(-1),.001,3.5);
    const hits=rc.intersectObject(surface.mesh,false);
    if(!hits.length)return point.clone().addScaledVector(normal,.018);
    const normalMatrix=new THREE.Matrix3().getNormalMatrix(surface.mesh.matrixWorld);
    for(const h of hits){
      if(!h.face)continue;
      const n=h.face.normal.clone().applyMatrix3(normalMatrix).normalize();
      if(n.dot(normal)>.30)return h.point.clone().addScaledVector(n,.018);
    }
    return hits[0].point.clone().addScaledVector(normal,.018);
  }
  blockExtentAlongNormal(c,q,normal){
    const axes=[
      {v:new THREE.Vector3(1,0,0).applyQuaternion(q),half:c.w*.47},
      {v:new THREE.Vector3(0,1,0).applyQuaternion(q),half:c.h*.47},
      {v:new THREE.Vector3(0,0,1).applyQuaternion(q),half:c.d*.47}
    ];
    return axes.reduce((sum,a)=>sum+Math.abs(a.v.dot(normal))*a.half,0);
  }
  previewQuat(c,quarter,yawOffset=0,pitch=0){
    const q=new THREE.Quaternion();
    q.setFromEuler(new THREE.Euler(c.slantZ*.08+pitch,quarter*Math.PI/2+yawOffset,-c.slantX*.08,'XYZ'));
    return q;
  }
  makeLandingFootprint(){
    const group=new THREE.Group();
    const fillGeom=new THREE.BufferGeometry();
    fillGeom.setAttribute('position',new THREE.Float32BufferAttribute(new Array(18).fill(0),3));
    const fillMat=new THREE.MeshBasicMaterial({color:0x15113f,transparent:true,opacity:.075,depthTest:false,depthWrite:false,side:THREE.DoubleSide});
    const fill=new THREE.Mesh(fillGeom,fillMat);fill.renderOrder=47;group.add(fill);

    const lineGeom=new THREE.BufferGeometry();
    lineGeom.setAttribute('position',new THREE.Float32BufferAttribute(new Array(12).fill(0),3));
    const lineMat=new THREE.LineBasicMaterial({color:0x15113f,transparent:true,opacity:.88,depthTest:false,depthWrite:false});
    const line=new THREE.LineLoop(lineGeom,lineMat);line.renderOrder=49;group.add(line);
    group.userData.fill=fill;group.userData.line=line;
    return group;
  }
  updateLandingFootprint(state,c,contact,q,surface){
    if(!this.landingFootprint)return;
    const normal=surface.normal;
    const axes=[
      {v:new THREE.Vector3(1,0,0).applyQuaternion(q),size:c.w},
      {v:new THREE.Vector3(0,1,0).applyQuaternion(q),size:c.h},
      {v:new THREE.Vector3(0,0,1).applyQuaternion(q),size:c.d}
    ];
    // The placed block axis most aligned with the support normal is the face
    // touching the support. The other two axes define the footprint shape.
    let faceAxis=0;for(let i=1;i<3;i++)if(Math.abs(axes[i].v.dot(normal))>Math.abs(axes[faceAxis].v.dot(normal)))faceAxis=i;
    const faceAxes=axes.filter((_,i)=>i!==faceAxis);
    const project=(axis,fallback)=>{
      const v=axis.v.clone().addScaledVector(normal,-axis.v.dot(normal));
      if(v.lengthSq()<.0001)v.copy(fallback);
      return v.normalize();
    };
    let fallback=new THREE.Vector3(1,0,0).addScaledVector(normal,-normal.x).normalize();
    if(!Number.isFinite(fallback.x))fallback=new THREE.Vector3(1,0,0);
    const u=project(faceAxes[0],fallback);
    let v=normal.clone().cross(u).normalize();
    if(v.dot(faceAxes[1].v)<0)v.multiplyScalar(-1);
    const hu=faceAxes[0].size*.47,hv=faceAxes[1].size*.47;
    const center=contact.clone();
    const rawCorners=[
      center.clone().addScaledVector(u,-hu).addScaledVector(v,-hv),
      center.clone().addScaledVector(u, hu).addScaledVector(v,-hv),
      center.clone().addScaledVector(u, hu).addScaledVector(v, hv),
      center.clone().addScaledVector(u,-hu).addScaledVector(v, hv)
    ];
    // Each corner gets re-projected onto the real wonky mesh underneath. So if
    // the support face is rotated/slanted/curved, the outline follows it.
    const corners=rawCorners.map(pt=>this.projectMarkerPoint(surface,pt));
    const lp=this.landingFootprint.userData.line.geometry.attributes.position;
    corners.forEach((pt,i)=>lp.setXYZ(i,pt.x,pt.y,pt.z));lp.needsUpdate=true;
    const fp=this.landingFootprint.userData.fill.geometry.attributes.position;
    const tris=[corners[0],corners[1],corners[2],corners[0],corners[2],corners[3]];
    tris.forEach((pt,i)=>fp.setXYZ(i,pt.x,pt.y,pt.z));fp.needsUpdate=true;
    this.landingFootprint.visible=true;
  }
  beginPreview(c,state,clientX,clientY,quarter,yawOffset=0,pitch=0){
    this.cancelPreview();
    const m=this.cubeMesh(c,.74);m.material.emissive=new THREE.Color(COLORS[c.color]);m.material.emissiveIntensity=.15;
    this.scene.add(m);
    this.landingFootprint=this.makeLandingFootprint();this.scene.add(this.landingFootprint);
    this.preview={mesh:m,cube:c,quarter,yawOffset,pitch};
    this.movePreview(state,clientX,clientY,quarter,yawOffset,pitch);beep('drag');
  }
  movePreview(state,clientX,clientY,quarter=this.preview?.quarter||0,yawOffset=this.preview?.yawOffset||0,pitch=this.preview?.pitch||0){
    if(!this.preview)return;
    const c=this.preview.cube;
    this.preview.quarter=quarter;this.preview.yawOffset=yawOffset;this.preview.pitch=pitch;
    this.setCameraForBounds(state,{placement:true,extraCube:c});
    const surfaceHit=this.pointerToSupport(state,clientX,clientY);
    if(!surfaceHit)return;
    const q=this.previewQuat(c,quarter,yawOffset,pitch);
    const extent=this.blockExtentAlongNormal(c,q,surfaceHit.normal);
    const previewPos=surfaceHit.hit.clone().addScaledVector(surfaceHit.normal,extent+.46);
    this.preview.mesh.position.copy(previewPos);
    this.preview.mesh.quaternion.copy(q);
    this.updateLandingFootprint(state,c,surfaceHit.hit,q,surfaceHit);
    this.previewDrop={x:surfaceHit.hit.x,y:surfaceHit.hit.y,z:surfaceHit.hit.z,normal:[surfaceHit.normal.x,surfaceHit.normal.y,surfaceHit.normal.z],quarter,yawOffset,pitch};
  }
  cancelPreview(){
    if(this.preview){this.scene.remove(this.preview.mesh);this.preview.mesh.geometry.dispose();this.preview.mesh.material.dispose();this.preview=null}
    if(this.landingGuide){
      this.scene.remove(this.landingGuide);
      this.landingGuide.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose()});
      this.landingGuide=null;
    }
    if(this.landingFootprint){this.scene.remove(this.landingFootprint);this.landingFootprint.traverse(o=>{if(o.geometry)o.geometry.dispose();if(o.material)o.material.dispose()});this.landingFootprint=null}
    this.previewDrop=null;
  }
  bodyFor(c,mass){const body=new CANNON.Body({mass,material:this.blockMat,allowSleep:true,sleepSpeedLimit:.08,sleepTimeLimit:.6});const shape=new CANNON.Box(new CANNON.Vec3(c.w*.47,c.h*.47,c.d*.47));body.addShape(shape,new CANNON.Vec3(c.biasX,0,c.biasZ));body.linearDamping=.12;body.angularDamping=.18;return body}
  addDynamic(c,transform){const m=this.cubeMesh(c);m.position.fromArray(transform.position);m.quaternion.fromArray(transform.quaternion);this.scene.add(m);this.meshes.set(c.id,m);const mass=Math.max(.6,c.w*c.h*c.d*.52);const b=this.bodyFor(c,mass);b.position.set(...transform.position);b.quaternion.set(...transform.quaternion);this.world.addBody(b);this.bodies.set(c.id,b);return b}
  async dropAndSettle(state,cube,drop,onCount){
    if(this.simulating)throw new Error('Already settling');
    this.cancelPreview();this.clearStack();
    const order=[];
    for(const t of state.stack||[]){const c=cubeById(state,t.cubeId);if(!c)continue;this.addDynamic(c,t);order.push(c.id)}
    const tq=this.previewQuat(cube,drop.quarter||0,drop.yawOffset||0,drop.pitch||0);
    const normal=new THREE.Vector3(...(drop.normal||[0,1,0])).normalize();
    const contact=new THREE.Vector3(Number(drop.x)||0,Number(drop.y)||this.topY(state),Number(drop.z)||0);
    const extent=this.blockExtentAlongNormal(cube,tq,normal);
    const start=contact.clone().addScaledVector(normal,extent+.58);
    const transform={position:[start.x,start.y,start.z],quaternion:[tq.x,tq.y,tq.z,tq.w]};
    const body=this.addDynamic(cube,transform);body.velocity.set(0,-.22,0);body.angularVelocity.set((cube.slantZ||0)*.05,0,(cube.slantX||0)*-.05);order.push(cube.id);
    this.simulating=true;this.simOrder=order;this.simCubes=state.cubes;this.simEnd=performance.now()+3050;this.lastCount=null;this.onCount=onCount;this.frameCamera({...state,stack:[...(state.stack||[]),transform]});
    return new Promise(resolve=>{this.simResolve=resolve});
  }
  finishSimulation(){
    const transforms=this.simOrder.map(id=>{const b=this.bodies.get(id);return b?{cubeId:id,position:[b.position.x,b.position.y,b.position.z],quaternion:[b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w]}:null}).filter(Boolean);
    const collapsed=!this.isStanding();this.simulating=false;const resolve=this.simResolve;this.simResolve=null;this.onCount=null;this.lastCount=null;if(resolve)resolve({collapsed,transforms});
  }
  worldHalfExtents(c,b){
    const q=new THREE.Quaternion(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);
    const m=new THREE.Matrix4().makeRotationFromQuaternion(q).elements;
    const hx=c.w*.47,hy=c.h*.47,hz=c.d*.47;
    return {
      x:Math.abs(m[0])*hx+Math.abs(m[4])*hy+Math.abs(m[8])*hz,
      y:Math.abs(m[1])*hx+Math.abs(m[5])*hy+Math.abs(m[9])*hz,
      z:Math.abs(m[2])*hx+Math.abs(m[6])*hy+Math.abs(m[10])*hz
    };
  }
  isStanding(){
    let previous=null,previousCube=null,previousExt=null;
    for(let i=0;i<this.simOrder.length;i++){
      const id=this.simOrder[i],b=this.bodies.get(id),c=this.simCubes.find(x=>x.id===id);if(!b||!c)return false;
      const ext=this.worldHalfExtents(c,b);
      if(Math.abs(b.position.x)>3.35||Math.abs(b.position.z)>2.85||b.position.y<.10)return false;
      // A block is allowed to rest on ANY of its six faces. Check whether at
      // least one local axis is substantially vertical instead of assuming its
      // original Y face must point upward.
      const q=new THREE.Quaternion(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w);
      const axes=[new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,1)].map(v=>v.applyQuaternion(q));
      const faceAlignment=Math.max(...axes.map(v=>Math.abs(v.y)));
      if(faceAlignment<.60)return false;
      if(previous&&previousCube&&previousExt){
        const dx=Math.abs(b.position.x-previous.position.x),dz=Math.abs(b.position.z-previous.position.z);
        const overlapX=(previousExt.x+ext.x)-dx,overlapZ=(previousExt.z+ext.z)-dz;
        if(overlapX<.08||overlapZ<.08)return false;
        if(b.position.y<=previous.position.y+.08)return false;
      }
      previous=b;previousCube=c;previousExt=ext;
    }
    return true;
  }
  riskFromTransforms(state,transforms){
    let risk=0,prev=null;for(const t of transforms){const c=cubeById(state,t.cubeId);if(!c)continue;if(prev){const pc=cubeById(state,prev.cubeId);if(pc){risk+=Math.hypot(t.position[0]-prev.position[0],t.position[2]-prev.position[2])/(Math.max(pc.w,pc.d)+.01)*28}}const q=new THREE.Quaternion(...t.quaternion);const up=new THREE.Vector3(0,1,0).applyQuaternion(q);risk+=(1-Math.max(0,up.y))*35;prev=t}return Math.max(0,Math.min(100,Math.round(risk)))}
  syncBodies(){for(const[id,b]of this.bodies){const m=this.meshes.get(id);if(m){m.position.set(b.position.x,b.position.y,b.position.z);m.quaternion.set(b.quaternion.x,b.quaternion.y,b.quaternion.z,b.quaternion.w)}}}
  loop(now){
    const dt=Math.min(.04,Math.max(.001,(now-this.lastTick)/1000));this.lastTick=now;
    if(this.simulating){this.world.step(1/60,dt,5);this.syncBodies();const left=Math.max(0,this.simEnd-now),count=Math.max(1,Math.ceil(left/1000));if(count!==this.lastCount&&this.onCount){this.lastCount=count;this.onCount(count)}if(now>=this.simEnd)this.finishSimulation()}
    this.renderer.render(this.scene,this.camera);requestAnimationFrame(t=>this.loop(t));
  }
}

const towerWorld=new TowerWorld(el.towerCanvas);

function activeState(){return mode==='solo'?solo:room?.state||null}
function activeHand(){return mode==='solo'?(solo?.hand||[]):(room?.myHand||[])}
function isMyTurn(state){return mode==='solo'||state?.turn===myIndex}
function stackCardText(c){if(!c)return'';if(c.type==='wild')return'ANY BLOCK';if(c.type==='combo_disrupt')return'ANY BLOCK + SCRAMBLE';if(c.type==='combo_skip')return'ANY BLOCK + SKIP';const color=c.color==='any'?'ANY':c.color.toUpperCase();const size=c.size==='any'?'ANY SIZE':c.size.toUpperCase();return`${color} ${size}`}
function cardMeta(c){
  if(c.type==='pass')return{title:'PASS',sub:'No block. End your turn.',kind:'action',icon:'\u21AA'};
  if(c.type==='skip')return{title:'SKIP',sub:'Skip rival. Go again.',kind:'action',icon:'\u00BB'};
  if(c.type==='combo_disrupt')return{title:'SCRAMBLE',sub:'Stack any + reroll rival card.',kind:'combo',icon:'\u26A1'};
  if(c.type==='combo_skip')return{title:'POWER PLAY',sub:'Stack any + skip rival.',kind:'combo',icon:'\u00BB'};
  if(c.type==='wild')return{title:'WILD',sub:'Stack any block.',kind:'combo',icon:'W'};
  const title=`${c.color==='any'?'ANY':c.color.toUpperCase()} ${c.size==='any'?'SIZE':c.size.toUpperCase()}`;
  const sub=c.color==='any'?`Any color ${c.size}`:c.size==='any'?`Any ${c.color} size`:'Stack this block';
  return{title,sub,kind:'stack',icon:''};
}

function cardVisual(c,m){
  const exact=c.type==='stack'&&c.color!=='any'&&c.size!=='any';
  let theme='rainbow',eyebrow=m.title,tag='',footer=m.sub,art='blocks';
  if(exact){theme=c.color;eyebrow=c.color.toUpperCase();tag=c.size.toUpperCase();footer=`STACK A ${c.color.toUpperCase()} ${c.size.toUpperCase()} BLOCK`;art='single'}
  else if(c.type==='stack'&&c.color!=='any'){theme=c.color;eyebrow=c.color.toUpperCase();tag='ANY SIZE';footer=`STACK ANY ${c.color.toUpperCase()} BLOCK`;art='sizes'}
  else if(c.type==='stack'&&c.size!=='any'){theme='rainbow';eyebrow='ANY COLOR';tag=c.size.toUpperCase();footer=`STACK ANY ${c.size.toUpperCase()} BLOCK`;art='trio'}
  else if(c.type==='wild'){theme='rainbow';eyebrow='ANY BLOCK';footer='STACK ANY COLOR, ANY SIZE!';art='trio'}
  else if(c.type==='pass'){theme='pass';eyebrow='PASS';footer='PASS YOUR TURN';art='pass'}
  else if(c.type==='skip'){theme='skip';eyebrow='SKIP';footer='SKIP THE NEXT PLAYER';art='skip'}
  else if(c.type==='combo_disrupt'){theme='scramble';eyebrow='SCRAMBLE';footer='MIX UP THE TOWER!';art='scramble'}
  else if(c.type==='combo_skip'){theme='power';eyebrow='POWER PLAY';footer='TAKE AN EXTRA TURN!';art='power'}
  const colorBlock=theme==='pink'?'pink':theme==='blue'?'blue':theme==='yellow'?'yellow':'pink';
  let artwork='';
  if(art==='single') artwork=`<span class="art-block ${colorBlock} single"></span>`;
  else if(art==='sizes') artwork=`<span class="art-block ${colorBlock} a-small"></span><span class="art-block ${colorBlock} a-medium"></span><span class="art-block ${colorBlock} a-large"></span>`;
  else if(art==='trio') artwork='<span class="art-block blue trio-a"></span><span class="art-block pink trio-b"></span><span class="art-block yellow trio-c"></span>';
  else if(art==='pass') artwork='<span class="card-glyph sleepy">Zzz</span><span class="art-block blue mascot"></span>';
  else if(art==='skip') artwork='<span class="card-glyph arrows">&#187;</span><span class="art-block pink mascot dash"></span>';
  else if(art==='scramble') artwork='<span class="card-glyph swirl">&#8635;</span><span class="art-block blue trio-a"></span><span class="art-block pink trio-b"></span><span class="art-block yellow trio-c"></span>';
  else if(art==='power') artwork='<span class="card-glyph crown">&#9813;</span><span class="art-block blue power-top"></span><span class="art-block pink power-left"></span><span class="art-block yellow power-right"></span>';
  return{theme,html:`<span class="card-face"><span class="card-top"><b>${eyebrow}</b>${tag?`<em>${tag}</em>`:''}</span><span class="card-art">${artwork}</span><span class="card-footer">${footer}</span></span>`};
}

function renderHand(state){
  const hand=activeHand();el.cardHand.innerHTML='';el.handCount.textContent=`${hand.length} CARDS`;
  const canChoose=isMyTurn(state)&&state.phase==='choose_card'&&!settling;
  hand.forEach((c,i)=>{
    const m=cardMeta(c),v=cardVisual(c,m),playable=cardPlayable(state,c),b=document.createElement('button');
    b.type='button';b.className=`hand-card art-${v.theme} ${m.kind}${canChoose&&playable?' playable':''}${(!canChoose||!playable)?' disabled':''}`;b.style.setProperty('--card-tilt',`${[-2,1,-1,2][i]||0}deg`);
    b.disabled=!canChoose||!playable;
    b.dataset.cardIndex=String(i);b._wonkyCard=c;
    b.innerHTML=v.html;
    if(canChoose&&playable)b.addEventListener('pointerdown',ev=>startCardGesture(ev,b,c));
    b.addEventListener('click',ev=>{if(ev.detail===0&&Date.now()>suppressCardClickUntil)playCard(c)});
    el.cardHand.appendChild(b);
  });
}


function clearCardGestureClasses(){
  el.cardHand.querySelectorAll('.gesture-hover,.reading').forEach(n=>n.classList.remove('gesture-hover','reading'));
}
function cardUnderPoint(x,y){
  const n=document.elementFromPoint(x,y)?.closest?.('.hand-card');
  return n&&el.cardHand.contains(n)&&!n.disabled?n:null;
}
function updateCardGestureTarget(node){
  if(!cardGesture||!node)return;
  const prev=cardGesture.node;
  if(prev!==node){
    prev?.classList.remove('gesture-hover','reading');
    cardGesture.node=node;cardGesture.card=node._wonkyCard;cardGesture.changedAt=performance.now();
    node.classList.add('gesture-hover');haptic(7);
  }
  clearTimeout(cardGesture.readTimer);
  cardGesture.readTimer=setTimeout(()=>{
    if(cardGesture?.node===node){node.classList.add('reading');beep('tap')}
  },240);
}
function startCardGesture(ev,node,c){
  if(cardGesture||settling)return;ev.preventDefault();
  cardGesture={pointerId:ev.pointerId,node,card:c,changedAt:performance.now(),readTimer:null};
  try{node.setPointerCapture(ev.pointerId)}catch{}
  node.classList.add('gesture-hover');updateCardGestureTarget(node);
  window.addEventListener('pointermove',moveCardGesture,{passive:false});
  window.addEventListener('pointerup',endCardGesture,{once:true});
  window.addEventListener('pointercancel',cancelCardGesture,{once:true});
}
function moveCardGesture(ev){
  if(!cardGesture||ev.pointerId!==cardGesture.pointerId)return;ev.preventDefault();
  const node=cardUnderPoint(ev.clientX,ev.clientY);if(node)updateCardGestureTarget(node);
}
function finishCardGestureListeners(){window.removeEventListener('pointermove',moveCardGesture);window.removeEventListener('pointerup',endCardGesture);window.removeEventListener('pointercancel',cancelCardGesture)}
function cancelCardGesture(ev){
  if(!cardGesture||(!ev||ev.pointerId===cardGesture.pointerId)){
    if(cardGesture?.readTimer)clearTimeout(cardGesture.readTimer);cardGesture=null;clearCardGestureClasses();finishCardGestureListeners();
  }
}
function endCardGesture(ev){
  if(!cardGesture||ev.pointerId!==cardGesture.pointerId)return;
  const chosen=cardUnderPoint(ev.clientX,ev.clientY)||cardGesture.node;
  const card=chosen?._wonkyCard;
  if(cardGesture.readTimer)clearTimeout(cardGesture.readTimer);
  suppressCardClickUntil=Date.now()+350;cardGesture=null;clearCardGestureClasses();finishCardGestureListeners();
  if(card){beep('card');haptic(18);playCard(card)}
}

function renderDock(state){
  const canPlace=isMyTurn(state)&&state.phase==='placing'&&!!state.activeCard&&!settling;
  el.cubeRack.innerHTML='';el.rotateBtn.classList.toggle('hidden',!canPlace);
  if(canPlace){el.dockTitle.textContent='DRAG A BLOCK';el.dockHint.textContent=`${stackCardText(state.activeCard)} | ${rotationQuarter*90} deg`}
  else{el.dockTitle.textContent='BLOCKS';el.dockHint.textContent=state.phase==='choose_card'?(isMyTurn(state)?'Pick a card first':'Rival is choosing'):'Waiting for the tower'}
  state.cubes.forEach(cube=>{
    const b=document.createElement('button');b.type='button';const playable=canPlace&&cardAllows(cube,state.activeCard);b.className=`rack-cube${playable?' playable':''}${cube.used?' used':''}`;b.disabled=!playable;b.style.setProperty('--block-color',CSS_COLORS[cube.color]);b.style.setProperty('--mini-rot',`${(cube.slantX*20)+(cube.wobbleSeed%5-2)}deg`);b.innerHTML=`<span class="mini-block"></span><span class="size-dot">${cube.size[0].toUpperCase()}</span>`;
    if(playable)b.addEventListener('pointerdown',ev=>startBlockDrag(ev,cube,b));el.cubeRack.appendChild(b);
  });
}

function startBlockDrag(ev,cube,node){
  if(settling)return;const state=activeState();if(!state||state.phase!=='placing'||!cardAllows(cube,state.activeCard))return;
  ev.preventDefault();rotationYawOffset=0;rotationPitch=0;secondaryRotate=null;
  dragging={pointerId:ev.pointerId,cube,node,state,lastX:ev.clientX,lastY:ev.clientY};
  try{node.setPointerCapture(ev.pointerId)}catch{}node.classList.add('dragging');
  towerWorld.beginPreview(cube,state,ev.clientX,ev.clientY,rotationQuarter,rotationYawOffset,rotationPitch);haptic(14);
  window.addEventListener('pointermove',moveBlockDrag,{passive:false});window.addEventListener('pointerup',endBlockDrag);window.addEventListener('pointercancel',cancelBlockDrag);
}
function beginSecondaryRotate(ev){
  if(!dragging||ev.pointerId===dragging.pointerId||secondaryRotate)return;
  ev.preventDefault();secondaryRotate={pointerId:ev.pointerId,startX:ev.clientX,startY:ev.clientY,baseYaw:rotationYawOffset,basePitch:rotationPitch};
  try{ev.target.setPointerCapture?.(ev.pointerId)}catch{}haptic(8);
}
function moveBlockDrag(ev){
  if(!dragging)return;
  if(ev.pointerId===dragging.pointerId){
    ev.preventDefault();dragging.lastX=ev.clientX;dragging.lastY=ev.clientY;
    towerWorld.movePreview(activeState(),ev.clientX,ev.clientY,rotationQuarter,rotationYawOffset,rotationPitch);return;
  }
  if(secondaryRotate&&ev.pointerId===secondaryRotate.pointerId){
    ev.preventDefault();
    const dx=ev.clientX-secondaryRotate.startX,dy=ev.clientY-secondaryRotate.startY;
    const STEP=46;
    const yawSteps=Math.trunc(dx/STEP);
    const pitchSteps=Math.trunc(-dy/STEP);
    const nextYaw=secondaryRotate.baseYaw+yawSteps*(Math.PI/2);
    const nextPitch=secondaryRotate.basePitch+pitchSteps*(Math.PI/2);
    if(nextYaw!==rotationYawOffset||nextPitch!==rotationPitch){
      rotationYawOffset=nextYaw;rotationPitch=nextPitch;haptic(10);beep('tap');
    }
    towerWorld.movePreview(activeState(),dragging.lastX,dragging.lastY,rotationQuarter,rotationYawOffset,rotationPitch);
  }
}
function endSecondaryRotate(ev){if(secondaryRotate&&ev.pointerId===secondaryRotate.pointerId)secondaryRotate=null}
function cleanDragListeners(){window.removeEventListener('pointermove',moveBlockDrag);window.removeEventListener('pointerup',endBlockDrag);window.removeEventListener('pointercancel',cancelBlockDrag);secondaryRotate=null}
function cancelBlockDrag(ev){if(dragging&&(!ev||ev.pointerId===dragging.pointerId)){dragging.node?.classList.remove('dragging');dragging=null;towerWorld.cancelPreview();cleanDragListeners()}}
async function endBlockDrag(ev){
  if(!dragging||ev.pointerId!==dragging.pointerId)return;const d=dragging;dragging=null;d.node?.classList.remove('dragging');cleanDragListeners();
  const r=el.arenaShell.getBoundingClientRect();const inside=ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;
  const drop=towerWorld.previewDrop;if(!inside||!drop){towerWorld.cancelPreview();toast('Drag the block onto the tower area.');return}
  await settlePlacedBlock(d.cube,drop);
}

async function settlePlacedBlock(cube,drop){
  const state=activeState();if(!state||settling)return;settling=true;renderGame();el.settleCounter.classList.remove('hidden');beep('drop');haptic(28);
  try{
    const result=await towerWorld.dropAndSettle(state,cube,drop,count=>{el.settleCounter.querySelector('strong').textContent=String(count)});
    el.settleCounter.classList.add('hidden');if(result.collapsed){beep('boom');haptic([70,45,120])}else{beep('good');haptic(35)}
    if(mode==='solo')applySoloPlacement(cube,result);else sendVsAction({type:'place_result',cubeId:cube.id,collapsed:result.collapsed,transforms:result.transforms});
  }catch(e){console.error(e);toast('Physics hiccup. Try that block again.');towerWorld.loadState(state)}finally{settling=false;rotationQuarter=0;rotationYawOffset=0;rotationPitch=0;renderGame()}
}

function startSolo(resume=false){mode='solo';room=null;myIndex=null;rotationQuarter=0;rotationYawOffset=0;rotationPitch=0;settling=false;solo=resume?loadSolo():freshSolo();if(!solo)solo=freshSolo();history.replaceState({},'',location.pathname+'?solo=1');showOnly('game');renderGame(true)}
function playSoloCard(c){
  if(!solo||solo.phase!=='choose_card'||!cardPlayable(solo,c)||settling)return;const at=solo.hand.findIndex(x=>x.id===c.id);if(at<0)return;solo.discard.push(c);solo.hand.splice(at,1,drawSoloCard(solo));solo.activeCard=c;solo.phase='placing';solo.message='Drag a matching block onto the tower.';rotationQuarter=0;rotationYawOffset=0;rotationPitch=0;beep('card');haptic(16);saveSolo();renderGame();
}
function applySoloPlacement(cube,result){
  if(!solo)return;cube.used=true;solo.stack=result.transforms;solo.collapsed=result.collapsed;
  if(result.collapsed){solo.phase='gameover';solo.message='The tower came apart. Gravity wins this run.';solo.completed=false;const best=Math.max(Number(localStorage.getItem('wonkyBestV3')||0),solo.score);localStorage.setItem('wonkyBestV3',String(best));saveSolo();renderGame();return}
  const risk=towerWorld.riskFromTransforms(solo,result.transforms);solo.bravery=risk;if(risk>=48)solo.combo=Math.min(6,solo.combo+1);else if(risk<22)solo.combo=1;const earned=Math.round((130+solo.stack.length*45+risk*2)*solo.combo);solo.score+=earned;
  if(solo.stack.length>=9){solo.phase='gameover';solo.completed=true;solo.score+=1500;solo.message='All nine blocks survived. That tower has no business standing.';const best=Math.max(Number(localStorage.getItem('wonkyBestV3')||0),solo.score);localStorage.setItem('wonkyBestV3',String(best));beep('win');haptic([30,30,30,30,90])}else{solo.activeCard=null;solo.phase='choose_card';solo.message=risk>55?'That was filthy. Pick your next card.':'Still standing. Pick another card.';ensureSoloPlayable(solo)}saveSolo();renderGame();
}

function enterVsLobby(){mode='vs';room=null;myIndex=null;showOnly('lobby');el.playerName.value=localStorage.getItem('wonkyName')||'Joey';el.inviteBox.classList.add('hidden');el.createRoomBtn.classList.remove('hidden');setError('');history.replaceState({},'',location.pathname)}
function createRoom(){const name=(el.playerName.value||'Joey').trim().slice(0,24)||'Joey';localStorage.setItem('wonkyName',name);el.createRoomBtn.disabled=true;el.createRoomBtn.textContent='CREATING...';socket.emit('room:create',{playerId,name},res=>{el.createRoomBtn.disabled=false;el.createRoomBtn.textContent='CREATE ROOM';if(!res?.ok){setError(res?.error||'Could not create room.');return}room=res.room;myIndex=0;history.replaceState({},'',`/?room=${encodeURIComponent(room.id)}&host=1`);renderLobbyRoom()})}
function joinRoomFromUrl(){const q=new URLSearchParams(location.search),roomId=q.get('room');if(!roomId)return;mode='vs';showOnly('lobby');const role=q.get('host')==='1'?'host':'guest';const name=(role==='host'?(localStorage.getItem('wonkyName')||'Joey'):(q.get('guest')||localStorage.getItem('wonkyGuestName')||'Sabrina')).slice(0,24);if(role==='guest')localStorage.setItem('wonkyGuestName',name);el.playerName.value=name;el.createRoomBtn.classList.add('hidden');el.inviteBox.classList.add('hidden');el.lobbyTitle.textContent=role==='host'?'Rejoining your room...':`Joining ${q.get('hostName')||'Joey'}...`;el.lobbyText.textContent='The server kept the room seat and tower state. Reconnecting...';socket.emit('room:join',{roomId,playerId,name,role},res=>{if(!res?.ok){setError(res?.error||'Could not join room.');el.lobbyTitle.textContent='Room unavailable';return}room=res.room;myIndex=res.index;if(room.state){showOnly('game');renderGame(true)}else renderLobbyRoom()})}
function renderLobbyRoom(){if(!room)return;showOnly('lobby');el.createRoomBtn.classList.add('hidden');el.lobbyTitle.textContent='Room ready';el.lobbyText.textContent='This room survives refreshes and brief disconnects. Send the same link whenever Sabrina needs back in.';el.inviteBox.classList.remove('hidden');el.inviteLink.value=`${location.origin}/?room=${encodeURIComponent(room.id)}&guest=Sabrina`;const rival=room.players?.[1];if(rival?.connected){el.inviteStatus.textContent=`${rival.name} joined`;setTimeout(()=>{showOnly('game');renderGame(true)},120)}else el.inviteStatus.textContent='Waiting for Sabrina...'}
function sendVsAction(action){if(!room)return;socket.emit('game:action',{roomId:room.id,action},res=>{if(!res?.ok)toast(res?.error||'Nope.')})}
function playCard(c){if(settling)return;if(mode==='solo'){playSoloCard(c);return}beep(c.type==='skip'?'skip':'card');haptic(16);sendVsAction({type:'play_card',cardId:c.id})}

socket.on('connect',()=>{const q=new URLSearchParams(location.search);if(q.get('room')&&mode==='vs'&&!room)joinRoomFromUrl()});
socket.on('room:update',data=>{if(mode!=='vs')return;if(room&&data.id!==room.id)return;room=data;if(room.state){showOnly('game');renderGame()}else renderLobbyRoom()});
socket.on('disconnect',()=>{if(mode==='vs'&&room){renderConnection(false);toast('Connection dipped. The room is staying alive.')}});

function renderConnection(force){if(mode!=='vs'){el.connectionBadge.classList.add('hidden');return}el.connectionBadge.classList.remove('hidden');const rival=room?.players?.[1-myIndex],connected=force!==false&&socket.connected&&rival?.connected;if(connected){el.connectionBadge.className='connection-badge';el.connectionBadge.innerHTML='<i></i>CONNECTED'}else if(socket.connected){el.connectionBadge.className='connection-badge waiting';el.connectionBadge.innerHTML='<i></i>RIVAL AWAY'}else{el.connectionBadge.className='connection-badge offline';el.connectionBadge.innerHTML='<i></i>RECONNECTING'}}
function renderEffects(state){if(mode!=='vs'||!state?.lastEffect)return;const e=state.lastEffect,key=JSON.stringify(e);if(key===lastEffectKey)return;lastEffectKey=key;if(e.type==='skip')showEffect(`${state.players?.[e.player]||'Player'} SKIPS THE RIVAL`);else if(e.type==='disrupt')showEffect('RIVAL CARD SCRAMBLED');else if(e.type==='combo_skip')showEffect('POWER PLAY: GO AGAIN');else if(e.type==='collapse')showEffect('TOWER DOWN')}
function towerMood(state){if(state.phase==='gameover'&&state.collapsed)return'TOWER DOWN';const n=state.stack.length;if(n<=1)return'Fresh start';if(n<=3)return'Steady-ish';if(n<=5)return'Getting weird';if(n<=7)return'Properly wonky';return'Do not breathe'}

function renderGame(first=false){
  const state=activeState();if(!state)return;showOnly('game');const myTurn=isMyTurn(state);el.modeLabel.textContent=mode==='solo'?'SOLO STACK':'VS DUEL';el.turnLabel.textContent=state.phase==='gameover'?'ROUND OVER':settling?'SETTLING...':myTurn?'YOUR TURN':`${state.players?.[state.turn]||'RIVAL'}'S TURN`;el.stackValue.textContent=`${state.stack.length} / 9`;el.towerMood.textContent=towerMood(state);renderConnection();
  if(mode==='solo'){const best=Number(localStorage.getItem('wonkyBestV3')||0);el.scoreTitle.textContent='SCORE';el.scoreValue.textContent=solo.score.toLocaleString();el.bestTitle.textContent='BEST';el.bestValue.textContent=best.toLocaleString();el.soloMeta.classList.remove('hidden');el.comboValue.textContent='x'+solo.combo;el.braveryValue.textContent=solo.bravery;el.soloBestMini.textContent=best.toLocaleString()}else{el.soloMeta.classList.add('hidden');el.scoreTitle.textContent='YOU';el.scoreValue.textContent=room?.players?.[myIndex]?.name||'You';el.bestTitle.textContent='RIVAL';el.bestValue.textContent=room?.players?.[1-myIndex]?.name||'Waiting'}
  if(state.phase==='choose_card')el.actionHint.textContent=myTurn?'Pick one of your four cards.':'Rival is choosing a card.';else if(state.phase==='placing')el.actionHint.textContent=myTurn?'Drag a matching block up here.':'Rival is placing a block.';else el.actionHint.textContent='Round complete.';
  renderHand(state);renderDock(state);if(!settling){towerWorld.loadState(state);if(myTurn&&state.phase==='placing')towerWorld.focusPlacement(state)}renderGameOver(state);renderEffects(state);if(first)setTimeout(()=>towerWorld.resize(),70);
}
function renderGameOver(state){const over=state.phase==='gameover';el.gameOverPanel.classList.toggle('hidden',!over);if(!over)return;if(mode==='solo'){const win=!!solo.completed&&!solo.collapsed;el.gameOverTitle.textContent=win?'NINE BLOCKS. ABSOLUTE NONSENSE.':'Physics collected its debt.';el.gameOverText.textContent=win?'You landed every block and kept the tower standing for the full count.':`${solo.stack.length} blocks made it before the tower resigned.`;el.finalScoreWrap.classList.remove('hidden');el.finalScore.textContent=solo.score.toLocaleString();el.rematchBtn.textContent='NEW SOLO RUN'}else{const won=state.winner===myIndex,winner=state.players?.[state.winner]||'Someone';el.gameOverTitle.textContent=won?'YOU WIN. TINY ARCHITECT SUPREMACY.':`${winner.toUpperCase()} WINS.`;el.gameOverText.textContent=state.message||'The tower made a decision.';el.finalScoreWrap.classList.add('hidden');el.rematchBtn.textContent='REMATCH'}}

el.soloModeBtn.addEventListener('click',()=>{beep('tap');startSolo(false)});
el.vsModeBtn.addEventListener('click',()=>{beep('tap');enterVsLobby()});
el.homeBtn.addEventListener('click',()=>{beep('tap');location.href='/'});
el.soundBtn.addEventListener('click',()=>{soundOn=!soundOn;localStorage.setItem('wonkySound',soundOn?'on':'off');setSoundIcon();if(soundOn)beep('tap')});
el.createRoomBtn.addEventListener('click',createRoom);
el.copyInviteBtn.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(el.inviteLink.value);toast('Invite copied')}catch{el.inviteLink.focus();el.inviteLink.select();toast('Link selected')}beep('tap')});
el.shareInviteBtn.addEventListener('click',async()=>{const url=el.inviteLink.value;try{if(navigator.share)await navigator.share({title:'Wonky Tower Duel',text:'Play Wonky Tower Duel with me. Four cards. Nine blocks. Bad decisions.',url});else{await navigator.clipboard.writeText(url);toast('Invite copied')}}catch{}});
el.rotateBtn.addEventListener('click',()=>{rotationQuarter=(rotationQuarter+1)%4;beep('tap');haptic(10);const state=activeState();if(dragging)towerWorld.movePreview(state,dragging.lastX||0,dragging.lastY||0,rotationQuarter,rotationYawOffset,rotationPitch);renderDock(state)});
el.rematchBtn.addEventListener('click',()=>{settling=false;rotationQuarter=0;rotationYawOffset=0;rotationPitch=0;lastEffectKey='';if(mode==='solo'){localStorage.removeItem('wonkySoloStateV3');startSolo(false)}else sendVsAction({type:'rematch'})});
window.addEventListener('pointerdown',beginSecondaryRotate,{passive:false});
window.addEventListener('pointerup',endSecondaryRotate,{passive:true});
window.addEventListener('pointercancel',endSecondaryRotate,{passive:true});
window.addEventListener('resize',()=>towerWorld.resize());

(function boot(){const q=new URLSearchParams(location.search);if(q.get('room')){mode='vs';showOnly('lobby');joinRoomFromUrl()}else if(q.get('solo')==='1'&&loadSolo()){startSolo(true)}else showOnly('home')})();




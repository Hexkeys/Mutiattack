import express from "express";
import http from "http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const app=express(),server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"},perMessageDeflate:false});
const PORT=process.env.PORT||10000;
const WORLD={w:2400,h:1400};
const INTEREST_RADIUS=1000;
const POWERUP_DURATION=10;
const POWERUP_RESPAWN=15;
const KITS={
  striker:{hp:100,speed:320,damage:1.08,label:"Striker"},
  tank:{hp:125,speed:270,damage:.96,label:"Tank"},
  scout:{hp:85,speed:350,damage:1,label:"Scout"},
  juggernaut:{hp:145,speed:250,damage:.9,label:"Juggernaut"},
  assassin:{hp:75,speed:380,damage:1.12,label:"Assassin"},
  ranger:{hp:95,speed:300,damage:1.08,label:"Ranger"}
};
const STREAKS={3:{label:"ON FIRE",bonus:1.06},5:{label:"RAMPAGE",bonus:1.12},8:{label:"UNSTOPPABLE",bonus:1.18}};
const obstacles=[
{x:250,y:130,w:180,h:55},{x:720,y:120,w:210,h:55},{x:1180,y:150,w:240,h:60},{x:1710,y:120,w:190,h:55},{x:2040,y:300,w:180,h:60},
{x:500,y:300,w:200,h:60},{x:980,y:360,w:180,h:55},{x:1480,y:340,w:220,h:60},{x:190,y:760,w:220,h:55},{x:650,y:700,w:190,h:60},
{x:1080,y:760,w:250,h:55},{x:1540,y:690,w:180,h:60},{x:1970,y:760,w:220,h:55},{x:380,y:1080,w:210,h:60},{x:900,y:1030,w:180,h:55},
{x:1300,y:1080,w:220,h:60},{x:1740,y:1030,w:200,h:55},{x:2100,y:1080,w:170,h:60},{x:160,y:500,w:220,h:55},{x:820,y:490,w:220,h:55}
];
const guns={
pistol:{damage:25,fireRate:220,speed:680,spread:0,pellets:1,color:"#facc15",penetration:1,wallDamage:0.7},
smg:{damage:10,fireRate:75,speed:720,spread:.08,pellets:1,color:"#60a5fa",penetration:0,wallDamage:1},
shotgun:{damage:12,fireRate:520,speed:650,spread:.24,pellets:6,color:"#fb923c",penetration:0,wallDamage:1},
rifle:{damage:34,fireRate:360,speed:900,spread:.015,pellets:1,color:"#f87171",penetration:3,wallDamage:0.75}
};
const rooms=new Map(),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const circleHitsRect=(x,y,r,o)=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h;
const blocked=(x,y,r=16)=>obstacles.some(o=>circleHitsRect(x,y,r,o));
const spawn=()=>{for(let i=0;i<100;i++){const x=40+Math.random()*(WORLD.w-80),y=40+Math.random()*(WORLD.h-80);if(!blocked(x,y))return{x,y}}return{x:60,y:60}};
const powerSpawn=()=>{for(let i=0;i<100;i++){const x=80+Math.random()*(WORLD.w-160),y=80+Math.random()*(WORLD.h-160);if(!blocked(x,y))return{x,y}}return{x:1200,y:700}};
const makeRoom=()=>({players:new Map(),bullets:new Map(),powerups:new Map(),stateTimer:0,powerTimer:POWERUP_RESPAWN});
const announce=(roomId,text,type="info")=>{const r=rooms.get(roomId);if(!r)return;io.to(roomId).emit("announcement",{id:randomUUID(),text,type});};

function sendState(socket,r,me){
 const p=r.players.get(me);if(!p)return;
 const rr=INTEREST_RADIUS*INTEREST_RADIUS,now=performance.now();
 const players=[...r.players.values()].filter(q=>q.id===me||((q.x-p.x)**2+(q.y-p.y)**2)<=rr)
  .map(q=>({id:q.id,name:q.name,x:q.x,y:q.y,angle:q.angle,hp:q.hp,maxHp:q.maxHp,gun:q.gun,kit:q.kit,streak:q.streak,invisible:q.powerUntil>now,powerMs:Math.max(0,q.powerUntil-now)}));
 const bullets=[...r.bullets.values()].filter(b=>((b.x-p.x)**2+(b.y-p.y)**2)<=rr)
  .map(b=>({id:b.id,x:b.x,y:b.y,color:b.color,bounce:b.bounce}));
 const nearbyObstacles=obstacles.filter(o=>{const x=clamp(p.x,o.x,o.x+o.w),y=clamp(p.y,o.y,o.y+o.h);return (x-p.x)**2+(y-p.y)**2<=rr});
 const powerups=[...r.powerups.values()].filter(u=>((u.x-p.x)**2+(u.y-p.y)**2)<=rr).map(u=>({id:u.id,x:u.x,y:u.y,type:u.type}));
 socket.emit("state",{players,bullets,obstacles:nearbyObstacles,powerups,world:WORLD});
}
function broadcast(id){const r=rooms.get(id);if(!r)return;for(const p of r.players.values()){const socket=io.sockets.sockets.get(p.id);if(socket)sendState(socket,r,p.id)}}

app.get("/",(_req,res)=>res.sendFile("index.html",{root:"public"}));
app.get("/health",(_req,res)=>res.status(200).type("text/plain").send("ok"));
app.get("/ready",(_req,res)=>res.status(200).json({ok:true,service:"mutiattack"}));

io.on("connection",socket=>{
 socket.on("joinRoom",({roomId="lobby",name="Player",gun="pistol",kit="striker"}={})=>{
  if(socket.data.roomId){
   const oldRoomId=socket.data.roomId,oldRoom=rooms.get(oldRoomId),oldPlayer=oldRoom?.players.get(socket.id);
   oldRoom?.players.delete(socket.id);
   if(oldRoom){for(const[k,b]of oldRoom.bullets)if(b.owner===socket.id)oldRoom.bullets.delete(k);if(!oldRoom.players.size)rooms.delete(oldRoomId);else broadcast(oldRoomId)}
   socket.leave(oldRoomId);
  }
  const roomName=String(roomId).trim().slice(0,24)||"lobby";
  if(!rooms.has(roomName))rooms.set(roomName,makeRoom());
  const r=rooms.get(roomName),pos=spawn();socket.join(roomName);socket.data.roomId=roomName;
  const selected=guns[gun]?gun:"pistol",selectedKit=KITS[kit]?kit:"striker",k=KITS[selectedKit];
  r.players.set(socket.id,{id:socket.id,name:String(name).slice(0,20)||"Player",x:pos.x,y:pos.y,angle:0,hp:k.hp,maxHp:k.hp,gun:selected,kit:selectedKit,streak:0,input:{x:0,y:0},lastShot:0,powerUntil:0});
  if(r.powerups.size===0){const u=powerSpawn(),powerId=randomUUID();r.powerups.set(powerId,{id:powerId,x:u.x,y:u.y,type:"phase"});}
  socket.emit("joined",{roomId:roomName,id:socket.id,x:pos.x,y:pos.y,gun:selected,kit:selectedKit,maxHp:k.hp});announce(roomName,(String(name).slice(0,20)||"Player")+" joined the game","join");broadcast(roomName);
 });
 // Kit and gun are locked for the whole match. They can only be chosen when joining.

 function movePlayerTo(p,x,y){
 const nx=clamp(Number(x)||p.x,18,WORLD.w-18);
 const ny=clamp(Number(y)||p.y,18,WORLD.h-18);
 if(!blocked(nx,p.y))p.x=nx;
 if(!blocked(p.x,ny))p.y=ny;
}
socket.on("playerMove",({x,y,angle=0}={})=>{
 const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(!p)return;
 movePlayerTo(p,x,y);
 if(Number.isFinite(angle))p.angle=angle;
 p.input.x=0;p.input.y=0;
});
socket.on("playerInput",({x=0,y=0,angle=0}={})=>{const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(!p)return;if(Number.isFinite(angle))p.angle=angle;p.input.x=0;p.input.y=0});
 socket.on("shoot",({angle=0}={})=>{
  const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(!r||!p||p.hp<=0||!Number.isFinite(angle))return;
  const g=guns[p.gun],now=Date.now();if(now-p.lastShot<g.fireRate)return;p.lastShot=now;
  const empowered=p.powerUntil>performance.now();
  for(let i=0;i<g.pellets;i++){const a=angle+(Math.random()-.5)*g.spread,vx=Math.cos(a)*g.speed,vy=Math.sin(a)*g.speed,id=randomUUID();r.bullets.set(id,{id,owner:socket.id,x:p.x+Math.cos(a)*20,y:p.y+Math.sin(a)*20,vx,vy,life:0,damage:g.damage,color:empowered?"#a78bfa":g.color,bounce:empowered?3:0,penetration:empowered?0:g.penetration,wallDamage:g.wallDamage})}
 });
 socket.on("pingCheck",cb=>{if(typeof cb==="function")cb()});
 socket.on("disconnect",()=>{
  const id=socket.data.roomId,r=rooms.get(id);if(!r)return;const leaving=r.players.get(socket.id);r.players.delete(socket.id);if(leaving)announce(id,leaving.name+" left the game","leave");
  for(const[k,b]of r.bullets)if(b.owner===socket.id)r.bullets.delete(k);
  if(!r.players.size)rooms.delete(id);else broadcast(id);
 });
});

let lastTime=performance.now();
const tickServer=()=>{
 const now=performance.now(),dt=Math.min((now-lastTime)/1000,.05);lastTime=now;
 for(const[id,r]of rooms){
  for(const p of r.players.values()){if(p.hp<=0)continue;const speed=KITS[p.kit]?.speed||300,nx=clamp(p.x+p.input.x*speed*dt,18,WORLD.w-18),ny=clamp(p.y+p.input.y*speed*dt,18,WORLD.h-18);if(!blocked(nx,p.y))p.x=nx;if(!blocked(p.x,ny))p.y=ny}
  for(const[k,b]of r.bullets){
   const oldX=b.x,oldY=b.y;b.x+=b.vx*dt;b.y+=b.vy*dt;b.life+=dt;
   const hitWall=obstacles.find(o=>circleHitsRect(b.x,b.y,4,o));
   if(hitWall&&b.bounce>0){b.x=oldX;b.y=oldY;const ld=Math.abs(oldX-hitWall.x),rd=Math.abs(oldX-(hitWall.x+hitWall.w)),td=Math.abs(oldY-hitWall.y),bd=Math.abs(oldY-(hitWall.y+hitWall.h));if(Math.min(ld,rd)<Math.min(td,bd))b.vx*=-1;else b.vy*=-1;b.bounce--;b.x+=b.vx*dt}
   else if(hitWall){
    if(b.penetration>0){b.penetration--;b.damage*=b.wallDamage;b.x+=b.vx*dt;b.y+=b.vy*dt}
    else{r.bullets.delete(k);continue}
   }
   if(b.life>2.2||b.x<0||b.x>WORLD.w||b.y<0||b.y>WORLD.h){r.bullets.delete(k);continue}
   let hit=false;
   for(const p of r.players.values()){if(p.id===b.owner||p.hp<=0)continue;if(Math.hypot(b.x-p.x,b.y-p.y)<20){if(p.powerUntil<=now){const attacker=r.players.get(b.owner),streak=STREAKS[attacker?.streak]||null;const damage=b.damage*(KITS[attacker?.kit]?.damage||1)*(streak?.bonus||1);p.hp=Math.max(0,p.hp-damage);if(p.hp===0){const victim=p.name,killerPlayer=r.players.get(b.owner),killer=killerPlayer?.name;
if(killerPlayer&&killerPlayer.id!==p.id){killerPlayer.streak=(killerPlayer.streak||0)+1;announce(id,killer+" eliminated "+victim+" • "+killerPlayer.streak+" kill streak","death");const milestone=STREAKS[killerPlayer.streak];if(milestone)announce(id,killer+" is "+milestone.label+"!","power");}
else{announce(id,victim+" died","death");}
setTimeout(()=>{const q=rooms.get(id)?.players.get(p.id);if(q){const pos=spawn();q.x=pos.x;q.y=pos.y;q.hp=q.maxHp;q.powerUntil=0;q.streak=0;announce(id,q.name+" respawned","respawn")}},700)}}r.bullets.delete(k);hit=true;break}}
   if(hit)continue;
  }
  for(const p of r.players.values()){if(p.hp<=0||p.powerUntil>now)continue;for(const[k,u]of r.powerups){if(Math.hypot(p.x-u.x,p.y-u.y)<28){p.powerUntil=now+POWERUP_DURATION*1000;r.powerups.delete(k);r.powerTimer=POWERUP_RESPAWN;announce(id,p.name+" got the Phase Power-Up","power");break}}}
  r.powerTimer-=dt;if(r.powerTimer<=0&&r.powerups.size===0){const u=powerSpawn(),powerId=randomUUID();r.powerups.set(powerId,{id:powerId,x:u.x,y:u.y,type:"phase"});r.powerTimer=POWERUP_RESPAWN}
  r.stateTimer+=dt;if(r.stateTimer>=.05){r.stateTimer-=.05;broadcast(id)}
 }
};
setInterval(tickServer,8);
server.listen(PORT,"0.0.0.0",()=>console.log("Mutiattack server listening on "+PORT));
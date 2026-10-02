import express from "express";
import http from "http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const app=express(),server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"},perMessageDeflate:false});
const PORT=process.env.PORT||10000;
const WORLD={w:1200,h:700};
const obstacles=[
{x:250,y:130,w:180,h:55},{x:720,y:120,w:210,h:55},{x:500,y:300,w:200,h:60},
{x:160,y:500,w:220,h:55},{x:820,y:490,w:220,h:55}
];
const guns={
pistol:{damage:25,fireRate:220,speed:680,spread:0,pellets:1,color:"#facc15"},
smg:{damage:10,fireRate:75,speed:720,spread:.08,pellets:1,color:"#60a5fa"},
shotgun:{damage:12,fireRate:520,speed:650,spread:.24,pellets:6,color:"#fb923c"},
rifle:{damage:34,fireRate:360,speed:900,spread:.015,pellets:1,color:"#f87171"}
};
const rooms=new Map(),clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const circleHitsRect=(x,y,r,o)=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h;
const blocked=(x,y,r=16)=>obstacles.some(o=>circleHitsRect(x,y,r,o));
const spawn=()=>{for(let i=0;i<100;i++){const x=40+Math.random()*1120,y=40+Math.random()*620;if(!blocked(x,y))return{x,y}}return{x:60,y:60}};
const makeRoom=()=>({players:new Map(),bullets:new Map()});
const snapshot=r=>({players:[...r.players.values()].map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,angle:p.angle,hp:p.hp,gun:p.gun})),bullets:[...r.bullets.values()].map(b=>({id:b.id,x:b.x,y:b.y,color:b.color}))});
function broadcast(id){const r=rooms.get(id);if(r)io.to(id).emit("state",{...snapshot(r),obstacles});}

app.get("/",(_req,res)=>res.sendFile("index.html",{root:"public"}));
app.get("/health",(_req,res)=>res.status(200).send("ok"));

io.on("connection",socket=>{
 socket.on("joinRoom",({roomId="lobby",name="Player",gun="pistol"}={})=>{
  if(socket.data.roomId)socket.leave(socket.data.roomId);roomId=String(roomId).trim().slice(0,24)||"lobby";
  if(!rooms.has(roomId))rooms.set(roomId,makeRoom());const r=rooms.get(roomId),pos=spawn();
  socket.join(roomId);socket.data.roomId=roomId;const selected=guns[gun]?gun:"pistol";
  r.players.set(socket.id,{id:socket.id,name:String(name).slice(0,20)||"Player",x:pos.x,y:pos.y,angle:0,hp:100,gun:selected,input:{x:0,y:0},lastShot:0});
  socket.emit("joined",{roomId,id:socket.id});broadcast(roomId);
 });
 socket.on("selectGun",({gun}={})=>{const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(p&&guns[gun])p.gun=gun});
 socket.on("playerInput",({x=0,y=0,angle=0}={})=>{const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(!p)return;p.input.x=clamp(Number(x)||0,-1,1);p.input.y=clamp(Number(y)||0,-1,1);if(Number.isFinite(angle))p.angle=angle});
 socket.on("shoot",({angle=0}={})=>{
  const r=rooms.get(socket.data.roomId),p=r?.players.get(socket.id);if(!r||!p||p.hp<=0||!Number.isFinite(angle))return;
  const g=guns[p.gun],now=Date.now();if(now-p.lastShot<g.fireRate)return;p.lastShot=now;
  for(let i=0;i<g.pellets;i++){const a=angle+(Math.random()-.5)*g.spread;const vx=Math.cos(a)*g.speed,vy=Math.sin(a)*g.speed,id=randomUUID();r.bullets.set(id,{id,owner:socket.id,x:p.x+Math.cos(a)*20,y:p.y+Math.sin(a)*20,vx,vy,life:0,damage:g.damage,color:g.color})}
 });
 socket.on("disconnect",()=>{const id=socket.data.roomId,r=rooms.get(id);if(!r)return;r.players.delete(socket.id);for(const[k,b]of r.bullets)if(b.owner===socket.id)r.bullets.delete(k);if(!r.players.size)rooms.delete(id);else broadcast(id)});
});
setInterval(()=>{
 const dt=1/20;
 for(const[id,r]of rooms){
  for(const p of r.players.values()){if(p.hp<=0)continue;const speed=300,nx=clamp(p.x+p.input.x*speed*dt,18,WORLD.w-18),ny=clamp(p.y+p.input.y*speed*dt,18,WORLD.h-18);if(!blocked(nx,p.y))p.x=nx;if(!blocked(p.x,ny))p.y=ny}
  for(const[k,b]of r.bullets){b.x+=b.vx*dt;b.y+=b.vy*dt;b.life+=dt;if(b.life>1.5||b.x<0||b.x>WORLD.w||b.y<0||b.y>WORLD.h||obstacles.some(o=>circleHitsRect(b.x,b.y,4,o))){r.bullets.delete(k);continue}
   let hit=false;for(const p of r.players.values()){if(p.id===b.owner||p.hp<=0)continue;if(Math.hypot(b.x-p.x,b.y-p.y)<20){p.hp=Math.max(0,p.hp-b.damage);r.bullets.delete(k);hit=true;if(p.hp===0)setTimeout(()=>{const q=rooms.get(id)?.players.get(p.id);if(q){const pos=spawn();q.x=pos.x;q.y=pos.y;q.hp=100}},700);break}}if(hit)continue;
  }
  broadcast(id);
 }
},50);
server.listen(PORT,()=>console.log("Mutiattack server listening on "+PORT));
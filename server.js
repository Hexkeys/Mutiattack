import express from "express";
import http from "http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const app=express(),server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"},perMessageDeflate:false});
const PORT=process.env.PORT||10000;
const WORLD={w:1200,h:700};
app.use(express.static("public"));
app.get("/health",(_req,res)=>res.json({ok:true}));

const obstacles=[
  {x:250,y:130,w:180,h:55},{x:720,y:120,w:210,h:55},
  {x:500,y:300,w:200,h:60},{x:160,y:500,w:220,h:55},
  {x:820,y:490,w:220,h:55}
];
const rooms=new Map();
const makeRoom=()=>({players:new Map(),bullets:new Map()});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const circleHitsRect=(x,y,r,o)=>x+r>o.x&&x-r<o.x+o.w&&y+r>o.y&&y-r<o.y+o.h;
const blocked=(x,y,r=16)=>obstacles.some(o=>circleHitsRect(x,y,r,o));
const spawn=()=>{for(let i=0;i<100;i++){const x=40+Math.random()*1120,y=40+Math.random()*620;if(!blocked(x,y))return{x,y}}return{x:60,y:60}};
const snapshot=room=>({players:[...room.players.values()].map(p=>({...p,input:undefined})),bullets:[...room.bullets.values()],obstacles});
function broadcast(roomId){const r=rooms.get(roomId);if(r)io.to(roomId).emit("state",snapshot(r));}

io.on("connection",socket=>{
  socket.on("joinRoom",({roomId="lobby",name="Player"}={})=>{
    if(socket.data.roomId)socket.leave(socket.data.roomId);
    roomId=String(roomId).trim().slice(0,24)||"lobby";
    if(!rooms.has(roomId))rooms.set(roomId,makeRoom());
    const room=rooms.get(roomId),pos=spawn();
    socket.join(roomId);socket.data.roomId=roomId;
    room.players.set(socket.id,{id:socket.id,name:String(name).slice(0,20)||"Player",x:pos.x,y:pos.y,angle:0,hp:100,input:{x:0,y:0}});
    socket.emit("joined",{roomId,id:socket.id});broadcast(roomId);
  });

  socket.on("playerInput",({x=0,y=0,angle=0}={})=>{
    const room=rooms.get(socket.data.roomId),p=room?.players.get(socket.id);if(!p)return;
    p.input.x=clamp(Number(x)||0,-1,1);p.input.y=clamp(Number(y)||0,-1,1);
    if(Number.isFinite(angle))p.angle=angle;
  });

  socket.on("shoot",({angle=0}={})=>{
    const room=rooms.get(socket.data.roomId),p=room?.players.get(socket.id);
    if(!room||!p||!Number.isFinite(angle)||p.hp<=0)return;
    const speed=620,id=randomUUID(),vx=Math.cos(angle)*speed,vy=Math.sin(angle)*speed;
    room.bullets.set(id,{id,owner:socket.id,x:p.x+Math.cos(angle)*20,y:p.y+Math.sin(angle)*20,vx,vy,life:0});
  });

  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId,room=rooms.get(roomId);if(!room)return;
    room.players.delete(socket.id);
    for(const[id,b]of room.bullets)if(b.owner===socket.id)room.bullets.delete(id);
    if(!room.players.size)rooms.delete(roomId);else broadcast(roomId);
  });
});

setInterval(()=>{
  const dt=1/20;
  for(const[roomId,room]of rooms){
    for(const p of room.players.values()){
      if(p.hp<=0)continue;
      const speed=240,dx=p.input.x*speed*dt,dy=p.input.y*speed*dt;
      const nx=clamp(p.x+dx,18,WORLD.w-18),ny=clamp(p.y+dy,18,WORLD.h-18);
      if(!blocked(nx,p.y))p.x=nx;
      if(!blocked(p.x,ny))p.y=ny;
    }
    for(const[id,b]of room.bullets){
      const ox=b.x,oy=b.y;
      b.x+=b.vx*dt;b.y+=b.vy*dt;b.life+=dt;
      if(b.life>1.5||b.x<-30||b.x>WORLD.w+30||b.y<-30||b.y>WORLD.h+30||obstacles.some(o=>circleHitsRect(b.x,b.y,4,o))){room.bullets.delete(id);continue}
      for(const p of room.players.values()){
        if(p.id===b.owner||p.hp<=0)continue;
        if(Math.hypot(b.x-p.x,b.y-p.y)<20){
          p.hp-=25;room.bullets.delete(id);
          if(p.hp<=0){p.hp=0;setTimeout(()=>{const r=rooms.get(roomId),q=r?.players.get(p.id);if(q){const pos=spawn();q.x=pos.x;q.y=pos.y;q.hp=100}},700)}
          break;
        }
      }
    }
    broadcast(roomId);
  }
},50);

server.listen(PORT,()=>console.log("Mutiattack server listening on "+PORT));
import express from "express";
import http from "http";
import { randomUUID } from "node:crypto";
import { Server } from "socket.io";

const app=express(), server=http.createServer(app);
const io=new Server(server,{cors:{origin:"*"},perMessageDeflate:false});
const PORT=process.env.PORT||10000;
app.use(express.static("public"));
app.get("/health",(_req,res)=>res.json({ok:true}));

const rooms=new Map();
const makeRoom=()=>({players:new Map(),bullets:new Map()});
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
const snapshot=room=>({players:[...room.players.values()],bullets:[...room.bullets.values()]});
function broadcast(roomId){const r=rooms.get(roomId);if(r)io.to(roomId).emit("state",snapshot(r));}

io.on("connection",socket=>{
  socket.on("joinRoom",({roomId="lobby",name="Player"}={})=>{
    if(socket.data.roomId)socket.leave(socket.data.roomId);
    roomId=String(roomId).trim().slice(0,24)||"lobby";
    if(!rooms.has(roomId))rooms.set(roomId,makeRoom());
    const room=rooms.get(roomId);socket.join(roomId);socket.data.roomId=roomId;
    room.players.set(socket.id,{id:socket.id,name:String(name).slice(0,20)||"Player",x:450,y:250,angle:0,hp:100});
    socket.emit("joined",{roomId,id:socket.id});broadcast(roomId);
  });
  socket.on("playerMove",({x,y,angle=0}={})=>{
    const room=rooms.get(socket.data.roomId),p=room?.players.get(socket.id);if(!p)return;
    p.x=clamp(Number(x)||p.x,18,1182);p.y=clamp(Number(y)||p.y,18,682);
    if(Number.isFinite(angle))p.angle=angle;
  });
  socket.on("shoot",({angle=0}={})=>{
    const room=rooms.get(socket.data.roomId),p=room?.players.get(socket.id);if(!room||!p||!Number.isFinite(angle))return;
    const speed=620,id=randomUUID();
    room.bullets.set(id,{id,owner:socket.id,x:p.x+Math.cos(angle)*20,y:p.y+Math.sin(angle)*20,vx:Math.cos(angle)*speed,vy:Math.sin(angle)*speed});
  });
  socket.on("disconnect",()=>{
    const roomId=socket.data.roomId,room=rooms.get(roomId);if(!room)return;
    room.players.delete(socket.id);for(const[id,b]of room.bullets)if(b.owner===socket.id)room.bullets.delete(id);
    if(!room.players.size)rooms.delete(roomId);else broadcast(roomId);
  });
});
setInterval(()=>{
  for(const[roomId,room]of rooms){
    for(const[id,b]of room.bullets){b.x+=b.vx/30;b.y+=b.vy/30;if(b.x<-30||b.x>1230||b.y<-30||b.y>730)room.bullets.delete(id)}
    broadcast(roomId);
  }
},50);
server.listen(PORT,()=>console.log("Mutiattack server listening on "+PORT));
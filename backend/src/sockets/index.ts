import { Server } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { frontendOrigins } from "../config/env.js";
import { authenticateSocket } from "./auth.js";
import { registerSocketEvents } from "./events.js";
import { setSocketServer } from "./registry.js";

export function createSocketServer(server: HttpServer) {
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: frontendOrigins, credentials: true },
    pingTimeout: 25_000,
  });
  io.use(authenticateSocket);
  io.on("connection", registerSocketEvents);
  setSocketServer(io);
  return io;
}

import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";
import { Server } from "socket.io";

dotenv.config({
    path: './.env'
})

// Import the MQTT subscriber so it starts running
// require('./mqtt/mqttSubscriber');   //uncomment when required


// Create an HTTP server from the Express app.
const server = http.createServer(app);

// Initialize Socket.io and attach it to the HTTP server.
const io = new Server(server, {
    cors: {
        origin: process.env.CORS_ORIGIN,  // Update this as necessary for your environment.
        methods: ["GET", "POST"],
        credentials: true,
    }
});

// Listen for new client connections.
io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
    });
});

// Attach the Socket.io instance to app.locals so that it's accessible in your routes/controllers.
app.locals.io = io;

connectDB()  //function defined under db->index.js
  .then(() => {
    // Start the server with Socket.io
    const PORT = process.env.PORT || 8000;
    server.listen(PORT, () => {
        console.log(`⚙️  Server running on port: ${PORT}`);
    });
  })
  .catch((err) => {
    console.log("MongoDB Connection failed !!! ", err);
  });

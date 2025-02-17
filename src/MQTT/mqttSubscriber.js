// src/mqtt/mqttSubscriber.js
const mqtt = require('mqtt');
const axios = require('axios');
// Import your MongoDB model or service for storing data
const { storeInMongoDB } = require('./mqttStoreService'); // Example service function

// Connect to the MQTT broker
const client = mqtt.connect('mqtt://your-broker-address');

client.on('connect', () => {
  console.log("Connected to MQTT broker");
  // Subscribe to a topic pattern; using + as a wildcard for bin IDs
  client.subscribe('waste/bin/+/status', (err) => {
    if (!err) {
      console.log("Subscribed to bin status topics");
    } else {
      console.error("Subscription error:", err);
    }
  });
});

client.on('message', (topic, message) => {
  // Parse the message and modify the payload if needed
  let payload = JSON.parse(message.toString());
  
  // Example modification: add a received timestamp
  payload.receivedAt = new Date().toISOString();
  
  // Log and store the modified payload
  console.log("Received MQTT message on", topic, ":", payload);
  storeInMongoDB(topic, payload);
});

module.exports = client;

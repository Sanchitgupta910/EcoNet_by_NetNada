// import mqtt from 'mqtt';
// import dotenv from 'dotenv';
// import { ingestWaste } from '../services/wasteService.js';

// dotenv.config({
//   path: './.env',
// });

// // Required env vars
// const {
//   MQTT_BROKER_URL,
//   MQTT_USERNAME,
//   MQTT_PASSWORD,

//   MQTT_TOPIC = 'waste/weight/#', // default wildcard
//   MQTT_CLIENT_ID = `ecodash-sub_${Math.random().toString(16).slice(2)}`,
//   MQTT_RECONNECT_PERIOD = 5000, // 5s
// } = process.env;

// if (!MQTT_BROKER_URL) {
//   console.error('MQTT_BROKER_URL not set in .env');
//   process.exit(1);
// }

// // Build MQTT connection options
// const mqttOptions = {
//   clientId: MQTT_CLIENT_ID,
//   username: MQTT_USERNAME,
//   password: MQTT_PASSWORD,
//   reconnectPeriod: Number(MQTT_RECONNECT_PERIOD),
//   clean: false,
//   connectTimeout: 30_000,
// };

// /**
//  * startMqttSubscriber
//  * Connects to the MQTT broker and wires up message handling.
//  */
// export function startMqttSubscriber() {
//   console.log(`🔌 [MQTT] Connecting to ${MQTT_BROKER_URL} as ${MQTT_CLIENT_ID}`);
//   const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

//   client.on('connect', () => {
//     console.log('✅ [MQTT] Connected');
//     client.subscribe(MQTT_TOPIC, { qos: 1 }, (err, granted) => {
//       if (err) {
//         console.error('[MQTT] Subscribe error:', err);
//       } else {
//         console.log(`[MQTT] Subscribed to: ${granted.map((g) => g.topic).join(', ')}`);
//       }
//     });
//   });

//   client.on('reconnect', () => console.log('🔄 [MQTT] Reconnecting…'));
//   client.on('close', () => console.log('🔒 [MQTT] Connection closed'));
//   client.on('offline', () => console.warn('⚠️ [MQTT] Went offline'));
//   client.on('error', (err) => console.error('[MQTT] Error:', err));

//   client.on('message', async (topic, raw) => {
//     let msg;
//     try {
//       msg = JSON.parse(raw.toString());
//     } catch (e) {
//       console.warn('⚠️ [MQTT] Invalid JSON:', raw.toString());
//       return;
//     }

//     const {
//       associateBin,
//       currentWeight,
//       eventType = 'disposal',
//       isCleaned = false,
//       cleanedBy,
//     } = msg;

//     if (!associateBin || typeof currentWeight !== 'number' || !eventType) {
//       console.warn('⚠️ [MQTT] Missing required fields:', msg);
//       return;
//     }

//     try {
//       await ingestWaste({
//         associateBin,
//         rawWeight: currentWeight,
//         eventType,
//         isCleaned: Boolean(isCleaned),
//         cleanedBy: cleanedBy || null,
//       });
//     } catch (err) {
//       console.error('[MQTT] ingestWaste() failed:', err);
//     }
//   });
// }
// src/MQTT/mqttSubscriber.js
import mqtt from 'mqtt';
import dotenv from 'dotenv';
import { ingestWaste } from '../services/wasteService.js';

dotenv.config({ path: './.env' });

const {
  MQTT_BROKER_URL,
  MQTT_USERNAME,
  MQTT_PASSWORD,
  MQTT_TOPIC = 'waste/weight/#',
  MQTT_CLIENT_ID = `ecodash-sub_${Math.random().toString(16).slice(2)}`,
  MQTT_RECONNECT_PERIOD = 5000,
} = process.env;

if (!MQTT_BROKER_URL) {
  console.error('❌ MQTT_BROKER_URL not set');
  process.exit(1);
}

const mqttOptions = {
  clientId: MQTT_CLIENT_ID,
  username: MQTT_USERNAME,
  password: MQTT_PASSWORD,
  reconnectPeriod: Number(MQTT_RECONNECT_PERIOD),
  clean: false,
  connectTimeout: 30_000,
};

export function startMqttSubscriber() {
  console.log(`🔌 [MQTT] Connecting to ${MQTT_BROKER_URL} as ${MQTT_CLIENT_ID}`);
  const client = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

  client.on('connect', () => {
    console.log('✅ [MQTT] Connected');
    client.subscribe(MQTT_TOPIC, { qos: 1 }, (err, granted) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err);
      } else {
        console.log(`[MQTT] Subscribed to: ${granted.map((g) => g.topic).join(', ')}`);
      }
    });
  });

  client.on('reconnect', () => console.log('🔄 [MQTT] Reconnecting…'));
  client.on('close', () => console.log('🔒 [MQTT] Connection closed'));
  client.on('offline', () => console.warn('⚠️ [MQTT] Went offline'));
  client.on('error', (err) => console.error('[MQTT] Error:', err));

  client.on('message', async (topic, raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch (e) {
      console.warn('⚠️ [MQTT] Invalid JSON:', raw.toString());
      return;
    }

    const {
      associateBin,
      currentWeight,
      eventType = 'disposal',
      isCleaned = false,
      cleanedBy = null,
    } = msg;

    // sanity checks
    if (
      typeof associateBin !== 'string' ||
      typeof currentWeight !== 'number' ||
      typeof eventType !== 'string'
    ) {
      console.warn('⚠️ [MQTT] Missing/invalid fields:', msg);
      return;
    }

    console.log('📥 [MQTT] Received:', {
      associateBin,
      currentWeight,
      eventType,
      isCleaned,
      cleanedBy,
    });

    try {
      // <-- PASS EACH ARG SEPARATELY, not as one big object
      await ingestWaste(associateBin, currentWeight, eventType, Boolean(isCleaned), cleanedBy);
    } catch (err) {
      console.error('[MQTT] ingestWaste() failed:', err);
    }
  });
}

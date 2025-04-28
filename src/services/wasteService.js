import redisClient from '../utils/redisClient.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';

/**
 * ingestWaste
 * @param {ObjectId} associateBin   – the Dustbin _id
 * @param {number}   currentWeight  – measured weight
 * @param {string}   eventType      – "disposal" or "cleaning"
 * @param {boolean}  isCleaned      – true for cleaning events
 * @returns {Promise<Waste>}        – the created Waste document
 */
export async function ingestWaste(
  associateBin,
  currentWeight,
  eventType = 'disposal',
  isCleaned = false,
) {
  // 1) Create the waste entry
  const record = await Waste.create({
    associateBin,
    currentWeight,
    eventType,
    isCleaned,
  });

  console.log(`✅ [ingestWaste] Created Waste _id=${record._id}`);

  // 2) Look up branchAddress from Dustbin
  const dustbin = await Dustbin.findById(associateBin).select('branchAddress').lean();
  if (!dustbin) {
    console.warn(`⚠️ [ingestWaste] Dustbin ${associateBin} not found—skipping publish`);
    return record;
  }
  const branchId = dustbin.branchAddress.toString();

  // 3) Publish to Redis for real‐time dashboards
  const payload = {
    _id: record._id,
    associateBin: record.associateBin,
    currentWeight: record.currentWeight,
    eventType: record.eventType,
    isCleaned: record.isCleaned,
    createdAt: record.createdAt,
  };

  redisClient
    .publish('waste-updates', JSON.stringify({ branchId, payload }))
    .then(() => console.log(`✔️ [ingestWaste] Published to waste-updates for branch ${branchId}`))
    .catch((err) =>
      console.error(`❌ [ingestWaste] Failed to publish for branch ${branchId}:`, err),
    );

  return record;
}

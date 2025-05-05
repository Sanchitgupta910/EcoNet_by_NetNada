import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import { Cleaner } from '../models/cleaner.models.js';
import redisClient from '../utils/redisClient.js';

/**
 * addWaste:
 * 1. Extract & validate payload
 * 2. Load the Dustbin (to get its tareWeight & branchId)
 * 3. If eventType==='cleaning', ensure cleaner info and update bin.tareWeight
 * 4. Lookup Cleaner by ID if provided
 * 5. Compute net waste = rawWeight − tareWeight (clamped ≥ 0)
 * 6. Create a Waste record (including cleanedBy )
 * 7. Publish to Redis for real-time updates
 * 8. Return the new Waste in the HTTP response
 */
const addWaste = asyncHandler(async (req, res) => {
  // 1) Extract & basic validation
  const { associateBin, currentWeight: rawWeight, eventType, isCleaned, cleanedBy } = req.body;

  if (!associateBin || rawWeight == null || !eventType) {
    throw new ApiError(
      400,
      'Required fields: associateBin (ObjectId), currentWeight (Number), eventType (String)',
    );
  }

  // 2) Load the Dustbin (to read/update tareWeight and get branchAddress)
  const bin = await Dustbin.findById(associateBin);
  if (!bin) {
    throw new ApiError(404, `Dustbin ${associateBin} not found.`);
  }

  // 3) If this is a cleaning event, we must record who cleaned and update tareWeight
  let cleanerDoc = null;
  if (eventType === 'cleaning') {
    if (!isCleaned) {
      throw new ApiError(400, "'isCleaned' must be true for cleaning events.");
    }
    // require either a known Cleaner ID or a free-text name
    if (!cleanedBy) {
      throw new ApiError(400, "Cleaning events require 'cleanedBy' (Cleaner ID)");
    }
    // update the bin’s tareWeight to this raw reading
    bin.tareWeight = rawWeight;
    await bin.save();

    // 4) If they provided a Cleaner ID, verify it
    if (cleanedBy) {
      cleanerDoc = await Cleaner.findById(cleanedBy);
      if (!cleanerDoc) {
        throw new ApiError(404, `Cleaner ${cleanedBy} not found.`);
      }
    }
  }

  // 5) Compute net waste weight (never go below zero)
  const tare = bin.tareWeight;
  const netWeight = Math.max(0, rawWeight - tare);

  // 6) Persist the Waste record
  const wastePayload = {
    associateBin,
    currentWeight: netWeight,
    eventType,
    isCleaned: Boolean(isCleaned),
  };
  if (eventType === 'cleaning') {
    // store both the reference (if any) and the snapshot name
    wastePayload.cleanedBy = cleanerDoc?._id;
  }

  const wasteRecord = await Waste.create(wastePayload);
  console.log(`✅ [addWaste] Waste _id=${wasteRecord._id} recorded (netWeight=${netWeight}kg)`);

  // 7) Publish to Redis → Socket.io for immediate dashboard update
  const pubMessage = JSON.stringify({
    branchId: bin.branchAddress.toString(),
    payload: {
      _id: wasteRecord._id,
      associateBin,
      currentWeight: netWeight,
      eventType,
      isCleaned: Boolean(isCleaned),
      cleanedBy: wastePayload.cleanedBy,
      createdAt: wasteRecord.createdAt,
    },
  });

  redisClient
    .publish('waste-updates', pubMessage)
    .then(() => {
      console.log(`✔️ [addWaste] Published to 'waste-updates' for branch ${bin.branchAddress}`);
    })
    .catch((err) => {
      console.error(`❌ [addWaste] Redis publish failed:`, err);
    });

  // 8) Return the new record
  return res.status(201).json(new ApiResponse(201, wasteRecord, 'Waste record added successfully'));
});

/**
 * cleanBinsBulk
 *
 * Marks one or more bins as “cleaned” in one request.
 * Steps:
 *  1. Validate payload: must include an array of bins plus at least one identifier for the cleaner.
 *  2. For each bin:
 *     a. Load the Dustbin to ensure it exists and retrieve its branchAddress.
 *     b. Update its tareWeight to the raw scale reading (so future disposals subtract correctly).
 *     c. Save the bin.
 *     d. Insert a Waste document with eventType='cleaning', currentWeight=0, isCleaned=true.
 *     e. Publish the new Waste payload to Redis so any socket clients get the update in real time.
 *  3. Return the array of created Waste records.
 *
 * @route POST /api/v1/waste/clean
 * @access Service clients (via verifyServiceKey)
 */
const cleanBinsBulk = asyncHandler(async (req, res) => {
  const { bins, cleanedBy, cleanerName } = req.body;

  // 1) Validate top‐level payload
  if (!Array.isArray(bins) || bins.length === 0 || !(cleanedBy || cleanerName)) {
    throw new ApiError(
      400,
      'Payload must include a non-empty `bins` array and at least one of `cleanedBy` or `cleanerName`.',
    );
  }

  const createdEvents = [];

  // 2) Process each bin
  for (const item of bins) {
    const { associateBin, rawWeight } = item;

    // 2.a) Validate each entry
    if (!associateBin || typeof rawWeight !== 'number') {
      // skip invalid entries rather than completely fail
      console.warn(`[cleanBinsBulk] skipping invalid entry:`, item);
      continue;
    }

    // 2.b) Load the Dustbin document
    const bin = await Dustbin.findById(associateBin).lean();
    if (!bin) {
      console.warn(`[cleanBinsBulk] dustbin not found: ${associateBin}`);
      continue;
    }

    // 2.c) Update its tareWeight
    // (we assume you have added `tareWeight` to the Dustbin schema)
    await Dustbin.updateOne({ _id: associateBin }, { $set: { tareWeight: rawWeight } });

    // 2.d) Create a cleaning Waste record
    const wasteRecord = await Waste.create({
      associateBin,
      currentWeight: 0, // cleaned → net waste is zero
      eventType: 'cleaning',
      isCleaned: true,
      cleanedBy: cleanedBy || null,
      cleanerName: cleanerName || null,
    });

    createdEvents.push(wasteRecord);

    // 2.e) Publish to Redis for socket.io
    const payload = {
      _id: wasteRecord._id,
      associateBin,
      currentWeight: 0,
      eventType: 'cleaning',
      isCleaned: true,
      cleanedBy: wasteRecord.cleanedBy,
      cleanerName: wasteRecord.cleanerName,
      createdAt: wasteRecord.createdAt,
    };
    const message = JSON.stringify({
      branchId: bin.branchAddress.toString(),
      payload,
    });

    redisClient
      .publish('waste-updates', message)
      .then(() => {
        console.log(`[cleanBinsBulk] published cleaning event for bin ${associateBin}`);
      })
      .catch((err) => {
        console.error(
          `[cleanBinsBulk] failed to publish cleaning event for bin ${associateBin}:`,
          err,
        );
      });
  }

  // 3) Return all successfully created events
  return res.status(201).json(new ApiResponse(201, createdEvents, 'Bins cleaned successfully'));
});

export { addWaste, cleanBinsBulk };

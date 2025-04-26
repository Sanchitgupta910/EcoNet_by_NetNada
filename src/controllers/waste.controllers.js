import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import redisClient from '../utils/redisClient.js';

/**
 * addWaste:
 * 1. Validates request
 * 2. Ensures the dustbin exists
 * 3. Inserts a new Waste record
 * 4. Publishes the update to Redis via the already‐connected client
 */
const addWaste = asyncHandler(async (req, res) => {
  const { associateBin, currentWeight } = req.body;

  // 1) Validate inputs
  if (!associateBin || currentWeight == null) {
    throw new ApiError(400, "Both 'associateBin' and 'currentWeight' are required.");
  }

  // 2) Verify dustbin exists
  const dustbin = await Dustbin.findById(associateBin);
  if (!dustbin) {
    throw new ApiError(404, 'Associated dustbin not found.');
  }

  // 3) Create the waste entry
  const wasteRecord = await Waste.create({ associateBin, currentWeight });
  console.log(`✅ [addWaste] Created Waste _id=${wasteRecord._id}`);

  // 4) Publish to Redis (fire-and-forget)
  const channel = 'waste-updates';
  const branchId = dustbin.branchAddress.toString();
  const message = JSON.stringify({
    branchId,
    payload: {
      _id: wasteRecord._id,
      associateBin: wasteRecord.associateBin,
      currentWeight: wasteRecord.currentWeight,
      createdAt: wasteRecord.createdAt,
    },
  });

  redisClient
    .publish(channel, message)
    .then(() => {
      console.log(`✔️ [addWaste] Published to ${channel} for branch ${branchId}`);
    })
    .catch((err) => {
      console.error(`❌ [addWaste] Publish to ${channel} failed:`, err);
    });

  // 5) Send the HTTP response immediately
  return res
    .status(201)
    .json(new ApiResponse(201, wasteRecord, 'Waste record added successfully!'));
});

export { addWaste };

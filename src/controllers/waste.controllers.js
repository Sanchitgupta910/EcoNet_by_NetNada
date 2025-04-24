import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Waste } from '../models/waste.models.js';
import { Dustbin } from '../models/dustbin.models.js';
import redisClient from '../utils/redisClient.js';

// Function to add a waste entry
const addWaste = asyncHandler(async (req, res) => {
  const { associateBin, currentWeight } = req.body;

  // 1) Validate inputs
  if (!associateBin || currentWeight == null) {
    throw new ApiError(400, "Both 'associateBin' and 'currentWeight' are required.");
  }

  // 2) Check dustbin exists
  const dustbin = await Dustbin.findById(associateBin);
  if (!dustbin) {
    throw new ApiError(404, 'Associated dustbin not found.');
  }

  // 3) Create waste record
  const wasteRecord = await Waste.create({ associateBin, currentWeight });
  console.log(`✅ [addWaste] Created Waste _id=${wasteRecord._id}`);

  // 4) Publish to Redis
  (async () => {
    const channel = 'waste-updates'; // ASCII hyphen
    const publisher = redisClient.duplicate();
    try {
      await publisher.connect();
      const branchId = dustbin.branchAddress.toString();
      const payload = {
        _id: wasteRecord._id,
        associateBin: wasteRecord.associateBin,
        currentWeight: wasteRecord.currentWeight,
        createdAt: wasteRecord.createdAt,
      };
      console.log(`▶️ [addWaste] publishing to ${channel}: branchId=${branchId}`, payload);
      await publisher.publish(channel, JSON.stringify({ branchId, payload }));
      console.log('✔️ [addWaste] publish successful');
    } catch (err) {
      console.error('❌ [addWaste] publish failed:', err);
    } finally {
      await publisher.disconnect();
    }
  })();

  // 5) Return response immediately
  return res
    .status(201)
    .json(new ApiResponse(201, wasteRecord, 'Waste record added successfully!'));
});

export { addWaste };

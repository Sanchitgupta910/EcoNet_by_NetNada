import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Waste } from "../models/waste.models.js";
import { Dustbin } from "../models/dustbin.models.js";
import mongoose from "mongoose";
import {
    startOfDay,
    endOfDay,
    startOfWeek,
    endOfWeek,
    startOfMonth,
    endOfMonth,
    subWeeks,
    subMonths,
} from "date-fns";

/**
 * branchWasteBreakdown
 * --------------------------------------------
 * Aggregates waste data for a specific branch by dustbin type using only the final reading
 * of each day (e.g., the 6 PM reading). This ensures that for each day, only the last
 * recorded weight is considered, avoiding double-counting.
 *
 * Query Parameters:
 *   - branchId: (required) the branch's identifier.
 *   - filter: (optional) time filter ("today", "thisWeek", "lastWeek", "lastMonth"; default: today).
 *
 * @route GET /api/v1/analytics/branchWasteBreakdown?branchId=<branchId>&filter=<filter>
 */
const branchWasteBreakdown = asyncHandler(async (req, res) => {
    const { branchId, filter = "today" } = req.query;
    if (!branchId) {
        throw new ApiError(400, "branchId is required");
    }

    // Determine date range based on filter
    let startDate, endDate;
    const now = new Date();
    switch (filter) {
        case "today":
            startDate = startOfDay(now);
            endDate = endOfDay(now);
            break;
        case "thisWeek":
            startDate = startOfWeek(now);
            endDate = endOfWeek(now);
            break;
        case "lastWeek":
            const lastWeekDate = subWeeks(now, 1);
            startDate = startOfWeek(lastWeekDate);
            endDate = endOfWeek(lastWeekDate);
            break;
        case "lastMonth":
            const lastMonthDate = subMonths(now, 1);
            startDate = startOfMonth(lastMonthDate);
            endDate = endOfMonth(lastMonthDate);
            break;
        default:
            startDate = startOfDay(now);
            endDate = endOfDay(now);
    }

    // Aggregation pipeline:
    // 1. Match waste records within the date range.
    // 2. Lookup dustbin details.
    // 3. Unwind the binData array.
    // 4. Filter records to include only those from the specified branch.
    // 5. Sort records descending by createdAt.
    // 6. Group by day and bin type to pick the final record per day for each bin.
    // 7. Group by bin type to sum the final daily weights.
    const pipeline = [
        {
            $match: {
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $lookup: {
                from: "dustbins",
                localField: "associateBin",
                foreignField: "_id",
                as: "binData"
            }
        },
        { $unwind: "$binData" },
        {
            $match: {
                "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
            }
        },
        // Sort descending so the latest reading for each day appears first.
        { $sort: { createdAt: -1 } },
        // Group by day and dustbin type to get the final reading of that day.
        {
            $group: {
                _id: {
                    day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    binType: "$binData.dustbinType"
                },
                finalWeight: { $first: "$currentWeight" }
            }
        },
        // Group by dustbin type across days to sum up the final weights.
        {
            $group: {
                _id: "$_id.binType",
                totalWaste: { $sum: "$finalWeight" }
            }
        },
        {
            $project: {
                _id: 0,
                binType: "$_id",
                totalWaste: 1
            }
        }
    ];

    let breakdownResult;
    try {
        breakdownResult = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error aggregating branch waste breakdown:", error);
        throw new ApiError(500, "Error processing branch waste breakdown data");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, breakdownResult, "Branch waste breakdown data fetched successfully"));
});


/**
 * dailyDiversionRecycling
 * --------------------------------------------
 * Aggregates daily final waste readings for a specific branch and computes:
 *   - Current Landfill Diversion Rate: (sum of final weights for bins except "General Waste") / (total final weight) * 100
 *   - Current Recycling Rate: (sum of final weights for bins "Commingled" and "Paper & Cardboard") / (total final weight) * 100
 *
 * The aggregation only considers the final reading per day (i.e. the latest reading, typically at 6 PM).
 * Target rates are hardcoded (can be made configurable).
 *
 * Query Parameters:
 *   - branchId: (required) the branch's identifier.
 *   - filter: (optional) time filter ("today", "thisWeek", "lastWeek", "lastMonth"; default: today).
 *
 * @route GET /api/v1/analytics/dailyDiversionRecycling?branchId=<branchId>&filter=<filter>
 */
const dailyDiversionRecycling = asyncHandler(async (req, res) => {
    const { branchId, filter = "today" } = req.query;
    if (!branchId) {
        throw new ApiError(400, "branchId is required");
    }

    // Determine date range based on filter.
    let startDate, endDate;
    const now = new Date();
    switch (filter) {
        case "today":
            startDate = startOfDay(now);
            endDate = endOfDay(now);
            break;
        case "thisWeek":
            startDate = startOfWeek(now);
            endDate = endOfWeek(now);
            break;
        case "lastWeek":
            const lastWeekDate = subWeeks(now, 1);
            startDate = startOfWeek(lastWeekDate);
            endDate = endOfWeek(lastWeekDate);
            break;
        case "lastMonth":
            const lastMonthDate = subMonths(now, 1);
            startDate = startOfMonth(lastMonthDate);
            endDate = endOfMonth(lastMonthDate);
            break;
        default:
            startDate = startOfDay(now);
            endDate = endOfDay(now);
    }

    // Target rates (can be configured as needed)
    const targetDiversionRate = 75;  // e.g., 75%
    const targetRecyclingRate = 80;  // e.g., 80%

    // Aggregation pipeline:
    // 1. Filter records within the date range.
    // 2. Lookup dustbin details and filter by branch.
    // 3. Sort descending to get the final reading per day.
    // 4. Group by day and dustbin type, taking the first record (i.e. the final reading).
    // 5. Group by day to sum up:
    //      - totalWaste: sum of final weights.
    //      - nonGeneralWaste: sum of final weights for bins not "General Waste".
    //      - recyclingWaste: sum of final weights for bins "Commingled" or "Paper & Cardboard".
    // 6. Calculate rates per day and include target values.
    // 7. Sort results by day ascending.
    const pipeline = [
        {
            $match: {
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $lookup: {
                from: "dustbins",
                localField: "associateBin",
                foreignField: "_id",
                as: "binData"
            }
        },
        { $unwind: "$binData" },
        {
            $match: {
                "binData.branchAddress": new mongoose.Types.ObjectId(branchId)
            }
        },
        // Sort descending by creation time to get the latest reading per day first.
        { $sort: { createdAt: -1 } },
        // Group by day and bin type to capture the final reading for each bin on that day.
        {
            $group: {
                _id: {
                    day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    binType: "$binData.dustbinType"
                },
                finalWeight: { $first: "$currentWeight" }
            }
        },
        // Group by day to sum up values.
        {
            $group: {
                _id: "$_id.day",
                totalWaste: { $sum: "$finalWeight" },
                nonGeneralWaste: {
                    $sum: {
                        $cond: [
                            { $ne: ["$_id.binType", "General Waste"] },
                            "$finalWeight",
                            0
                        ]
                    }
                },
                recyclingWaste: {
                    $sum: {
                        $cond: [
                            { $in: ["$_id.binType", ["Commingled", "Paper & Cardboard"]] },
                            "$finalWeight",
                            0
                        ]
                    }
                }
            }
        },
        // Project the daily rates.
        {
            $project: {
                _id: 0,
                date: "$_id",
                diversionRate: {
                    $cond: [
                        { $eq: ["$totalWaste", 0] },
                        0,
                        { $multiply: [{ $divide: ["$nonGeneralWaste", "$totalWaste"] }, 100] }
                    ]
                },
                recyclingRate: {
                    $cond: [
                        { $eq: ["$totalWaste", 0] },
                        0,
                        { $multiply: [{ $divide: ["$recyclingWaste", "$totalWaste"] }, 100] }
                    ]
                },
                targetDiversionRate: { $literal: targetDiversionRate },
                targetRecyclingRate: { $literal: targetRecyclingRate }
            }
        },
        { $sort: { date: 1 } }
    ];

    let dailyData;
    try {
        dailyData = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error aggregating daily diversion/recycling data:", error);
        throw new ApiError(500, "Error processing daily diversion/recycling data");
    }

    return res
        .status(200)
        .json(new ApiResponse(200, dailyData, "Daily diversion and recycling data fetched successfully"));
});

export { branchWasteBreakdown, dailyDiversionRecycling };

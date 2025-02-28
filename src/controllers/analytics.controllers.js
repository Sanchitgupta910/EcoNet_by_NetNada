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
 * Aggregates waste data for a specific branch by dustbin type.
 * This endpoint is used to drive the donut chart on the Office Admin dashboard.
 * 
 * Query Parameters:
 *   - branchId: (required) the branch's identifier.
 *   - filter: (optional) time filter (today, thisWeek, lastWeek, lastMonth; default: today).
 *
 * The aggregation pipeline:
 *   1. Filters waste records within the given date range.
 *   2. Joins with the dustbins collection.
 *   3. Filters records to only include those from the specified branch.
 *   4. Groups the data by dustbin type and sums the waste weight.
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

    // Build aggregation pipeline
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
        {
            $group: {
                _id: "$binData.dustbinType",
                totalWaste: { $sum: "$currentWeight" }
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
 * branchWasteRates
 * --------------------------------------------
 * Calculates current landfill diversion and recycling rates for a branch,
 * along with target values for the dual-line area charts.
 *
 * Query Parameters:
 *   - branchId: (required) the branch's identifier.
 *   - filter: (optional) time filter (today, thisWeek, lastWeek, lastMonth; default: today).
 *
 * Steps:
 *   1. Filters waste records based on the date range.
 *   2. Joins with the dustbins collection and filters by branch.
 *   3. Groups by dustbin type to compute the sum of waste weights.
 *   4. Calculates:
 *      - Current Diversion Rate: (Waste from bins other than "General Waste") / (Overall Waste)
 *      - Current Recycling Rate: (Waste from "Commingled" and "Paper & Cardboard") / (Overall Waste)
 *   5. Returns these along with hardcoded target rates (which can be made configurable).
 *
 * @route GET /api/v1/analytics/branchWasteRates?branchId=<branchId>&filter=<filter>
 */
const branchWasteRates = asyncHandler(async (req, res) => {
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

    // Build aggregation pipeline for branch-specific waste data
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
        {
            $group: {
                _id: "$binData.dustbinType",
                totalWaste: { $sum: "$currentWeight" }
            }
        }
    ];

    let aggregationResult;
    try {
        aggregationResult = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error aggregating branch waste rates:", error);
        throw new ApiError(500, "Error processing branch waste rates data");
    }

    // Compute overall totals and rates
    let overallTotalWaste = 0;
    let nonLandfillWaste = 0;
    let recycledWaste = 0;
    aggregationResult.forEach(item => {
        overallTotalWaste += item.totalWaste;
        if (item._id !== "General Waste") {
            nonLandfillWaste += item.totalWaste;
        }
        if (["Commingled", "Paper & Cardboard"].includes(item._id)) {
            recycledWaste += item.totalWaste;
        }
    });
    const currentDiversionRate = overallTotalWaste ? (nonLandfillWaste / overallTotalWaste) * 100 : 0;
    const currentRecyclingRate = overallTotalWaste ? (recycledWaste / overallTotalWaste) * 100 : 0;

    // Set target values (these can be adjusted or made configurable)
    const targetDiversionRate = 75; // Example target value
    const targetRecyclingRate = 80; // Example target value

    const responseData = {
        currentDiversionRate,
        targetDiversionRate,
        currentRecyclingRate,
        targetRecyclingRate,
    };

    return res
        .status(200)
        .json(new ApiResponse(200, responseData, "Branch waste rates fetched successfully"));
});

export { branchWasteBreakdown, branchWasteRates };

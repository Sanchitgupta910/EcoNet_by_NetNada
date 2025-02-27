import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import { Waste } from "../models/waste.models.js";
import { Dustbin } from "../models/dustbin.models.js";
import mongoose from "mongoose";
import {
    startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subWeeks, subMonths, subDays
} from "date-fns";

/**
 * globalSummary
 * --------------------------------------------
 * Aggregates global waste metrics across all companies and branches.
 * 
 * This endpoint calculates:
 *  - Total Waste Collected for a given filter (default: "today")
 *  - Diversion Rate (percentage of waste that is not general waste)
 *  - Recycling Rate (percentage of waste that is counted as recycled, e.g., Commingled and Paper & Cardboard)
 *  - Breakdown by waste type.
 * 
 * Supported filters (via the "filter" query parameter): 
 *   "today", "thisWeek", "lastWeek", "lastMonth"
 * 
 * Note: For high performance on millions of records, ensure indexes exist on:
 *   - createdAt (Waste collection)
 *   - associateBin (foreign key for Waste)
 *
 * @route GET /api/v1/analytics/globalSummary?filter=<filter>
 */
const globalSummary = asyncHandler(async (req, res) => {
    const { filter = "today" } = req.query;
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

    // Aggregation pipeline: filter by date, join with dustbins, group by dustbin type.
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

    const aggregationResult = await Waste.aggregate(pipeline);

    // Compute overall totals.
    let overallTotalWaste = 0;
    aggregationResult.forEach(item => {
        overallTotalWaste += item.totalWaste;
    });

    // Define waste types for diversion and recycling.
    let nonLandfillWaste = 0;
    let recycledWaste = 0;
    aggregationResult.forEach(item => {
        if (item.binType !== "General Waste") {
            nonLandfillWaste += item.totalWaste;
        }
        if (["Commingled", "Paper & Cardboard"].includes(item.binType)) {
            recycledWaste += item.totalWaste;
        }
    });

    const diversionRate = overallTotalWaste ? (nonLandfillWaste / overallTotalWaste) * 100 : 0;
    const recyclingRate = overallTotalWaste ? (recycledWaste / overallTotalWaste) * 100 : 0;

    const responseData = {
        totalWasteCollected: overallTotalWaste,
        diversionRate,
        recyclingRate,
        breakdown: aggregationResult
    };

    // Emit the global summary data via Socket.io.
    const io = req.app.locals.io;
    if (io) {
        io.emit('globalSummaryUpdated', responseData);
    }

    return res.status(200).json(new ApiResponse(200, responseData, "Global summary metrics fetched successfully"));
});


/**
 * globalDailyWasteTrends
 * --------------------------------------------
 * Aggregates daily waste data across the system for trend analysis.
 *
 * This endpoint:
 *  - Accepts an optional date range (defaults to the last 30 days if not provided).
 *  - Filters waste records by the createdAt date.
 *  - Joins waste records with dustbin details to group data by waste type.
 *  - Groups the data by day (formatted as "YYYY-MM-DD") and by waste type.
 *  - Sums the total waste for each combination and sorts the results by day.
 *
 * @route GET /api/v1/analytics/dailyWasteTrends?startDate=<startDate>&endDate=<endDate>
 */

const globalDailyWasteTrends = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    // Default to last 30 days if no dates provided.
    const start = startDate ? new Date(startDate) : subMonths(new Date(), 1);
    const end = endDate ? new Date(endDate) : new Date();

    const pipeline = [
        {
            $match: {
                createdAt: { $gte: start, $lte: end }
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
        // Group records by day and by waste type.
        {
            $group: {
                _id: {
                    day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    wasteType: "$binData.dustbinType"
                },
                totalWaste: { $sum: "$currentWeight" }
            }
        },
        { $sort: { "_id.day": 1 } }
    ];

    const result = await Waste.aggregate(pipeline);
    return res.status(200).json(new ApiResponse(200, result, "Global daily waste trends fetched successfully"));
});

export { globalSummary, globalDailyWasteTrends };

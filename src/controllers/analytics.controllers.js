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
 * Calculates:
 *   - Total Waste Collected (based on the provided time filter)
 *   - Diversion Rate: Percentage of waste that is non-General Waste.
 *   - Recycling Rate: Percentage of waste from Commingled and Paper & Cardboard bins.
 * 
 * Supported filters (via query parameter "filter"):
 *   "today" (default), "thisWeek", "lastWeek", "lastMonth"
 *
 * Errors are thrown with ApiError if required parameters are missing.
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

    // Build the aggregation pipeline for global summary.
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
    if (!aggregationResult) {
        throw new ApiError(500, "Failed to aggregate global summary data");
    }

    // Compute overall totals and rates.
    let overallTotalWaste = aggregationResult.reduce((sum, item) => sum + item.totalWaste, 0);
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

    // Emit data via Socket.io for real-time updates.
    const io = req.app.locals.io;
    if (io) {
        io.emit('globalSummaryUpdated', responseData);
    }

    return res.status(200).json(new ApiResponse(200, responseData, "Global summary metrics fetched successfully"));
});


/**
 * globalDailyWasteTrends
 * --------------------------------------------
 * Aggregates daily waste data over a date range for trend analysis.
 *
 * Defaults: If no startDate or endDate is provided, the last 30 days are used.
 *
 * Groups records by day (formatted as "YYYY-MM-DD") and waste type,
 * then sums the waste weights for each group.
 *
 * @route GET /api/v1/analytics/dailyWasteTrends?startDate=<startDate>&endDate=<endDate>
 */
const globalDailyWasteTrends = asyncHandler(async (req, res) => {
    const { startDate, endDate } = req.query;
    // Default to last 30 days if not provided.
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
    if (!result) {
        throw new ApiError(500, "Failed to aggregate daily waste trends data");
    }
    return res.status(200).json(new ApiResponse(200, result, "Global daily waste trends fetched successfully"));
});


/**
 * globalCrossCompanyComparison
 * --------------------------------------------
 * Aggregates waste data across all companies for cross-company comparison.
 *
 * Steps:
 * 1. Use a date filter (default: "today") to limit records.
 * 2. Join waste records with dustbins, then with branch addresses to get the associated company.
 * 3. Group data by company and sum the total waste.
 * 4. Join with the companies collection to get company names.
 * 5. Sort companies by total waste in descending order.
 *
 * @route GET /api/v1/analytics/crossCompanyComparison?filter=<filter>
 */
const globalCrossCompanyComparison = asyncHandler(async (req, res) => {
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
                as: "dustbinData"
            }
        },
        { $unwind: "$dustbinData" },
        {
            $lookup: {
                from: "branchaddresses", // Ensure this matches the actual collection name.
                localField: "dustbinData.branchAddress",
                foreignField: "_id",
                as: "branchData"
            }
        },
        { $unwind: "$branchData" },
        {
            $group: {
                _id: "$branchData.associatedCompany",
                totalWaste: { $sum: "$currentWeight" }
            }
        },
        {
            $lookup: {
                from: "companies",
                localField: "_id",
                foreignField: "_id",
                as: "companyData"
            }
        },
        { $unwind: "$companyData" },
        {
            $project: {
                _id: 1,
                totalWaste: 1,
                companyName: "$companyData.CompanyName"
            }
        },
        { $sort: { totalWaste: -1 } }
    ];

    const result = await Waste.aggregate(pipeline);
    if (!result) {
        throw new ApiError(500, "Failed to aggregate cross-company comparison data");
    }
    return res.status(200).json(new ApiResponse(200, result, "Global cross-company comparison data fetched successfully"));
});

export { globalSummary, globalDailyWasteTrends, globalCrossCompanyComparison };

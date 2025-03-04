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

// ==============================
// SUPERADMIN DASHBOARD ENDPOINTS
// ==============================

/**
 * globalSummary
 * --------------------------------------------
 * Aggregates system-wide waste metrics across all companies:
 *   - Total Waste Collected (today)
 *   - Overall Diversion Rate (non-General Waste percentage)
 *   - Overall Recycling Rate (combined percentage for Commingled and Paper & Cardboard)
 *
 * Query Parameters:
 *   - filter: (optional) "today", "thisWeek", "lastWeek", "lastMonth" (default: today)
 *
 * @route GET /api/v1/analytics/globalSummary?filter=<filter>
 */
const globalSummary = asyncHandler(async (req, res) => {
    const { filter = "today" } = req.query;
    let startDate, endDate;
    const now = new Date();
    // Set date range based on filter.
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

    // Build aggregation pipeline (system-wide, no branch filter)
    const pipeline = [
        {
            $match: { createdAt: { $gte: startDate, $lte: endDate } }
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

    let summaryData;
    try {
        const aggregationResult = await Waste.aggregate(pipeline);
        // Compute overall totals and rates
        let overallTotal = 0, nonGeneral = 0, recycled = 0;
        aggregationResult.forEach(item => {
            overallTotal += item.totalWaste;
            if (item.binType !== "General Waste") {
                nonGeneral += item.totalWaste;
            }
            if (["Commingled", "Paper & Cardboard"].includes(item.binType)) {
                recycled += item.totalWaste;
            }
        });
        const diversionRate = overallTotal ? (nonGeneral / overallTotal) * 100 : 0;
        const recyclingRate = overallTotal ? (recycled / overallTotal) * 100 : 0;
        summaryData = { overallTotal, diversionRate, recyclingRate };
    } catch (error) {
        console.error("Error in globalSummary:", error);
        throw new ApiError(500, "Failed to process global summary data");
    }

    return res.status(200).json(new ApiResponse(200, summaryData, "Global summary metrics fetched successfully"));
});


/**
 * globalDailyWasteTrends
 * --------------------------------------------
 * Aggregates daily waste data system-wide for trend analysis.
 *
 * Query Parameters:
 *   - startDate (optional)
 *   - endDate (optional)
 *
 * Groups records by day and waste type, then returns time-series data.
 *
 * @route GET /api/v1/analytics/globalDailyWasteTrends?startDate=<startDate>&endDate=<endDate>
 */
const globalDailyWasteTrends = asyncHandler(async (req, res) => {
    let { startDate, endDate } = req.query;
    // Default to last 30 days if not provided
    const now = new Date();
    startDate = startDate ? new Date(startDate) : subMonths(now, 1);
    endDate = endDate ? new Date(endDate) : now;

    const pipeline = [
        {
            $match: { createdAt: { $gte: startDate, $lte: endDate } }
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
                    binType: "$binData.dustbinType"
                },
                dailyWaste: { $sum: "$currentWeight" }
            }
        },
        { $sort: { "_id.day": 1 } }
    ];

    let trendData;
    try {
        trendData = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error aggregating global daily waste trends:", error);
        throw new ApiError(500, "Failed to fetch global daily waste trends");
    }
    return res.status(200).json(new ApiResponse(200, trendData, "Global daily waste trends fetched successfully"));
});


/**
 * globalWasteBreakdown
 * --------------------------------------------
 * Aggregates waste data system-wide by waste category using the final daily readings.
 * Designed to feed a donut chart for system-wide waste breakdown.
 *
 * Query Parameters:
 *   - filter: (optional) time filter ("today", "thisWeek", "lastWeek", "lastMonth"; default: today)
 *
 * @route GET /api/v1/analytics/globalWasteBreakdown?filter=<filter>
 */
const globalWasteBreakdown = asyncHandler(async (req, res) => {
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

    // Pipeline similar to branchWasteBreakdown but without branch filtering
    const pipeline = [
        {
            $match: { createdAt: { $gte: startDate, $lte: endDate } }
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
        { $sort: { createdAt: -1 } },
        {
            $group: {
                _id: {
                    day: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    binType: "$binData.dustbinType"
                },
                finalWeight: { $first: "$currentWeight" }
            }
        },
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

    let breakdownData;
    try {
        breakdownData = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error aggregating global waste breakdown:", error);
        throw new ApiError(500, "Failed to fetch global waste breakdown data");
    }
    return res.status(200).json(new ApiResponse(200, breakdownData, "Global waste breakdown data fetched successfully"));
});


/**
 * crossCompanyComparison
 * --------------------------------------------
 * Aggregates waste data across companies for system-wide comparison.
 * Steps:
 *  1. Use a date filter (default: today) to limit records.
 *  2. Lookup dustbin details, then join with branch addresses to get company information.
 *  3. Group data by company and sum the waste weights.
 *  4. Return sorted data for comparison.
 *
 * @route GET /api/v1/analytics/crossCompanyComparison?filter=<filter>
 */
const crossCompanyComparison = asyncHandler(async (req, res) => {
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

    // Pipeline to join waste with dustbins, then with branch addresses and companies.
    const pipeline = [
        {
            $match: { createdAt: { $gte: startDate, $lte: endDate } }
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
                from: "branchaddresses",
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

    let comparisonData;
    try {
        comparisonData = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error in crossCompanyComparison:", error);
        throw new ApiError(500, "Error processing cross-company comparison data");
    }
    return res.status(200).json(new ApiResponse(200, comparisonData, "Cross-company comparison data fetched successfully"));
});


/**
 * leaderboards
 * --------------------------------------------
 * Returns a ranked list of companies (or branches) based on key performance indicators,
 * such as total waste collected or recycling rates.
 *
 * This endpoint can be used to quickly identify top performers or outliers.
 *
 * @route GET /api/v1/analytics/leaderboards?filter=<filter>
 */
const leaderboards = asyncHandler(async (req, res) => {
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

    // Pipeline to compute KPIs for companies and rank them.
    const pipeline = [
        {
            $match: { createdAt: { $gte: startDate, $lte: endDate } }
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
                from: "branchaddresses",
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

    let leaderboardData;
    try {
        leaderboardData = await Waste.aggregate(pipeline);
    } catch (error) {
        console.error("Error in leaderboards:", error);
        throw new ApiError(500, "Error processing leaderboards data");
    }
    return res.status(200).json(new ApiResponse(200, leaderboardData, "Leaderboards data fetched successfully"));
});

// Export the endpoints
export { branchWasteBreakdown, dailyDiversionRecycling, globalSummary, globalDailyWasteTrends, globalWasteBreakdown, crossCompanyComparison, leaderboards };


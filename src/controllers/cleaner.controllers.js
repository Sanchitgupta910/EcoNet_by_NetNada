import mongoose from 'mongoose';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { ApiResponse } from '../utils/ApiResponse.js';
import { Cleaner } from '../models/cleaner.models.js';

/**
 * Create a new Cleaner.
 * POST /api/v1/cleaners
 */
const createCleaner = asyncHandler(async (req, res) => {
  const { fullName, employeeCode } = req.body;
  if (!fullName) {
    throw new ApiError(400, 'fullName is required');
  }

  const cleaner = await Cleaner.create({ fullName, employeeCode });
  return res.status(201).json(new ApiResponse(201, cleaner, 'Cleaner created successfully'));
});

/**
 * List all Cleaners.
 * GET /api/v1/cleaners
 */
const listCleaners = asyncHandler(async (req, res) => {
  const cleaners = await Cleaner.find().lean();
  return res.status(200).json(new ApiResponse(200, cleaners, 'Cleaners fetched successfully'));
});

/**
 * Get one Cleaner by ID.
 * GET /api/v1/cleaners/:id
 */
const getCleaner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid cleaner ID');
  }
  const cleaner = await Cleaner.findById(id).lean();
  if (!cleaner) {
    throw new ApiError(404, 'Cleaner not found');
  }
  return res.status(200).json(new ApiResponse(200, cleaner, 'Cleaner fetched successfully'));
});

/**
 * Update a Cleaner by ID.
 * PATCH /api/v1/cleaners/:id
 */
const updateCleaner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid cleaner ID');
  }
  const updated = await Cleaner.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  }).lean();
  if (!updated) {
    throw new ApiError(404, 'Cleaner not found');
  }
  return res.status(200).json(new ApiResponse(200, updated, 'Cleaner updated successfully'));
});

/**
 * Delete a Cleaner by ID.
 * DELETE /api/v1/cleaners/:id
 */
const deleteCleaner = asyncHandler(async (req, res) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new ApiError(400, 'Invalid cleaner ID');
  }
  const deleted = await Cleaner.findByIdAndDelete(id).lean();
  if (!deleted) {
    throw new ApiError(404, 'Cleaner not found');
  }
  return res.status(200).json(new ApiResponse(200, null, 'Cleaner deleted successfully'));
});

export { createCleaner, listCleaners, getCleaner, updateCleaner, deleteCleaner };

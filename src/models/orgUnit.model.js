import mongoose from 'mongoose';

/**
 * OrgUnit Schema
 * -------------------------------------------
 * Represents an organizational unit within the hierarchy.
 *
 * Fields:
 *   - name: The name of the unit (e.g., "New York City Branch").
 *   - type: The level of the unit. Allowed values: 'Company', 'Country', 'City', 'Branch'.
 *   - parent: Reference to the parent OrgUnit (null for top-level units).
 *   - branchAddress: (Optional) When type === "Branch", stores a reference to the BranchAddress document.
 */
const orgUnitSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['Company', 'Country', 'Region', 'City', 'Branch'],
      required: true,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrgUnit',
      default: null,
    },
    // Only used when the OrgUnit is a branch.
    branchAddress: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BranchAddress',
      default: null,
    },
  },
  { timestamps: true },
);

export const OrgUnit = mongoose.model('OrgUnit', orgUnitSchema);

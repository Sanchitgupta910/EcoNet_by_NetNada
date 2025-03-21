import mongoose from 'mongoose';

/**
 * OrgUnit Schema
 * -------------------------------------------
 * Represents an organizational unit within the hierarchy.
 *
 * Fields:
 *   - name: The name of the unit (e.g., "Google_Sydney" if using a naming convention).
 *   - type: The level of the unit. Allowed values: 'Company', 'Country', 'Region', 'City', 'Branch'.
 *   - parent: Reference to the parent OrgUnit (null for top-level units).
 *   - branchAddress: (Optional) When type === "Branch", stores a reference to the BranchAddress document.
 *   - company: Reference to the Company that this OrgUnit belongs to.
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
    // New field to associate the OrgUnit with a Company.
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
  },
  { timestamps: true },
);

export const OrgUnit = mongoose.model('OrgUnit', orgUnitSchema);

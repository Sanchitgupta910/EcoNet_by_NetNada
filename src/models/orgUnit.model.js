import mongoose from 'mongoose';

/**
 * OrgUnit Schema
 * -------------------------------------------
 * Represents an organizational unit within the hierarchy.
 *
 * Fields:
 *  - name: The name of the unit (e.g., "New York City", "Main Branch").
 *  - type: The level of the unit. Allowed values: 'Company', 'Country', 'City', 'Branch'.
 *  - parent: Reference to the parent OrgUnit (null for top-level units).
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
      enum: ['Company', 'Country', 'City', 'Branch'],
      required: true,
    },
    parent: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'OrgUnit',
      default: null,
    },
  },
  { timestamps: true },
);

export const OrgUnit = mongoose.model('OrgUnit', orgUnitSchema);

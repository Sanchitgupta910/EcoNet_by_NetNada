import mongoose from 'mongoose';
import { BranchAddress } from './branchAddress.models.js';

const dustbinSchema = new mongoose.Schema(
  {
    dustbinType: {
      type: String,
      enum: ['General Waste', 'Commingled', 'Organic', 'Paper & Cardboard', 'Glass'],
      required: true,
    },
    currentWeight: {
      type: Number,
      default: 0,
    },
    binCapacity: {
      type: Number,
      enum: [25, 50, 75],
      required: true,
    },
    branchAddress: {
      //asociated branch
      type: mongoose.Schema.Types.ObjectId,
      ref: BranchAddress,
      required: true,
    },
  },
  { timestamps: true },
);

//Creating a compound index for faster queries
dustbinSchema.index({ branchAddress: 1 });
export const Dustbin = mongoose.model('Dustbin', dustbinSchema);

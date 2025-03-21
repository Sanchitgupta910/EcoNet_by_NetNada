import mongoose from 'mongoose';
import { Company } from './company.models.js';

const branchAddressSchema = new mongoose.Schema(
  {
    officeName: {
      type: String, // e.g., NetNada Australia, NetNada USA, NetNada India
      required: true,
    },
    address: {
      type: String,
      required: true,
    },
    city: {
      type: String,
      required: true,
    },

    subdivision: {
      type: String,
      required: true,
    },

    subdivisionType: {
      type: String,
      required: true,
    },
    postalCode: {
      type: String,
      required: true,
    },
    country: {
      type: String,
      required: true,
    },
    associatedCompany: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
    },
    isdeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

//Creating a compound index for faster queries
branchAddressSchema.index({ associatedCompany: 1 });
export const BranchAddress = mongoose.model('BranchAddress', branchAddressSchema);

import mongoose from 'mongoose';
import { Dustbin } from './dustbin.models.js';
import { Cleaner } from './cleaner.models.js';

const wasteSchema = new mongoose.Schema(
  {
    associateBin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Dustbin,
      required: true,
    },
    currentWeight: {
      type: Number,
      required: true,
    },
    eventType: {
      type: String,
      enum: ['disposal', 'cleaning'],
      default: 'disposal',
      required: true,
    },
    isCleaned: {
      type: Boolean,
      default: false,
      required: true,
    },
    cleanedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Cleaner,
      required: function () {
        return this.eventType === 'cleaning';
      },
    },
  },
  { timestamps: true },
);

//Creating a compound index for faster queries
wasteSchema.index({ createdAt: -1, associateBin: 1 });
export const Waste = mongoose.model('Waste', wasteSchema);

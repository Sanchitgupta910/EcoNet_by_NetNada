import mongoose from 'mongoose';

const cleanerSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      trim: true,
      required: true,
    },
    code: {
      type: String,
      unique: true,
      trim: true,
      uppercase: true,
    },
  },
  { timestamps: true },
);

export const Cleaner = mongoose.model('Cleaner', cleanerSchema);

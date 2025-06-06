import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import dotenv from 'dotenv';
import { OrgUnit } from './orgUnit.model.js';
import { Company } from './company.models.js';

dotenv.config({
  path: './.env',
});

const userSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      unique: true,
      trim: true,
    },
    phone: {
      type: String,
    },
    password: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: [
        'SuperAdmin',
        'RegionalAdmin',
        'CountryAdmin',
        'CityAdmin',
        'OfficeAdmin',
        'EmployeeDashboardUser',
        'BinDisplayUser',
      ],
      required: true,
    },
    refreshToken: {
      type: String,
    },
    company: {
      type: mongoose.Schema.Types.ObjectId,
      ref: Company,
      required: true,
    },
    OrgUnit: {
      type: mongoose.Schema.Types.ObjectId,
      ref: OrgUnit,
      required: true,
    },
    isdeleted: {
      type: Boolean,
      default: false,
    },

    createdby: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    resetPasswordToken: {
      type: String,
      default: undefined,
    },
    resetPasswordExpires: {
      type: Date,
      default: undefined,
    },
    forcePasswordReset: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// Pre-save hook to hash the password before saving it in the database
userSchema.pre('save', async function (next) {
  // If the password field is not modified, skip the hashing process
  if (!this.isModified('password')) return next();

  // Hash the password using bcrypt with a salt factor of 10
  this.password = await bcrypt.hash(this.password, 10);
  next();
});

// Method to check if the provided password matches the hashed password
userSchema.methods.isPasswordCorrect = async function (password) {
  // Compare the provided password with the stored hashed password using bcrypt
  return await bcrypt.compare(password, this.password);
};

// Method to generate an access token for the user using JWT
userSchema.methods.generateAccessToken = function () {
  // Sign a JWT with the user's ID, full name, and email
  return jwt.sign(
    {
      _id: this._id,
      FullName: this.fullName,
      Email: this.email,
    },
    process.env.ACCESS_TOKEN_SECRET, // Use the secret from the .env file
    {
      expiresIn: process.env.ACCESS_TOKEN_EXPIRY, // Token expiry time from the .env file
    },
  );
};

// Method to generate a refresh token for the user using JWT
userSchema.methods.generateRefreshToken = function () {
  // Sign a refresh token using the user's ID
  return jwt.sign(
    {
      _id: this._id,
    },
    process.env.REFRESH_TOKEN_SECRET, // Use the refresh token secret from the .env file
    {
      expiresIn: process.env.REFRESH_TOKEN_EXPIRY, // Token expiry time from the .env file
    },
  );
};

// Export the User model so it can be used in other parts of the application
export const User = mongoose.model('User', userSchema);

import mongoose from "mongoose";
import { Company } from "./company.models.js"


const branchAddressSchema = new mongoose.Schema({
    address: {
        type: String,
        required: true,
    },
    city: {
        type: String,
        required: true,
    },
    state: {
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
    associatedCompany : {
        type: mongoose.Schema.Types.ObjectId,
        ref: Company
    }

}, { timestamps: true });

export const BranchAddress = mongoose.model("BranchAddress", branchAddressSchema);

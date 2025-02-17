import mongoose from "mongoose";
import {BranchAddress} from "./branchAddress.models.js";

const companySchema = new mongoose.Schema({
    CompanyName: {
        type: String,
        required: true,
        index: true,
    },
    domain: {
        type: String,
        required: true,
        lowercase: true,
        unique: true,
    },
    noofEmployees: {
        type: Number,
    },
    isdeleted :{
        type: Boolean,
        default: false
    }
}, { timestamps: true });


//virtual field to populate branch address
companySchema.virtual("branchAddresses",{
    ref: BranchAddress,
    localField: "_id",
    foreignField: "associatedCompany",
    justOne: false
});

// Include virtuals when converting to JSON or objects
companySchema.set("toObject", { virtuals: true });
companySchema.set("toJSON", { virtuals: true });

export const Company = mongoose.model("Company", companySchema);

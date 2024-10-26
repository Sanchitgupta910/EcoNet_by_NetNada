import mongoose from "mongoose";


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
}, { timestamps: true });

export const Company = mongoose.model("Company", companySchema);

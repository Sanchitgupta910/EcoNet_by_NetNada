import mongoose from "mongoose"
import { Dustbin } from "./dustbin.models.js"

const wasteSchema = new mongoose.Schema({
    associateBin :{
        type: mongoose.Schema.Types.ObjectId,
        ref: Dustbin,
        required: true
    },
    currentWeight :{
        type: Number,
        required: true
    }
},{timestamps:true})

export const Waste = mongoose.model("Waste",wasteSchema)
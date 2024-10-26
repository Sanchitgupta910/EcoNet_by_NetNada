import mongoose from "mongoose";
import {Company} from "./company.models.js"
import {Address} from "./adresses.models.js"
import {User} from "./user.models.js"

const branchSchema = new mongoose.Schema({
    branchName : {
        type: String,
        required:true
    },
    company :{
        type: mongoose.Schema.Types.ObjectId,
        ref: Company
    },
    address :{
        type: mongoose.Schema.Types.ObjectId,
        ref: Address
    },
    user :{
        type: mongoose.Schema.Types.ObjectId,
        ref: User
    }

},{timestamps: true})



export const Branch = mongoose.model("Branch", branchSchema)
import mongoose from "mongoose"
import { Waste } from "./waste.models.js"
import {Branch} from "./companyBranch.models.js"

const dustbinSchema = new mongoose.Schema({
    dustbinType :{
        type: String,
        enum: ['Landfill','Recycling','Paper','Organic'],
        required: true
    },
    currentWeight :{
        type: Number,
        required: true
    },
    binCapacity :{
        type: Number,
        enum : [25,50,75],
        required: true
    },
    branch : {
      type: mongoose.Schema.Types.ObjectId,
      ref: Branch
    }

},{timestamps:true})

dustbinSchema.methods.checkCapacity = function (){
    if (this.currentWeight>=this.binCapacity*0.9){
        return `Warning! The ${this.dustbinType} bin is full. Please empty the bin`
    }
    return ``
}


dustbinSchema.methods.updateCurrentWeight = async function() {
    try {
      // Find the latest WasteData entry for this dustbin
      const latestWasteData = await Waste.findOne({ bin_id: this._id })
        .sort({ timestamp: -1 }); // Sort by timestamp to get the latest
  
      if (latestWasteData) {
        // Update current_weight with the latest waste weight
        this.current_weight = latestWasteData.weight;
        // Mongoose will automatically update 'updatedAt'
  
        // Save the changes to the dustbin document
        await this.save();
      }
    } catch (error) {
      console.error("Error updating current weight:", error);
      throw error;
    }
  };

export const Dustbin= mongoose.model("Dustbin", dustbinSchema)
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

//// Aggregation function to calculate the total waste weight for each dustbin

const updateDustbinWeight = async (dustbinId) => {
    try {
      // Aggregate the total weight for the specific dustbin
      const result = await Waste.aggregate([
        { $match: { associateBin: dustbinId } },  // Match all waste linked to the dustbin
        { $group: { _id: "$associateBin", totalWeight: { $sum: "$currentWeight" } } }  // Sum the weight
      ]);
  
      // If result has total weight, update the dustbin's current weight
      const totalWeight = result.length > 0 ? result[0].totalWeight : 0;
      await Dustbin.findByIdAndUpdate(dustbinId, { currentWeight: totalWeight });
    } catch (error) {
      console.error("Error updating dustbin weight:", error);
    }
  };
  
  // Trigger update after saving waste
  wasteSchema.post("save", function (doc) {
    updateDustbinWeight(doc.associateBin);
  });

export const Waste = mongoose.model("Waste",wasteSchema)
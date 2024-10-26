import connectDB from "./db/index.js";
import dotenv from "dotenv";
import { app } from "./app.js";

dotenv.config({
    path: './src/.env'
})




connectDB() //function defined under db->index.js
.then(()=>{
    app.listen(process.env.PORT || 8000, ()=>{
        console.log(`⚙️  Server running on port: ${process.env.PORT}`)
    })
})
.catch((err)=>{
    console.log("MongoDB Connection failed !!! ", err)
})












// *****************************Another approach to connect DB************************************
// ( async  () => {
//     try {
//         await mongoose.connect(`${process.env.MONGODB_URI}/${DB_NAME}`)
//         app.on("error", (error)=> {
//             console.log("Error", error)
//             throw error
//         })
//         app.listen(process.env.PORT, ()=> {
//             console.log(`App is running on Port: ${process.env.PORT}`)
//         })
//     } catch (error) {
//         console.log("Error:", error)
        
//     }
// })()

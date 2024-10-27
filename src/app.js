import express from "express"
import cors from "cors"
import cookieParser from "cookie-parser"


const app = express()
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}))

app.use(express.json({limit:"16kb"}))
app.use(express.urlencoded({extended:true, limit:"16kb"}))
// app.use(express.static())
app.use(cookieParser())


//Routes import
import CompanyRouter from './routes/company.routes.js'
import AddressRouter from './routes/address.routes.js'
import UserRouter from './routes/user.routes.js'
import DustbinRouter from './routes/dustbin.routes.js'
import WasteRoute from './routes/waste.routes.js'

//routes declaration
app.use("/api/v1/company", CompanyRouter) 
app.use("/api/v1/address", AddressRouter)
app.use("/api/v1/users", UserRouter)
app.use("/api/v1/dustbin", DustbinRouter)
app.use("/api/v1/waste", WasteRoute)


export {app}
# EcoNet by NetNada | Near-Real-Time Waste Management Project

An innovative, IoT-enabled waste management solution that helps companies efficiently monitor and manage waste levels, optimize bin usage, and streamline waste collection through real-time data.

## Table of Contents
- [Project Overview](#project-overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Database Schema](#database-schema)
- [Installation](#installation)
- [Usage](#usage)
- [API Endpoints](#api-endpoints)
- [License](#license)

---

## Project Overview
EcoNet is a smart waste management system designed for businesses to monitor and manage waste across different office locations. It uses IoT-enabled sensors to measure waste levels in bins, enabling real-time data monitoring and efficient scheduling for waste collection.

## Features
- **User Management**: Admins can manage multiple offices and users within the company.
- **Real-Time Waste Monitoring**: IoT-enabled sensors track waste levels in various types of bins (recycling, landfill, organic, paper).
- **Notifications**: Alerts sent when bins reach a specific capacity, enabling timely waste collection.
- **Admin Dashboard**: Super Admins have an overview of all offices' waste data and can add or manage users.

## Tech Stack
- **Frontend**: React
- **Backend**: Node.js, Express.js
- **Database**: MongoDB
- **IoT Integration**: Sensors for real-time waste monitoring

## Database Schema
### **Collections**
1. **Company**
   - Fields: name, domain, number of employees, timestamps.

2. **Address**
   - Fields: Address, city, state, country, postal code

3. **Users**
   - Fields: full name, role, email address, timestamps.

4. **Company Branches**
    - Fields: Company reference, Address reference, user reference

5. **Dustbins**
   - Fields: dustbin type, capacity, current weight, linked company and office address, custom message for 90% bin capacity.

6. **Waste Data**
   - Fields: bin ID, weight, created at timestamp.

## Installation
To get started with the project locally, follow these steps:

1. **Clone the Repository**  
   ```bash
   git clone <repository_url>
   cd EcoNet-waste-management

2. **Install dependencies**
    Check package.json to know more about the dependencies

## Usage -- to be updated --

## API- endpoints --to be updated--

## License 
This project is licensed under the MIT License.
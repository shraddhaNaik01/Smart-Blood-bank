# Smart Blood Bank Management System 🩸✨

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=000)
![bcrypt](https://img.shields.io/badge/bcrypt-6B7280?style=for-the-badge&logoColor=white)
![dotenv](https://img.shields.io/badge/dotenv-ECD53F?style=for-the-badge&logoColor=000)

A smart, role-based blood bank platform that connects **Donors**, **Recipients**, **Hospitals**, and **Admins** to manage blood inventory, requests, and verification—fast, secure, and life-saving. 

## Key Functionalities 🚀

- **Role-based onboarding & profiles** for Donor / Recipient / Hospital Admin / System Admin
- **Blood stock & inventory management** with low-stock + expiry alerts
- **Donation verification workflow** that updates hospital stock automatically
- **Recipient blood requests** with **blood-group compatibility checks**
- **Dashboards** for donors, recipients, and hospitals (history, stats, urgent requests)

## Tech Stack & Tools 🛠️

### Core

![Node.js](https://img.shields.io/badge/Node.js-LTS-339933?style=flat-square&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-API-000000?style=flat-square&logo=express&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-Database-4479A1?style=flat-square&logo=mysql&logoColor=white)

### Libraries

![mysql2](https://img.shields.io/badge/mysql2-promise-2D9CDB?style=flat-square)
![bcrypt](https://img.shields.io/badge/bcrypt-password%20hashing-6B7280?style=flat-square)
![dotenv](https://img.shields.io/badge/dotenv-env%20config-ECD53F?style=flat-square&logoColor=000)
![cors](https://img.shields.io/badge/cors-cross--origin-8B5CF6?style=flat-square)

### Frontend

![HTML](https://img.shields.io/badge/HTML5-UI-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS](https://img.shields.io/badge/CSS3-Styling-1572B6?style=flat-square&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Logic-F7DF1E?style=flat-square&logo=javascript&logoColor=000)

- **Frontend**: Static HTML/CSS/JS dashboards (served via Express)
- **API / Connectivity**: REST APIs, `cors`
- **Database driver**: `mysql2/promise`
- **Auth/Security**: `bcrypt` password hashing
- **Config**: `dotenv`

## Project Structure 📁

- `frontend/` – UI pages + the Express server (`frontend/server.js`)
- `.env` – environment variables (not committed)

## Run Locally (Windows / macOS / Linux) ⚡

### 1) Prerequisites

- Node.js (LTS recommended)
- MySQL Server (running)

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment variables

Create a `.env` file in the project root (`Bloodbank/.env`) with:

```env
PORT=3000
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_DATABASE=your_database_name
DB_PORT=3306
```

### 4) Start the server

```bash
node frontend/server.js
```

### 5) Open the app

- Visit: `http://localhost:3000/`
- The static frontend is served from `frontend/` (e.g. `index.html` and dashboards)

---

Made to make every drop count. 🩸🌍

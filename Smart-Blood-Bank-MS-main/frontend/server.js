// Load environment variables from .env file
require('dotenv').config();

// Import required modules
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');

// Configuration
const saltRounds = 10; // Standard salt complexity
const port = process.env.PORT || 3000; // Server will run on port 3000

// Initialize Express app
const app = express();

// --- Middleware Setup ---
app.use(cors()); // Allows the front-end (on a different port/origin) to connect
app.use(express.json()); // Allows parsing of JSON request body (for POST requests)

// Serve static files (HTML, CSS, JS)
app.use(express.static(path.join(__dirname)));

// --- Database Connection Pool ---
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    port: process.env.DB_PORT,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

// Test connection when server starts
pool.getConnection()
    .then(connection => {
        console.log('✅ Database connected successfully!');
        connection.release();
    })
    .catch(err => {
        console.error('❌ Database connection failed. Check .env file and MySQL service:', err.message);
        // You might want to exit the process here if the connection is critical
        // process.exit(1); 
    });


// --- 🩸 API Endpoints ---


/**
 * Default Route Handler
 * GET /
 * Confirms the server is running.
 */
app.get('/', (req, res) => {
    res.status(200).send('RakhtLink API Server is running. Access API endpoints via /api/...');
});
/**
 * Endpoint for Step 1: Account Creation (User & Basic Record based on Role)
 * POST /api/register-account
 */
app.post('/api/register-account', async (req, res) => {
    const { name, email, contact, password, userRole } = req.body;
    
    // Validate required fields
    if (!userRole || !['Donor', 'Recipient', 'HospitalAdmin', 'SystemAdmin'].includes(userRole)) {
        return res.status(400).json({ error: 'Valid user role is required.' });
    }
    
    // Hash the password
    const hash = await bcrypt.hash(password, saltRounds);

    // Use a transaction for safety
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        let associatedId;
        
        // Create role-specific record based on user type
        if (userRole === 'Donor') {
            // Insert into Donor table with minimal data (Age will be added in Step 2)
            const donorSql = `
                INSERT INTO Donor 
                (Donor_Name, Age, Medical_Status) 
                VALUES (?, ?, ?)
            `;
            const donorValues = [name, 18, 'Profile Incomplete']; // Minimum age to satisfy constraint
            const [donorResult] = await connection.query(donorSql, donorValues);
            associatedId = donorResult.insertId;
            
        } else if (userRole === 'Recipient') {
            // Insert into Recipient table with minimal required fields and default hospital
            const recipientSql = `
                INSERT INTO Recipient 
                (Recipient_Name, Contact, Blood_Group_Required, Hospital_ID) 
                VALUES (?, ?, ?, ?)
            `;
            const recipientValues = [name, contact, 'O+', 1]; // Default to first hospital, will be updated in profile
            const [recipientResult] = await connection.query(recipientSql, recipientValues);
            associatedId = recipientResult.insertId;
            
        } else if (userRole === 'HospitalAdmin') {
            // Insert into Hospital table matching your schema
            const hospitalSql = `
                INSERT INTO Hospital 
                (Hospital_Name, Admin_Name, Contact_Info) 
                VALUES (?, ?, ?)
            `;
            const hospitalValues = [name, name, contact]; // Admin_Name is the person's name
            const [hospitalResult] = await connection.query(hospitalSql, hospitalValues);
            associatedId = hospitalResult.insertId;
            
        } else if (userRole === 'SystemAdmin') {
            // System admins don't need an associated table entry
            // They have full system access
            associatedId = null;
        }

        // Insert into User table
        const userSql = `
            INSERT INTO User 
            (Email, Password_Hash, User_Role, Associated_ID) 
            VALUES (?, ?, ?, ?)
        `;
        const userValues = [email, hash, userRole, associatedId];
        await connection.query(userSql, userValues);

        await connection.commit();

        res.status(201).json({ 
            message: `${userRole} account created! Proceed to profile completion.`, 
            user_id: associatedId,
            user_role: userRole
        });

    } catch (error) {
        await connection.rollback();
        console.error('Error during account registration:', error);
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This email is already registered.' });
        }
        res.status(500).json({ error: 'Account registration failed due to a server error.' });
    } finally {
        connection.release();
    }
});

/**
 * Endpoint for Step 2: Complete Donor Profile
 * POST /api/complete-donor-profile
 */
app.post('/api/complete-donor-profile', async (req, res) => {
    const { userId, age, gender, bloodGroup, location, medicalStatus, medicalIssues } = req.body;

    if (age < 18 || age > 60) {
        return res.status(400).json({ error: 'Donor age must be between 18 and 60.' });
    }
    
    try {
        // Note: We're storing medical issues in Medical_Status field for now
        // In a real system, you might want to add a separate Medical_Notes column
        const medicalInfo = medicalIssues ? `${medicalStatus} - Notes: ${medicalIssues}` : medicalStatus;
        
        const sql = `
            UPDATE Donor 
            SET Age = ?, Gender = ?, Blood_Group = ?, Location = ?, Medical_Status = ?, Last_Donation_Date = NULL 
            WHERE Donor_ID = ?
        `;
        const values = [age, gender, bloodGroup, location, medicalInfo, userId];
        
        const [result] = await pool.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Donor record not found for update.' });
        }

        const statusMessage = medicalStatus === 'Fit' 
            ? 'Profile completed! You are eligible to donate blood.' 
            : 'Profile completed! Medical assessment will be required before donation.';

        res.status(200).json({ 
            message: statusMessage,
        });

    } catch (error) {
        console.error('Error updating donor profile:', error);
        res.status(500).json({ error: 'Profile update failed due to a server error.' });
    }
});

/**
 * Endpoint for updating donor profile from dashboard
 * POST /api/update-donor-profile
 */
app.post('/api/update-donor-profile', async (req, res) => {
    const { userId, age, gender, bloodGroup, location, medicalStatus, medicalIssues } = req.body;

    if (age < 18 || age > 60) {
        return res.status(400).json({ error: 'Donor age must be between 18 and 60.' });
    }
    
    try {
        // Combine medical status and issues like the original endpoint
        const medicalInfo = medicalIssues ? `${medicalStatus} - Notes: ${medicalIssues}` : medicalStatus;
        
        const sql = `
            UPDATE Donor 
            SET Age = ?, Gender = ?, Blood_Group = ?, Location = ?, Medical_Status = ?
            WHERE Donor_ID = ?
        `;
        const values = [age, gender, bloodGroup, location, medicalInfo, userId];
        
        const [result] = await pool.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Donor record not found for update.' });
        }

        res.status(200).json({ 
            message: 'Profile updated successfully!',
        });

    } catch (error) {
        console.error('Error updating donor profile:', error);
        res.status(500).json({ error: 'Profile update failed due to a server error.' });
    }
});

/**
 * Endpoint for updating recipient profile from dashboard
 * POST /api/update-recipient-profile
 */
app.post('/api/update-recipient-profile', async (req, res) => {
    const { userId, age, gender, bloodGroup, location, urgency } = req.body;

    if (age < 1 || age > 100) {
        return res.status(400).json({ error: 'Age must be between 1 and 100.' });
    }
    
    try {
        const sql = `
            UPDATE Recipient 
            SET Age = ?, Gender = ?, Blood_Group_Required = ?, Location = ?, Urgency_Level = ?
            WHERE Recipient_ID = ?
        `;
        const values = [age, gender, bloodGroup, location, urgency, userId];
        
        const [result] = await pool.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Recipient record not found for update.' });
        }

        res.status(200).json({ 
            message: 'Profile updated successfully!',
        });

    } catch (error) {
        console.error('Error updating recipient profile:', error);
        res.status(500).json({ error: 'Profile update failed due to a server error.' });
    }
});

/**
 * Endpoint for Step 2: Complete Hospital Profile
 * POST /api/complete-hospital-profile
 */
app.post('/api/complete-hospital-profile', async (req, res) => {
    const { userId, hospitalName, location, contactInfo, licenseNumber, hospitalType } = req.body;

    if (!hospitalName || !location || !contactInfo || !licenseNumber) {
        return res.status(400).json({ error: 'All fields are required: Hospital Name, Location, Contact Info, and License Number.' });
    }
    
    try {
        const sql = `
            UPDATE Hospital 
            SET Hospital_Name = ?, Location = ?, Contact_Info = ?, License_Number = ?, Hospital_Type = ?
            WHERE Hospital_ID = ?
        `;
        const values = [hospitalName, location, contactInfo, licenseNumber, hospitalType || 'Private', userId];
        
        const [result] = await pool.query(sql, values);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Hospital record not found for update.' });
        }

        res.status(200).json({ 
            message: 'Hospital profile completed successfully! Your account is now active and ready for blood bank management.',
        });

    } catch (error) {
        console.error('Error updating hospital profile:', error);
        
        // Handle duplicate license number error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ error: 'This license number is already registered. Please check your license number or contact support.' });
        }
        
        res.status(500).json({ error: 'Profile update failed due to a server error.' });
    }
});

/**
 * Endpoint to get donor dashboard data
 * GET /api/donor-dashboard/:donorId
 */
app.get('/api/donor-dashboard/:donorId', async (req, res) => {
    const { donorId } = req.params;
    
    try {
        // Get donor basic info
        const [donorInfo] = await pool.query(
            'SELECT * FROM Donor WHERE Donor_ID = ?', 
            [donorId]
        );
        
        if (donorInfo.length === 0) {
            return res.status(404).json({ error: 'Donor not found.' });
        }
        
        const donor = donorInfo[0];
        
        // Get donation history from Donation_Record table
        const [donationHistory] = await pool.query(`
            SELECT 
                dr.Donation_Date,
                dr.Verified_By,
                h.Hospital_Name as Location,
                bs.Blood_Group,
                'Completed' as Status
            FROM Donation_Record dr
            LEFT JOIN Blood_Stock bs ON dr.Stock_ID = bs.Stock_ID
            LEFT JOIN Hospital h ON bs.Hospital_ID = h.Hospital_ID
            WHERE dr.Donor_ID = ?
            ORDER BY dr.Donation_Date DESC
        `, [donorId]);
        
        // Calculate eligibility (56 days after last donation)
        let isEligible = true;
        let nextEligibleDate = null;
        
        if (donor.Last_Donation_Date) {
            const lastDonation = new Date(donor.Last_Donation_Date);
            const nextEligible = new Date(lastDonation.getTime() + (56 * 24 * 60 * 60 * 1000));
            const today = new Date();
            
            if (today < nextEligible) {
                isEligible = false;
                nextEligibleDate = nextEligible.toISOString().split('T')[0];
            }
        }
        
        // Get urgent blood requests matching donor's blood group
        const [urgentRequests] = await pool.query(`
            SELECT 
                br.Request_ID,
                r.Recipient_Name,
                br.Blood_Group_Requested,
                br.Quantity,
                br.Request_Date,
                h.Hospital_Name,
                h.Location
            FROM Blood_Request br
            LEFT JOIN Recipient r ON br.Recipient_ID = r.Recipient_ID
            LEFT JOIN Hospital h ON r.Hospital_ID = h.Hospital_ID
            WHERE br.Blood_Group_Requested = ? 
            AND br.Status = 'Pending'
            ORDER BY br.Request_Date ASC
            LIMIT 5
        `, [donor.Blood_Group]);
        
        res.status(200).json({
            donor: {
                name: donor.Donor_Name,
                bloodGroup: donor.Blood_Group,
                age: donor.Age,
                gender: donor.Gender,
                location: donor.Location,
                medicalStatus: donor.Medical_Status,
                lastDonationDate: donor.Last_Donation_Date
            },
            eligibility: {
                isEligible,
                nextEligibleDate
            },
            donationHistory,
            totalDonations: donationHistory.length,
            urgentRequests
        });
        
    } catch (error) {
        console.error('Error fetching donor dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data.' });
    }
});

/**
 * Endpoint to get hospital dashboard data
 * GET /api/hospital-dashboard/:hospitalId
 */
app.get('/api/hospital-dashboard/:hospitalId', async (req, res) => {
    const { hospitalId } = req.params;
    
    console.log('Hospital Dashboard API called for ID:', hospitalId);
    
    try {
        // Get hospital basic info
        const [hospitalInfo] = await pool.query(
            'SELECT * FROM Hospital WHERE Hospital_ID = ?', 
            [hospitalId]
        );
        
        console.log('Hospital query result:', hospitalInfo);
        
        if (hospitalInfo.length === 0) {
            console.log('Hospital not found for ID:', hospitalId);
            return res.status(404).json({ error: 'Hospital not found.' });
        }
        
        const hospital = hospitalInfo[0];
        console.log('Hospital record details:', hospital);
        
        // Get blood stock inventory for this hospital
        const [bloodStock] = await pool.query(`
            SELECT 
                Blood_Group,
                SUM(Quantity) as Total_Units,
                MIN(Expiry_Date) as Earliest_Expiry,
                COUNT(*) as Stock_Entries
            FROM Blood_Stock 
            WHERE Hospital_ID = ? AND Quantity > 0
            GROUP BY Blood_Group
            ORDER BY Blood_Group
        `, [hospitalId]);
        
        // Get recent donations to this hospital (using Stock_ID to find hospital)
        const [recentDonations] = await pool.query(`
            SELECT 
                dr.Donation_Date,
                d.Donor_Name,
                d.Blood_Group,
                d.Age,
                dr.Verified_By,
                bs.Hospital_ID
            FROM Donation_Record dr
            INNER JOIN Donor d ON dr.Donor_ID = d.Donor_ID
            LEFT JOIN Blood_Stock bs ON dr.Stock_ID = bs.Stock_ID
            WHERE bs.Hospital_ID = ?
            ORDER BY dr.Donation_Date DESC
            LIMIT 10
        `, [hospitalId]);
        
        // Get pending blood requests for this hospital
        const [pendingRequests] = await pool.query(`
            SELECT 
                br.Request_ID,
                br.Blood_Group_Requested,
                br.Quantity,
                br.Request_Date,
                r.Recipient_Name,
                r.Contact,
                br.Status
            FROM Blood_Request br
            JOIN Recipient r ON br.Recipient_ID = r.Recipient_ID
            WHERE r.Hospital_ID = ? AND br.Status = 'Pending'
            ORDER BY br.Request_Date ASC
        `, [hospitalId]);
        
        // Get low stock alerts (less than 5 units)
        const [lowStockAlerts] = await pool.query(`
            SELECT 
                Blood_Group,
                SUM(Quantity) as Total_Units
            FROM Blood_Stock 
            WHERE Hospital_ID = ? AND Quantity > 0
            GROUP BY Blood_Group
            HAVING SUM(Quantity) < 5
        `, [hospitalId]);
        
        // Get expiring stock (within 7 days)
        const [expiringStock] = await pool.query(`
            SELECT 
                Stock_ID,
                Blood_Group,
                Quantity,
                Expiry_Date,
                Storage_Type
            FROM Blood_Stock 
            WHERE Hospital_ID = ? 
            AND Expiry_Date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)
            AND Quantity > 0
            ORDER BY Expiry_Date ASC
        `, [hospitalId]);
        
        // Get pending donations for verification (unverified donations for this hospital)
        const [pendingDonations] = await pool.query(`
            SELECT 
                dr.Record_ID,
                dr.Donation_Date,
                d.Donor_Name,
                d.Blood_Group,
                d.Age,
                dr.Verified_By,
                dr.Stock_ID
            FROM Donation_Record dr
            INNER JOIN Donor d ON dr.Donor_ID = d.Donor_ID
            LEFT JOIN Blood_Stock bs ON dr.Stock_ID = bs.Stock_ID
            WHERE (bs.Hospital_ID = ? OR dr.Stock_ID IS NULL)
            AND (dr.Verified_By IS NULL OR dr.Verified_By = '' OR dr.Verified_By = 'System')
            ORDER BY dr.Donation_Date DESC
        `, [hospitalId]);
        
        res.status(200).json({
            hospital: {
                name: hospital.Hospital_Name,
                location: hospital.Location,
                contactInfo: hospital.Contact_Info,
                licenseNumber: hospital.License_Number,
                hospitalType: hospital.Hospital_Type
            },
            bloodStock,
            recentDonations,
            pendingDonations,
            pendingRequests,
            lowStockAlerts,
            expiringStock,
            totalDonations: recentDonations.length,
            totalRequests: pendingRequests.length,
            pendingVerifications: pendingDonations.length
        });
        
    } catch (error) {
        console.error('Error fetching hospital dashboard data:', error);
        console.error('Error details:', error.message);
        res.status(500).json({ error: 'Failed to fetch dashboard data.', details: error.message });
    }
});

/**
 * Endpoint to verify a donation
 * POST /api/verify-donation
 */
app.post('/api/verify-donation', async (req, res) => {
    const { recordId, hospitalId, verifiedBy } = req.body;
    
    if (!recordId || !hospitalId || !verifiedBy) {
        return res.status(400).json({ error: 'Record ID, Hospital ID, and verifier name are required.' });
    }
    
    try {
        console.log('Verifying donation:', { recordId, hospitalId, verifiedBy });
        
        // Get donation details first
        const [donationDetails] = await pool.query(`
            SELECT dr.*, d.Blood_Group 
            FROM Donation_Record dr
            INNER JOIN Donor d ON dr.Donor_ID = d.Donor_ID
            WHERE dr.Record_ID = ?
        `, [recordId]);
        
        if (donationDetails.length === 0) {
            return res.status(404).json({ error: 'Donation record not found.' });
        }
        
        const donation = donationDetails[0];
        console.log('Donation details:', donation);
        
        // Update the donation record as verified by the hospital
        const updateSql = `
            UPDATE Donation_Record 
            SET Verified_By = ?
            WHERE Record_ID = ?
        `;
        
        const [result] = await pool.query(updateSql, [`Hospital_${hospitalId}`, recordId]);
        
        console.log('Update result:', result);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Failed to update donation record.' });
        }
        
        // Add blood to hospital's stock inventory
        const bloodGroup = donation.Blood_Group;
        const quantity = 1; // Each donation = 1 unit
        const expiryDate = new Date();
        expiryDate.setDate(expiryDate.getDate() + 42); // Blood expires in 42 days
        
        // Check if blood stock entry already exists for this blood group
        const [existingStock] = await pool.query(`
            SELECT Stock_ID, Quantity 
            FROM Blood_Stock 
            WHERE Hospital_ID = ? AND Blood_Group = ? AND Expiry_Date > CURDATE()
            ORDER BY Expiry_Date ASC 
            LIMIT 1
        `, [hospitalId, bloodGroup]);
        
        let stockId;
        let stockResult;
        
        if (existingStock.length > 0) {
            // Update existing stock
            stockId = existingStock[0].Stock_ID;
            const updateStockSql = `
                UPDATE Blood_Stock 
                SET Quantity = Quantity + ?
                WHERE Stock_ID = ?
            `;
            stockResult = await pool.query(updateStockSql, [quantity, stockId]);
            console.log('Updated existing stock:', stockResult);
        } else {
            // Create new stock entry
            const insertStockSql = `
                INSERT INTO Blood_Stock 
                (Hospital_ID, Blood_Group, Quantity, Expiry_Date, Storage_Type) 
                VALUES (?, ?, ?, ?, ?)
            `;
            const [insertResult] = await pool.query(insertStockSql, [
                hospitalId, 
                bloodGroup, 
                quantity, 
                expiryDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
                'Refrigerated'
            ]);
            stockId = insertResult.insertId;
            console.log('Created new stock entry with ID:', stockId);
        }
        
        // Update the donation record to link it to the blood stock
        const linkStockSql = `
            UPDATE Donation_Record 
            SET Stock_ID = ?
            WHERE Record_ID = ?
        `;
        await pool.query(linkStockSql, [stockId, recordId]);
        console.log('Linked donation to stock ID:', stockId);
        
        res.status(200).json({ 
            message: 'Donation verified successfully and added to blood stock!',
            donation: {
                recordId: recordId,
                bloodGroup: donation.Blood_Group,
                donationDate: donation.Donation_Date
            },
            stockAdded: {
                bloodGroup: bloodGroup,
                quantity: quantity,
                hospitalId: hospitalId
            }
        });
        
    } catch (error) {
        console.error('Error verifying donation:', error);
        res.status(500).json({ error: 'Failed to verify donation.' });
    }
});

/**
 * Endpoint to get list of hospitals for recipient profile
 * GET /api/hospitals
 */
app.get('/api/hospitals', async (req, res) => {
    try {
        const [hospitals] = await pool.query(
            'SELECT Hospital_ID, Hospital_Name, Location FROM Hospital ORDER BY Hospital_Name'
        );
        
        res.status(200).json(hospitals);
    } catch (error) {
        console.error('Error fetching hospitals:', error);
        res.status(500).json({ error: 'Failed to fetch hospitals.' });
    }
});

/**
 * Endpoint to complete recipient profile
 * POST /api/complete-recipient-profile
 */
app.post('/api/complete-recipient-profile', async (req, res) => {
    const { userId, age, gender, bloodGroup, urgency, location, hospitalId } = req.body;

    console.log('Received recipient profile data:', req.body);

    // Validate required fields (handle both strings and numbers)
    const missingFields = [];
    if (!userId || userId === '' || userId === 'null') missingFields.push('userId');
    if (!age || age === '' || age === 0) missingFields.push('age');
    if (!gender || gender === '') missingFields.push('gender');
    if (!bloodGroup || bloodGroup === '') missingFields.push('bloodGroup');
    if (!urgency || urgency === '') missingFields.push('urgency');
    if (!location || location === '') missingFields.push('location');
    if (!hospitalId || hospitalId === '' || hospitalId === 0) missingFields.push('hospitalId');
    
    if (missingFields.length > 0) {
        console.log('Validation failed. Missing fields:', missingFields);
        console.log('Received values:', {
            userId, age, gender, bloodGroup, urgency, location, hospitalId
        });
        return res.status(400).json({ 
            error: `Missing required fields: ${missingFields.join(', ')}` 
        });
    }

    try {
        // Update recipient record with complete profile (name and contact already exist from registration)
        const updateSql = `
            UPDATE Recipient 
            SET Age = ?, Gender = ?, Blood_Group_Required = ?, 
                Urgency_Level = ?, Location = ?, Hospital_ID = ?
            WHERE Recipient_ID = ?
        `;
        
        // Convert string values to appropriate types for database
        const updateValues = [
            parseInt(age), 
            gender, 
            bloodGroup, 
            urgency, 
            location, 
            parseInt(hospitalId), 
            parseInt(userId)
        ];
        
        console.log('SQL update values:', updateValues);
        
        const [result] = await pool.query(updateSql, updateValues);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Recipient not found.' });
        }

        res.status(200).json({ 
            message: 'Recipient profile completed successfully!',
            recipient_id: userId
        });
        
    } catch (error) {
        console.error('Error completing recipient profile:', error);
        
        if (error.code === 'ER_DUP_ENTRY') {
            res.status(400).json({ error: 'A recipient with this information already exists.' });
        } else {
            res.status(500).json({ error: 'Failed to complete profile. Please try again.' });
        }
    }
});

/**
 * Endpoint to get recipient dashboard data
 * GET /api/recipient-dashboard/:recipientId
 */
app.get('/api/recipient-dashboard/:recipientId', async (req, res) => {
    const { recipientId } = req.params;
    
    try {
        // Get recipient basic info
        const [recipientInfo] = await pool.query(`
            SELECT r.*, h.Hospital_Name 
            FROM Recipient r
            LEFT JOIN Hospital h ON r.Hospital_ID = h.Hospital_ID
            WHERE r.Recipient_ID = ?
        `, [recipientId]);
        
        if (recipientInfo.length === 0) {
            return res.status(404).json({ error: 'Recipient not found.' });
        }
        
        const recipient = recipientInfo[0];
        
        // Get blood request history for this recipient
        const [requestHistory] = await pool.query(`
            SELECT br.*, h.Hospital_Name
            FROM Blood_Request br
            LEFT JOIN Recipient r ON br.Recipient_ID = r.Recipient_ID
            LEFT JOIN Hospital h ON r.Hospital_ID = h.Hospital_ID
            WHERE br.Recipient_ID = ?
            ORDER BY br.Request_Date DESC
        `, [recipientId]);
        
        // Get blood availability for recipient's blood group
        const [bloodAvailability] = await pool.query(`
            SELECT bs.Blood_Group, SUM(bs.Quantity) as Total_Units, h.Hospital_Name, h.Location
            FROM Blood_Stock bs
            JOIN Hospital h ON bs.Hospital_ID = h.Hospital_ID
            WHERE bs.Blood_Group = ? AND bs.Quantity > 0
            GROUP BY bs.Blood_Group, h.Hospital_ID
            ORDER BY Total_Units DESC
        `, [recipient.Blood_Group_Required]);
        
        // Calculate stats
        const totalRequests = requestHistory.length;
        const pendingRequests = requestHistory.filter(req => req.Status === 'Pending').length;
        const approvedRequests = requestHistory.filter(req => req.Status === 'Approved').length;
        
        res.status(200).json({
            recipient: {
                name: recipient.Recipient_Name,
                bloodGroupRequired: recipient.Blood_Group_Required,
                location: recipient.Location,
                hospitalName: recipient.Hospital_Name || 'Not assigned',
                urgencyLevel: recipient.Urgency_Level || 'Not specified',
                age: recipient.Age,
                gender: recipient.Gender
            },
            requestHistory,
            bloodAvailability,
            totalRequests,
            pendingRequests,
            approvedRequests
        });
        
    } catch (error) {
        console.error('Error fetching recipient dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data.' });
    }
});

/**
 * Endpoint to submit blood request
 * POST /api/blood-request
 */
app.post('/api/blood-request', async (req, res) => {
    const { recipientId, bloodGroup, quantity, urgency, reason } = req.body;
    
    // Validate required fields
    if (!recipientId || !bloodGroup || !quantity || !urgency) {
        return res.status(400).json({ error: 'All required fields must be provided.' });
    }
    
    try {
        // First, get recipient's blood group for compatibility check
        const [recipientInfo] = await pool.query(
            'SELECT Blood_Group_Required FROM Recipient WHERE Recipient_ID = ?', 
            [recipientId]
        );
        
        if (recipientInfo.length === 0) {
            return res.status(404).json({ error: 'Recipient not found.' });
        }
        
        const recipientBloodGroup = recipientInfo[0].Blood_Group_Required;
        
        // Blood compatibility rules
        const bloodCompatibility = {
            'O-': ['O-'],
            'O+': ['O+', 'O-'],
            'A-': ['A-', 'O-'],
            'A+': ['A+', 'A-', 'O+', 'O-'],
            'B-': ['B-', 'O-'],
            'B+': ['B+', 'B-', 'O+', 'O-'],
            'AB-': ['AB-', 'A-', 'B-', 'O-'],
            'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-']
        };
        
        // Check blood compatibility
        const compatibleBloodGroups = bloodCompatibility[recipientBloodGroup] || [];
        if (!compatibleBloodGroups.includes(bloodGroup)) {
            return res.status(400).json({ 
                error: `Blood compatibility error: As ${recipientBloodGroup}, you cannot safely receive ${bloodGroup}. Compatible types: ${compatibleBloodGroups.join(', ')}`
            });
        }
        
        // Insert blood request (using existing schema)
        const insertSql = `
            INSERT INTO Blood_Request 
            (Recipient_ID, Blood_Group_Requested, Quantity, Request_Date, Status) 
            VALUES (?, ?, ?, CURDATE(), 'Pending')
        `;
        
        const [result] = await pool.query(insertSql, [recipientId, bloodGroup, quantity]);
        
        res.status(201).json({ 
            message: 'Blood request submitted successfully!',
            request_id: result.insertId
        });
        
    } catch (error) {
        console.error('Error submitting blood request:', error);
        res.status(500).json({ error: 'Failed to submit blood request.' });
    }
});

/**
 * Endpoint to withdraw a blood request
 * DELETE /api/withdraw-blood-request/:requestId
 */
app.delete('/api/withdraw-blood-request/:requestId', async (req, res) => {
    const { requestId } = req.params;
    
    try {
        // Check if request exists and is still pending
        const [requestInfo] = await pool.query(
            'SELECT * FROM Blood_Request WHERE Request_ID = ?',
            [requestId]
        );
        
        if (requestInfo.length === 0) {
            return res.status(404).json({ error: 'Blood request not found.' });
        }
        
        const request = requestInfo[0];
        
        // Only allow withdrawal of pending requests
        if (request.Status !== 'Pending') {
            return res.status(400).json({ 
                error: `Cannot withdraw request. Current status: ${request.Status}. Only pending requests can be withdrawn.`
            });
        }
        
        // Delete the request from database
        await pool.query('DELETE FROM Blood_Request WHERE Request_ID = ?', [requestId]);
        
        console.log(`Blood request ${requestId} withdrawn successfully`);
        
        res.status(200).json({ 
            message: 'Blood request withdrawn successfully.',
            requestId: requestId
        });
        
    } catch (error) {
        console.error('Error withdrawing blood request:', error);
        res.status(500).json({ error: 'Failed to withdraw blood request.' });
    }
});

/**
 * Endpoint to add blood stock
 * POST /api/add-blood-stock
 */
app.post('/api/add-blood-stock', async (req, res) => {
    const { hospitalId, bloodGroup, quantity, expiryDate, storageType, donorInfo } = req.body;
    
    console.log('Received add-blood-stock request:', req.body);
    console.log('Hospital ID:', hospitalId, 'Type:', typeof hospitalId);
    
    // Validate required fields
    if (!hospitalId || !bloodGroup || !quantity || !expiryDate) {
        console.log('Validation failed - missing fields:', {
            hospitalId: !!hospitalId,
            bloodGroup: !!bloodGroup,
            quantity: !!quantity,
            expiryDate: !!expiryDate
        });
        return res.status(400).json({ error: 'All required fields must be provided.' });
    }
    
    try {
        // Check if hospital exists first
        const [hospitalCheck] = await pool.query('SELECT Hospital_ID FROM Hospital WHERE Hospital_ID = ?', [hospitalId]);
        
        if (hospitalCheck.length === 0) {
            console.log('Hospital not found with ID:', hospitalId);
            return res.status(404).json({ error: 'Hospital not found.' });
        }
        
        console.log('Hospital exists, inserting blood stock...');
        
        // Insert blood stock (matching your actual table structure)
        const insertSql = `
            INSERT INTO Blood_Stock 
            (Hospital_ID, Blood_Group, Quantity, Expiry_Date, Storage_Type) 
            VALUES (?, ?, ?, ?, ?)
        `;
        
        const finalStorageType = storageType || 'Refrigerated'; // Use selected or default
        
        console.log('Executing SQL with values:', [hospitalId, bloodGroup, quantity, expiryDate, finalStorageType]);
        
        const [result] = await pool.query(insertSql, [hospitalId, bloodGroup, quantity, expiryDate, finalStorageType]);
        
        console.log('Blood stock inserted successfully, ID:', result.insertId);
        
        res.status(201).json({ 
            message: 'Blood stock added successfully!',
            stock_id: result.insertId
        });
        
    } catch (error) {
        console.error('Detailed error adding blood stock:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        res.status(500).json({ error: 'Failed to add blood stock: ' + error.message });
    }
});

/**
 * Endpoint to approve blood request
 * PUT /api/approve-blood-request/:requestId
 */
app.put('/api/approve-blood-request/:requestId', async (req, res) => {
    const { requestId } = req.params;
    const { hospitalId } = req.body;
    
    try {
        // First check if request exists and get details
        const [requestInfo] = await pool.query(
            'SELECT * FROM Blood_Request WHERE Request_ID = ?', 
            [requestId]
        );
        
        if (requestInfo.length === 0) {
            return res.status(404).json({ error: 'Blood request not found.' });
        }
        
        const request = requestInfo[0];
        
        // Check if hospital has enough blood stock
        const [stockInfo] = await pool.query(`
            SELECT SUM(Quantity) as Available_Units 
            FROM Blood_Stock 
            WHERE Hospital_ID = ? AND Blood_Group = ? AND Quantity > 0
        `, [hospitalId, request.Blood_Group_Requested]);
        
        const availableUnits = stockInfo[0]?.Available_Units || 0;
        
        if (availableUnits < request.Quantity) {
            return res.status(400).json({ 
                error: `Insufficient stock. Available: ${availableUnits} units, Requested: ${request.Quantity} units` 
            });
        }
        
        // Update request status to approved
        await pool.query(
            'UPDATE Blood_Request SET Status = ? WHERE Request_ID = ?', 
            ['Approved', requestId]
        );
        
        // Reduce blood stock (FIFO - First In, First Out)
        let remainingToReduce = request.Quantity;
        const [stockRecords] = await pool.query(`
            SELECT Stock_ID, Quantity 
            FROM Blood_Stock 
            WHERE Hospital_ID = ? AND Blood_Group = ? AND Quantity > 0 
            ORDER BY Stock_ID ASC
        `, [hospitalId, request.Blood_Group_Requested]);
        
        for (const stock of stockRecords) {
            if (remainingToReduce <= 0) break;
            
            const reduceAmount = Math.min(stock.Quantity, remainingToReduce);
            const newQuantity = stock.Quantity - reduceAmount;
            
            await pool.query(
                'UPDATE Blood_Stock SET Quantity = ? WHERE Stock_ID = ?',
                [newQuantity, stock.Stock_ID]
            );
            
            remainingToReduce -= reduceAmount;
        }
        
        res.status(200).json({ 
            message: 'Blood request approved and stock updated successfully!',
            requestId: requestId,
            status: 'Approved',
            stockReduced: request.Quantity,
            remainingStock: availableUnits - request.Quantity
        });
        
    } catch (error) {
        console.error('Error approving blood request:', error);
        res.status(500).json({ error: 'Failed to approve blood request.' });
    }
});

/**
 * Endpoint to reject blood request
 * PUT /api/reject-blood-request/:requestId
 */
app.put('/api/reject-blood-request/:requestId', async (req, res) => {
    const { requestId } = req.params;
    
    try {
        // Update request status to rejected
        const [result] = await pool.query(
            'UPDATE Blood_Request SET Status = ? WHERE Request_ID = ?', 
            ['Rejected', requestId]
        );
        
        if (result.affectedRows === 0) {
            return res.status(404).json({ error: 'Blood request not found.' });
        }
        
        res.status(200).json({ 
            message: 'Blood request rejected successfully.',
            requestId: requestId,
            status: 'Rejected'
        });
        
    } catch (error) {
        console.error('Error rejecting blood request:', error);
        res.status(500).json({ error: 'Failed to reject blood request.' });
    }
});

/**
 * Endpoint to schedule donation appointment
 * POST /api/schedule-appointment
 */
app.post('/api/schedule-appointment', async (req, res) => {
    const { donorId, hospitalId, appointmentDate, appointmentTime, donationType, specialNotes } = req.body;
    
    console.log('Schedule appointment request:', req.body);
    
    // Validate required fields
    if (!donorId || !hospitalId || !appointmentDate || !appointmentTime || !donationType) {
        console.log('Validation failed - missing fields');
        return res.status(400).json({ error: 'All required fields must be provided.' });
    }
    
    try {
        // Check if donor exists and get their info
        const [donorInfo] = await pool.query(
            'SELECT * FROM Donor WHERE Donor_ID = ?', 
            [donorId]
        );
        
        if (donorInfo.length === 0) {
            return res.status(404).json({ error: 'Donor not found.' });
        }
        
        // Check if hospital exists
        const [hospitalInfo] = await pool.query(
            'SELECT * FROM Hospital WHERE Hospital_ID = ?', 
            [hospitalId]
        );
        
        if (hospitalInfo.length === 0) {
            return res.status(404).json({ error: 'Hospital not found.' });
        }
        
        const donor = donorInfo[0];
        
        // Check if donor already has appointment on this date (simplified check)
        const [existingAppointments] = await pool.query(`
            SELECT * FROM Donation_Record 
            WHERE Donor_ID = ? AND Donation_Date = ?
        `, [donorId, appointmentDate]);
        
        if (existingAppointments.length > 0) {
            return res.status(400).json({ 
                error: 'You already have an appointment on this date. Please choose a different date.' 
            });
        }
        
        // Insert appointment into existing Donation_Record table structure
        console.log('Inserting appointment with values:', [donorId, appointmentDate]);
        
        const insertSql = `
            INSERT INTO Donation_Record 
            (Donor_ID, Donation_Date, Verified_By) 
            VALUES (?, ?, ?)
        `;
        
        const [result] = await pool.query(insertSql, [
            donorId, 
            appointmentDate,
            'System' // Verified_By field
        ]);
        
        console.log('Appointment inserted successfully, ID:', result.insertId);
        
        // Update donor's Last_Donation_Date to the appointment date
        // This will automatically calculate next eligibility date (56 days later)
        const updateDonorSql = `
            UPDATE Donor 
            SET Last_Donation_Date = ? 
            WHERE Donor_ID = ?
        `;
        
        await pool.query(updateDonorSql, [appointmentDate, donorId]);
        
        console.log('Updated donor last donation date to:', appointmentDate);
        
        // Calculate next eligible date (56 days after appointment)
        const appointmentDateObj = new Date(appointmentDate);
        const nextEligibleDate = new Date(appointmentDateObj);
        nextEligibleDate.setDate(nextEligibleDate.getDate() + 56); // 56 days = 8 weeks
        
        res.status(201).json({ 
            message: 'Appointment scheduled successfully! Your next eligible donation date is ' + nextEligibleDate.toLocaleDateString(),
            appointment_id: result.insertId,
            appointment_details: {
                hospital: hospitalInfo[0].Hospital_Name,
                date: appointmentDate,
                time: appointmentTime,
                type: donationType
            },
            next_eligible_date: nextEligibleDate.toISOString().split('T')[0] // Return in YYYY-MM-DD format
        });
        
    } catch (error) {
        console.error('Detailed error scheduling appointment:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        res.status(500).json({ error: 'Failed to schedule appointment: ' + error.message });
    }
});

/**
 * Endpoint to get donor dashboard data with appointments
 * GET /api/donor-dashboard/:donorId
 */
app.get('/api/donor-dashboard/:donorId', async (req, res) => {
    const { donorId } = req.params;
    
    try {
        // Get donor basic info
        const [donorInfo] = await pool.query(
            'SELECT * FROM Donor WHERE Donor_ID = ?', 
            [donorId]
        );
        
        if (donorInfo.length === 0) {
            return res.status(404).json({ error: 'Donor not found.' });
        }
        
        const donor = donorInfo[0];
        
        // Get donation history (simplified for existing table structure)
        const [donationHistory] = await pool.query(`
            SELECT Record_ID, Donor_ID, Stock_ID, Donation_Date, Verified_By
            FROM Donation_Record 
            WHERE Donor_ID = ?
            ORDER BY Donation_Date DESC
        `, [donorId]);
        
        console.log('Raw donation history from DB:', donationHistory);
        
        // Separate completed donations and upcoming appointments based on verification status
        const completedDonations = donationHistory.filter(record => 
            record.Verified_By && record.Verified_By !== 'System' && record.Verified_By.startsWith('Hospital_')
        );
        const upcomingAppointments = donationHistory.filter(record => 
            !record.Verified_By || record.Verified_By === 'System' || record.Verified_By === ''
        );
        
        // Get urgent blood requests that match donor's blood group
        const [urgentRequests] = await pool.query(`
            SELECT br.*, r.Recipient_Name, h.Hospital_Name
            FROM Blood_Request br
            JOIN Recipient r ON br.Recipient_ID = r.Recipient_ID
            LEFT JOIN Hospital h ON r.Hospital_ID = h.Hospital_ID
            WHERE br.Status = 'Pending' 
            AND br.Blood_Group_Requested = ?
            ORDER BY br.Request_Date DESC
            LIMIT 5
        `, [donor.Blood_Group]);
        
        // Always eligible - no restrictions
        let eligibilityStatus = 'Eligible';
        let nextEligibleDate = null;
        
        console.log('Sending response with:');
        console.log('- upcomingAppointments:', upcomingAppointments);
        console.log('- completedDonations:', completedDonations);
        
        res.status(200).json({
            donor: {
                name: donor.Donor_Name,
                bloodGroup: donor.Blood_Group,
                age: donor.Age,
                medicalStatus: donor.Medical_Status
            },
            upcomingAppointments,
            donationHistory: completedDonations,
            urgentRequests,
            eligibility: {
                status: eligibilityStatus,
                nextEligibleDate
            },
            stats: {
                totalDonations: completedDonations.length, // Count verified donations only
                livesSaved: completedDonations.length * 3, // Each donation can save up to 3 lives
                upcomingAppointments: upcomingAppointments.length,
                urgentRequests: urgentRequests.length
            }
        });
        
    } catch (error) {
        console.error('Error fetching donor dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data.' });
    }
});

/**
 * Endpoint to get comprehensive admin dashboard data
 * GET /api/admin-dashboard
 */
app.get('/api/admin-dashboard', async (req, res) => {
    try {
        console.log('Admin dashboard API called');
        // Get system-wide statistics
        const [userStats] = await pool.query(`
            SELECT 
                User_Role as Role,
                COUNT(*) as count
            FROM User 
            GROUP BY User_Role
        `);
        
        const [hospitalCount] = await pool.query('SELECT COUNT(*) as count FROM Hospital');
        const [activeRequests] = await pool.query('SELECT COUNT(*) as count FROM Blood_Request WHERE Status = "Pending"');
        const [totalDonations] = await pool.query('SELECT COUNT(*) as count FROM Donation_Record');
        const [totalBloodUnits] = await pool.query('SELECT SUM(Quantity) as total FROM Blood_Stock WHERE Quantity > 0');
        
        // Calculate total users
        const totalUsers = userStats.reduce((sum, stat) => sum + stat.count, 0);
        
        console.log('User stats:', userStats);
        console.log('Hospital count:', hospitalCount);
        console.log('Active requests:', activeRequests);
        console.log('Total donations:', totalDonations);
        console.log('Total blood units:', totalBloodUnits);
        
        // Simple system alerts count (low stock blood groups)
        const [lowStockCount] = await pool.query(`
            SELECT COUNT(*) as count
            FROM (
                SELECT bs.Blood_Group
                FROM Blood_Stock bs
                WHERE bs.Quantity > 0
                GROUP BY bs.Blood_Group
                HAVING SUM(bs.Quantity) < 15
            ) as low_stock
        `);
        
        const systemAlertsCount = lowStockCount[0].count;
        
        res.status(200).json({
            stats: {
                totalUsers,
                totalHospitals: hospitalCount[0].count,
                activeRequests: activeRequests[0].count,
                totalDonations: totalDonations[0].count,
                totalBloodUnits: totalBloodUnits[0].total || 0,
                systemAlerts: systemAlertsCount
            }
        });
        
    } catch (error) {
        console.error('Error fetching admin dashboard data:', error);
        res.status(500).json({ error: 'Failed to fetch admin dashboard data.' });
    }
});

/**
 * Functional Endpoint for Login
 * POST /api/login
 */
app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // 1. Find the user by email in the User table
        const [users] = await pool.query('SELECT * FROM User WHERE Email = ?', [email]);
        
        const user = users[0];

        if (!user) {
            // User not found
            return res.status(401).json({ error: 'Invalid Email or Password.' });
        }

        // 2. Compare the provided password with the stored hash
        const match = await bcrypt.compare(password, user.Password_Hash);

        if (match) {
            // 3. Successful login - fetch user details based on role
            let userName = 'User';
            let profileComplete = false;

            if (user.User_Role === 'Donor') {
                const [donorDetails] = await pool.query(
                    'SELECT Donor_Name, Age FROM Donor WHERE Donor_ID = ?', 
                    [user.Associated_ID]
                );
                userName = donorDetails[0] ? donorDetails[0].Donor_Name : 'Donor';
                profileComplete = donorDetails[0] && donorDetails[0].Age !== null && donorDetails[0].Age > 17;
                
            } else if (user.User_Role === 'Recipient') {
                const [recipientDetails] = await pool.query(
                    'SELECT Recipient_Name, Age, Gender, Blood_Group_Required, Urgency_Level, Location, Hospital_ID FROM Recipient WHERE Recipient_ID = ?', 
                    [user.Associated_ID]
                );
                userName = recipientDetails[0] ? recipientDetails[0].Recipient_Name : 'Recipient';
                // Profile is complete if all essential medical fields are filled
                profileComplete = recipientDetails[0] && 
                                recipientDetails[0].Age && 
                                recipientDetails[0].Gender && 
                                recipientDetails[0].Blood_Group_Required && 
                                recipientDetails[0].Urgency_Level && 
                                recipientDetails[0].Location && 
                                recipientDetails[0].Hospital_ID;
                
            } else if (user.User_Role === 'HospitalAdmin') {
                const [hospitalDetails] = await pool.query(
                    'SELECT Hospital_Name, Admin_Name, License_Number FROM Hospital WHERE Hospital_ID = ?', 
                    [user.Associated_ID]
                );
                userName = hospitalDetails[0] ? (hospitalDetails[0].Admin_Name || hospitalDetails[0].Hospital_Name) : 'Hospital Admin';
                // Check if hospital profile is complete (has license number)
                profileComplete = hospitalDetails[0] && hospitalDetails[0].License_Number !== null;
                
            } else if (user.User_Role === 'SystemAdmin') {
                // System admins have full access and no profile completion needed
                userName = 'System Administrator';
                profileComplete = true;
            }

            // In a real app, you would generate a JWT token here
            res.status(200).json({ 
                message: 'Login Successful.', 
                user_name: userName,
                user_role: user.User_Role,
                user_id: user.Associated_ID,
                profile_complete: profileComplete
            });
        } else {
            // Password mismatch
            res.status(401).json({ error: 'Invalid Email or Password.' });
        }
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ error: 'Login failed due to a server error.' });
    }
});

/**
 * Endpoint to verify a donation by hospital admin
 * PUT /api/verify-donation/:recordId
 */
app.put('/api/verify-donation/:recordId', async (req, res) => {
    const { recordId } = req.params;
    const { hospitalId, bloodGroup, quantity, notes } = req.body;
    
    console.log('Verifying donation:', { recordId, hospitalId, bloodGroup, quantity });
    
    try {
        // Get the donation record
        const [donationRecord] = await pool.query(
            'SELECT * FROM Donation_Record WHERE Record_ID = ?',
            [recordId]
        );
        
        if (donationRecord.length === 0) {
            return res.status(404).json({ error: 'Donation record not found.' });
        }
        
        const donation = donationRecord[0];
        
        // Get donor information for blood group
        const [donorInfo] = await pool.query(
            'SELECT Blood_Group FROM Donor WHERE Donor_ID = ?',
            [donation.Donor_ID]
        );
        
        if (donorInfo.length === 0) {
            return res.status(404).json({ error: 'Donor not found.' });
        }
        
        const donorBloodGroup = donorInfo[0].Blood_Group;
        const finalBloodGroup = bloodGroup || donorBloodGroup;
        const finalQuantity = quantity || 1; // Default to 1 unit
        
        // Add blood stock to hospital inventory first
        const insertStockSql = `
            INSERT INTO Blood_Stock 
            (Hospital_ID, Blood_Group, Quantity, Expiry_Date, Storage_Type) 
            VALUES (?, ?, ?, DATE_ADD(CURDATE(), INTERVAL 42 DAY), 'Refrigerated')
        `;
        
        const [stockResult] = await pool.query(insertStockSql, [
            hospitalId,
            finalBloodGroup,
            finalQuantity
        ]);
        
        // Update donation record to link to stock and show hospital verification
        await pool.query(
            'UPDATE Donation_Record SET Verified_By = ?, Stock_ID = ? WHERE Record_ID = ?',
            [`Hospital_${hospitalId}`, stockResult.insertId, recordId]
        );
        
        // Update donor's Last_Donation_Date to ensure eligibility calculation is accurate
        await pool.query(
            'UPDATE Donor SET Last_Donation_Date = ? WHERE Donor_ID = ?',
            [donation.Donation_Date, donation.Donor_ID]
        );
        
        console.log('Blood stock added:', stockResult.insertId);
        console.log('Updated donor last donation date for donor:', donation.Donor_ID);
        
        res.status(200).json({
            message: 'Donation verified successfully!',
            recordId: recordId,
            stockAdded: {
                stockId: stockResult.insertId,
                bloodGroup: finalBloodGroup,
                quantity: finalQuantity,
                hospitalId: hospitalId
            }
        });
        
    } catch (error) {
        console.error('Error verifying donation:', error);
        res.status(500).json({ error: 'Failed to verify donation: ' + error.message });
    }
});

/**
 * Endpoint to reject a donation by hospital admin
 * PUT /api/reject-donation/:recordId
 */
app.put('/api/reject-donation/:recordId', async (req, res) => {
    const { recordId } = req.params;
    const { hospitalId } = req.body;
    
    console.log('Rejecting donation:', { recordId, hospitalId });
    
    try {
        // Update donation record to show rejection (Stock_ID = -1 means rejected)
        await pool.query(
            'UPDATE Donation_Record SET Verified_By = ?, Stock_ID = ? WHERE Record_ID = ?',
            [`Hospital_${hospitalId}_Rejected`, -1, recordId]
        );
        
        res.status(200).json({
            message: 'Donation rejected successfully!',
            recordId: recordId
        });
        
    } catch (error) {
        console.error('Error rejecting donation:', error);
        res.status(500).json({ error: 'Failed to reject donation: ' + error.message });
    }
});

/**
 * Endpoint to get pending donations for hospital verification
 * GET /api/pending-donations/:hospitalId
 */
app.get('/api/pending-donations/:hospitalId', async (req, res) => {
    const { hospitalId } = req.params;
    
    try {
        console.log('Fetching pending donations for hospital ID:', hospitalId);
        
        // First, let's see all donation records
        const [allDonations] = await pool.query(`
            SELECT * FROM Donation_Record ORDER BY Donation_Date DESC
        `);
        console.log('All donation records:', allDonations);
        
        // Get pending donations (only those not yet processed by hospital)
        const [pendingDonations] = await pool.query(`
            SELECT 
                Record_ID,
                Donor_ID,
                Stock_ID,
                Donation_Date,
                Verified_By
            FROM Donation_Record
            WHERE Verified_By = 'System' AND Stock_ID IS NULL
            ORDER BY Donation_Date DESC
        `);
        
        // If we have donations, get donor details separately
        const enrichedDonations = [];
        for (const donation of pendingDonations) {
            try {
                const [donorInfo] = await pool.query(
                    'SELECT Donor_Name, Blood_Group, Age, Gender FROM Donor WHERE Donor_ID = ?',
                    [donation.Donor_ID]
                );
                
                enrichedDonations.push({
                    ...donation,
                    Donor_Name: donorInfo[0]?.Donor_Name || 'Unknown',
                    Blood_Group: donorInfo[0]?.Blood_Group || 'Unknown',
                    Age: donorInfo[0]?.Age || 'Unknown',
                    Gender: donorInfo[0]?.Gender || 'Unknown'
                });
            } catch (err) {
                console.error('Error getting donor info for ID:', donation.Donor_ID, err);
                enrichedDonations.push({
                    ...donation,
                    Donor_Name: 'Unknown',
                    Blood_Group: 'Unknown',
                    Age: 'Unknown',
                    Gender: 'Unknown'
                });
            }
        }
        
        console.log('Found pending donations:', pendingDonations);
        console.log('Enriched donations:', enrichedDonations);
        
        res.status(200).json({
            pendingDonations: enrichedDonations
        });
        
    } catch (error) {
        console.error('Error fetching pending donations:', error);
        res.status(500).json({ error: 'Failed to fetch pending donations.' });
    }
});

/**
 * DANGER: Clear all database data (for development only)
 * POST /api/clear-database
 */
app.post('/api/clear-database', async (req, res) => {
    try {
        console.log('⚠️  CLEARING ALL DATABASE DATA...');
        
        // Disable foreign key checks
        await pool.query('SET FOREIGN_KEY_CHECKS = 0');
        
        // Clear all tables (in correct order to handle foreign keys)
        await pool.query('DELETE FROM Donation_Record');
        await pool.query('DELETE FROM Blood_Request');
        await pool.query('DELETE FROM Blood_Stock');
        await pool.query('DELETE FROM Donor');
        await pool.query('DELETE FROM Recipient');
        await pool.query('DELETE FROM Hospital');
        await pool.query('DELETE FROM User');
        
        // Reset auto-increment
        await pool.query('ALTER TABLE Blood_Stock AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE Blood_Request AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE Donation_Record AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE Donor AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE Recipient AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE Hospital AUTO_INCREMENT = 1');
        await pool.query('ALTER TABLE User AUTO_INCREMENT = 1');
        
        // Re-enable foreign key checks
        await pool.query('SET FOREIGN_KEY_CHECKS = 1');
        
        console.log('✅ Database cleared successfully');
        
        res.status(200).json({ 
            message: 'Database cleared successfully!',
            warning: 'All data has been permanently deleted.'
        });
        
    } catch (error) {
        console.error('Error clearing database:', error);
        res.status(500).json({ error: 'Failed to clear database: ' + error.message });
    }
});

// --- Start Server ---
app.listen(port, () => {
    console.log(`🌍 Server running on http://localhost:${port}`);
});
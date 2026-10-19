require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "scholarship_portal_secure_jwt_secret_key_2026";

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Ensure uploads folder exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve uploaded documents statically
app.use("/uploads", express.static(uploadsDir));

// Serve static frontend files
app.use(express.static(__dirname));

// Multer storage and validation for document uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadsDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const cleanName = file.originalname.replace(/[^a-zA-Z0-9.]/g, "_");
        cb(null, `${file.fieldname}-${uniqueSuffix}-${cleanName}`);
    }
});

const fileFilter = (req, file, cb) => {
    const allowedTypes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error("Only PDF, JPEG, JPG, and PNG files are allowed."), false);
    }
};

const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// Database connection
const db = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "gouthami123",
    database: process.env.DB_NAME || "scholarship_portal",
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

db.getConnection((err, conn) => {
    if (err) {
        console.error("MySQL connection error:", err.message);
        return;
    }
    console.log(`MySQL connected successfully to database: ${process.env.DB_NAME || "scholarship_portal"}`);
    conn.release();
});

// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ message: "Authentication token required." });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ message: "Invalid or expired session token." });
        }
        req.user = user;
        next();
    });
}

// Role Authorization middleware
function authorizeRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.user || !allowedRoles.includes(req.user.role)) {
            return res.status(403).json({
                message: `Access denied. Authorized roles: ${allowedRoles.join(", ")}`
            });
        }
        next();
    };
}

// Helper to record approval history
function logApprovalHistory(applicationId, stage, action, actorName, actorRole, remarks, callback) {
    const sql = `
        INSERT INTO approval_history (application_id, stage, action, actor_name, actor_role, remarks)
        VALUES (?, ?, ?, ?, ?, ?)
    `;
    db.query(sql, [applicationId, stage, action, actorName, actorRole, remarks || ""], (err, result) => {
        if (err) {
            console.error("Error inserting approval history:", err.message);
        }
        if (callback) callback(err, result);
    });
}

// ==========================================
// 1. HOME & HEALTH CHECK
// ==========================================
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// ==========================================
// 2. STUDENT REGISTRATION
// ==========================================
app.post("/api/register", async (req, res) => {
    const {
        name, email, password, phone,
        category, income, college, course
    } = req.body;

    if (
        !name || !email || !password || !phone ||
        !category || income === "" || income === undefined ||
        !college || !course
    ) {
        return res.status(400).json({
            message: "Please fill in all fields."
        });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const sql = `
            INSERT INTO students
            (full_name, email, password, phone, category,
             annual_income, college, course)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.query(sql, [
            name.trim(),
            email.trim().toLowerCase(),
            hashedPassword,
            phone.trim(),
            category,
            Number(income),
            college.trim(),
            course.trim()
        ], (err, result) => {
            if (err) {
                if (err.code === "ER_DUP_ENTRY") {
                    return res.status(409).json({
                        message: "This email is already registered."
                    });
                }

                console.error("Registration error:", err.message);
                return res.status(500).json({
                    message: "Registration failed."
                });
            }

            const studentData = {
                id: result.insertId,
                name: name.trim(),
                email: email.trim().toLowerCase(),
                college: college.trim(),
                course: course.trim(),
                category,
                annual_income: Number(income),
                role: "student"
            };

            const token = jwt.sign(studentData, JWT_SECRET, { expiresIn: "7d" });

            res.status(201).json({
                message: "Registration successful!",
                studentId: result.insertId,
                token: token,
                student: studentData
            });
        });
    } catch (error) {
        console.error("Register catch error:", error);
        res.status(500).json({
            message: "Something went wrong during registration."
        });
    }
});

// ==========================================
// 3. STUDENT LOGIN
// ==========================================
app.post("/api/login", (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            message: "Please provide both email and password."
        });
    }

    const sql = `SELECT * FROM students WHERE email = ? LIMIT 1`;
    db.query(sql, [email.trim().toLowerCase()], async (err, results) => {
        if (err) {
            console.error("Login query error:", err.message);
            return res.status(500).json({ message: "Database query error during login." });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        const student = results[0];
        try {
            const passwordMatch = await bcrypt.compare(password, student.password);
            if (!passwordMatch) {
                return res.status(401).json({ message: "Invalid email or password." });
            }

            const studentData = {
                id: student.id,
                name: student.full_name,
                email: student.email,
                phone: student.phone,
                category: student.category,
                annual_income: student.annual_income,
                college: student.college,
                course: student.course,
                role: "student"
            };

            const token = jwt.sign(studentData, JWT_SECRET, { expiresIn: "7d" });

            res.json({
                message: "Login successful!",
                token: token,
                student: studentData
            });
        } catch (error) {
            console.error("Login password verification error:", error);
            res.status(500).json({ message: "Error verifying password." });
        }
    });
});

// ==========================================
// 4. STAFF / APPROVER LOGIN (Officer, HOD, Principal, Admin)
// ==========================================
app.post("/api/auth/staff-login", (req, res) => {
    const { email, password, role } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: "Email and password are required." });
    }

    let sql = `SELECT * FROM users WHERE email = ?`;
    const params = [email.trim().toLowerCase()];

    if (role && role !== "all") {
        sql += ` AND role = ?`;
        params.push(role.toLowerCase());
    }
    sql += ` LIMIT 1`;

    db.query(sql, params, async (err, results) => {
        if (err) {
            console.error("Staff login query error:", err.message);
            return res.status(500).json({ message: "Database query error." });
        }

        if (results.length === 0) {
            return res.status(401).json({ message: "Invalid credentials or unauthorized role." });
        }

        const user = results[0];
        const passwordMatch = await bcrypt.compare(password, user.password);

        if (!passwordMatch) {
            return res.status(401).json({ message: "Invalid email or password." });
        }

        const payload = {
            id: user.id,
            name: user.full_name,
            email: user.email,
            role: user.role,
            department: user.department
        };

        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });

        res.json({
            message: "Authentication successful!",
            token: token,
            user: payload
        });
    });
});

// ==========================================
// 5. STUDENT PROFILE MANAGEMENT
// ==========================================
app.get("/api/student/profile/:studentId", (req, res) => {
    const studentId = Number(req.params.studentId);
    db.query("SELECT id, full_name, email, phone, category, annual_income, college, course, created_at FROM students WHERE id = ?", [studentId], (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Error fetching profile." });
        }
        if (rows.length === 0) {
            return res.status(404).json({ message: "Student profile not found." });
        }
        res.json({ profile: rows[0] });
    });
});

app.put("/api/student/profile/:studentId", (req, res) => {
    const studentId = Number(req.params.studentId);
    const { full_name, phone, category, annual_income, college, course } = req.body;

    if (!full_name || !phone || !college || !course) {
        return res.status(400).json({ message: "Name, phone, college, and course are required." });
    }

    const sql = `
        UPDATE students
        SET full_name = ?, phone = ?, category = ?, annual_income = ?, college = ?, course = ?
        WHERE id = ?
    `;

    db.query(sql, [full_name.trim(), phone.trim(), category, Number(annual_income), college.trim(), course.trim(), studentId], (err, result) => {
        if (err) {
            console.error("Profile update error:", err.message);
            return res.status(500).json({ message: "Failed to update profile." });
        }
        res.json({
            message: "Profile updated successfully!",
            student: {
                id: studentId,
                name: full_name.trim(),
                phone: phone.trim(),
                category,
                annual_income: Number(annual_income),
                college: college.trim(),
                course: course.trim()
            }
        });
    });
});

// ==========================================
// 6. SCHOLARSHIPS API (Dynamic MySQL Catalog)
// ==========================================
app.get("/api/scholarships", (req, res) => {
    db.query("SELECT * FROM scholarships WHERE status = 'Active' ORDER BY created_at ASC", (err, rows) => {
        if (err) {
            console.error("Fetch scholarships error:", err.message);
            return res.status(500).json({ message: "Failed to fetch scholarships." });
        }
        res.json({ scholarships: rows });
    });
});

// ==========================================
// 7. SUBMIT SCHOLARSHIP APPLICATION (With Multer Documents)
// ==========================================
const appUploadFields = upload.fields([
    { name: "aadhar", maxCount: 1 },
    { name: "income_cert", maxCount: 1 },
    { name: "marks", maxCount: 1 },
    { name: "bonafide", maxCount: 1 }
]);

app.post("/api/applications", appUploadFields, (req, res) => {
    const {
        student_id,
        scholarship_id,
        scholarship_name,
        academic_percentage,
        annual_income
    } = req.body;

    if (!student_id) {
        return res.status(400).json({
            message: "Student ID is required. Please log in before applying."
        });
    }

    if (!scholarship_name || !scholarship_name.trim()) {
        return res.status(400).json({
            message: "Scholarship name is required."
        });
    }

    const percentage = Number(academic_percentage);
    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
        return res.status(400).json({
            message: "Please enter a valid academic percentage between 0 and 100."
        });
    }

    const income = Number(annual_income);
    if (isNaN(income) || income < 0) {
        return res.status(400).json({
            message: "Please enter a valid positive annual income."
        });
    }

    // Extract uploaded document filenames
    const files = req.files || {};
    const aadharDoc = files["aadhar"] ? files["aadhar"][0].filename : null;
    const incomeDoc = files["income_cert"] ? files["income_cert"][0].filename : null;
    const marksDoc = files["marks"] ? files["marks"][0].filename : null;
    const bonafideDoc = files["bonafide"] ? files["bonafide"][0].filename : null;

    // Verify student exists in students table
    db.query("SELECT id, full_name FROM students WHERE id = ? LIMIT 1", [Number(student_id)], (checkErr, studentRows) => {
        if (checkErr) {
            console.error("Student check error:", checkErr.message);
            return res.status(500).json({ message: "Error validating student." });
        }

        if (studentRows.length === 0) {
            return res.status(404).json({ message: "Student account not found. Please log in again." });
        }

        const student = studentRows[0];
        // Generate unique tracking ID: APP-XXXXXX
        const trackingId = `APP-${Math.floor(100000 + Math.random() * 900000)}`;

        const insertSql = `
            INSERT INTO applications
            (tracking_id, student_id, scholarship_id, scholarship_name, academic_percentage, annual_income,
             status, current_level, aadhar_doc, income_doc, marks_doc, bonafide_doc)
            VALUES (?, ?, ?, ?, ?, ?, 'Submitted', 'Officer', ?, ?, ?, ?)
        `;

        db.query(insertSql, [
            trackingId,
            Number(student_id),
            scholarship_id ? scholarship_id.trim() : null,
            scholarship_name.trim(),
            percentage,
            income,
            aadharDoc,
            incomeDoc,
            marksDoc,
            bonafideDoc
        ], (insertErr, result) => {
            if (insertErr) {
                console.error("Application insert error:", insertErr.message);
                return res.status(500).json({
                    message: "Failed to submit application: " + insertErr.message
                });
            }

            const applicationId = result.insertId;

            // Log submission in approval_history
            logApprovalHistory(
                applicationId,
                "Submission",
                "Submitted",
                student.full_name,
                "Student",
                "Application submitted with required documents. Assigned to Scholarship Officer for Level 1 verification."
            );

            res.status(201).json({
                message: "Application submitted successfully!",
                trackingId: trackingId,
                applicationId: applicationId,
                status: "Submitted",
                current_level: "Officer"
            });
        });
    });
});

// ==========================================
// 8. GET APPLICATIONS FOR A STUDENT (With Details)
// ==========================================
app.get("/api/applications/student/:studentId", (req, res) => {
    const studentId = Number(req.params.studentId);
    if (isNaN(studentId)) {
        return res.status(400).json({ message: "Invalid student ID." });
    }

    const sql = `
        SELECT a.*,
               s.full_name, s.email, s.college, s.course, s.phone, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        WHERE a.student_id = ?
        ORDER BY a.applied_at DESC
    `;

    db.query(sql, [studentId], (err, rows) => {
        if (err) {
            console.error("Fetch student applications error:", err.message);
            return res.status(500).json({ message: "Failed to fetch applications." });
        }

        res.json({ applications: rows });
    });
});

// ==========================================
// 9. TRACK APPLICATION BY TRACKING ID
// ==========================================
app.get("/api/applications/track/:trackingId", (req, res) => {
    const trackingId = req.params.trackingId.trim();
    const studentId = req.query.student_id ? Number(req.query.student_id) : null;

    const sql = `
        SELECT a.*,
               s.full_name, s.college, s.course, s.email, s.phone, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        WHERE a.tracking_id = ?
        LIMIT 1
    `;

    db.query(sql, [trackingId], (err, rows) => {
        if (err) {
            console.error("Track application error:", err.message);
            return res.status(500).json({ message: "Error tracking application." });
        }

        if (rows.length === 0) {
            return res.status(404).json({ message: "No application found with this tracking ID." });
        }

        const application = rows[0];

        // Security check: If student_id is passed, ensure student can only view their own application
        if (studentId && application.student_id !== studentId) {
            return res.status(403).json({ message: "Access denied. You can only view your own applications." });
        }

        // Also fetch approval history
        db.query(
            "SELECT * FROM approval_history WHERE application_id = ? ORDER BY timestamp ASC",
            [application.id],
            (histErr, historyRows) => {
                res.json({
                    application: application,
                    history: historyRows || []
                });
            }
        );
    });
});

// ==========================================
// 10. GET APPLICATION APPROVAL HISTORY
// ==========================================
app.get("/api/applications/:id/history", (req, res) => {
    const appId = Number(req.params.id);
    db.query(
        "SELECT * FROM approval_history WHERE application_id = ? ORDER BY timestamp ASC",
        [appId],
        (err, rows) => {
            if (err) {
                console.error("Fetch history error:", err.message);
                return res.status(500).json({ message: "Failed to fetch approval history." });
            }
            res.json({ history: rows });
        }
    );
});

// ==========================================
// 11. STUDENT DASHBOARD STATS
// ==========================================
app.get("/api/dashboard/stats", (req, res) => {
    const studentId = req.query.student_id ? Number(req.query.student_id) : null;

    db.query("SELECT COUNT(*) AS total_schemes FROM scholarships WHERE status = 'Active'", (err, schRows) => {
        const availableScholarships = (schRows && schRows[0]) ? schRows[0].total_schemes : 3;

        if (!studentId) {
            return res.json({
                availableScholarships: availableScholarships,
                totalApplications: 0,
                pending: 0,
                approved: 0,
                rejected: 0,
                paid: 0
            });
        }

        const sql = `
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN status IN ('Submitted', 'Under Verification', 'Pending at HOD', 'Pending at Principal') THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
                SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
                SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) AS paid
            FROM applications
            WHERE student_id = ?
        `;

        db.query(sql, [studentId], (err, rows) => {
            if (err) {
                console.error("Stats query error:", err.message);
                return res.status(500).json({ message: "Failed to load dashboard statistics." });
            }

            const counts = rows[0] || {};
            res.json({
                availableScholarships: availableScholarships,
                totalApplications: counts.total || 0,
                pending: counts.pending || 0,
                approved: counts.approved || 0,
                rejected: counts.rejected || 0,
                paid: counts.paid || 0
            });
        });
    });
});

// =========================================================================
// LEVEL 1: SCHOLARSHIP OFFICER WORKFLOW (Sequential Check: Submitted -> HOD)
// =========================================================================

// Officer: View applications pending at Officer stage
app.get("/api/officer/applications", (req, res) => {
    const sql = `
        SELECT a.*, s.full_name, s.email, s.phone, s.college, s.course, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        WHERE a.status IN ('Submitted', 'Under Verification')
        ORDER BY a.applied_at ASC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Failed to fetch officer applications." });
        }
        res.json({ applications: rows });
    });
});

// Officer Stats
app.get("/api/officer/stats", (req, res) => {
    const sql = `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('Submitted', 'Under Verification') THEN 1 ELSE 0 END) AS pending_officer,
            SUM(CASE WHEN status = 'Pending at HOD' THEN 1 ELSE 0 END) AS forwarded_hod,
            SUM(CASE WHEN rejected_by_role = 'Scholarship Officer' THEN 1 ELSE 0 END) AS rejected_officer
        FROM applications
    `;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json({ message: "Error fetching stats." });
        res.json({ stats: rows[0] || {} });
    });
});

// Officer: Forward to HOD (Level 1 -> Level 2)
app.post("/api/officer/applications/:id/forward", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, officer_name } = req.body;
    const actorName = officer_name || "Scholarship Officer";

    // Sequential Check: Must be in 'Submitted' or 'Under Verification'
    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Submitted" && appRecord.status !== "Under Verification") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot forward application with status '${appRecord.status}'. Only 'Submitted' or 'Under Verification' applications can be verified.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Pending at HOD',
                current_level = 'HOD',
                officer_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [remarks || "Verified eligibility and documents. Forwarded to HOD.", applicationId], (updateErr) => {
            if (updateErr) {
                console.error("Officer forward error:", updateErr.message);
                return res.status(500).json({ message: "Failed to forward application." });
            }

            logApprovalHistory(
                applicationId,
                "Scholarship Officer",
                "Verified & Forwarded",
                actorName,
                "Scholarship Officer",
                remarks || "Documents and eligibility verified successfully. Forwarded to HOD for academic review."
            );

            res.json({
                message: "Application verified and successfully forwarded to HOD!",
                id: applicationId,
                status: "Pending at HOD",
                current_level: "HOD"
            });
        });
    });
});

// Officer: Reject Application
app.post("/api/officer/applications/:id/reject", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, reason, officer_name } = req.body;
    const actorName = officer_name || "Scholarship Officer";
    const rejectionReason = reason || remarks || "Documents invalid or eligibility requirements not met.";

    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Submitted" && appRecord.status !== "Under Verification") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot reject application with status '${appRecord.status}' at Officer level.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Rejected',
                current_level = 'Rejected',
                rejected_by_role = 'Scholarship Officer',
                rejection_reason = ?,
                officer_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [rejectionReason, rejectionReason, applicationId], (updateErr) => {
            if (updateErr) {
                console.error("Officer reject error:", updateErr.message);
                return res.status(500).json({ message: "Failed to reject application." });
            }

            logApprovalHistory(
                applicationId,
                "Scholarship Officer",
                "Rejected",
                actorName,
                "Scholarship Officer",
                rejectionReason
            );

            res.json({
                message: "Application rejected at Scholarship Officer level.",
                id: applicationId,
                status: "Rejected",
                rejection_reason: rejectionReason
            });
        });
    });
});

// =========================================================================
// LEVEL 2: FACULTY / HOD WORKFLOW (Sequential Check: Pending at HOD -> Principal)
// =========================================================================

// HOD: View applications pending at HOD stage
app.get("/api/hod/applications", (req, res) => {
    const sql = `
        SELECT a.*, s.full_name, s.email, s.phone, s.college, s.course, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        WHERE a.status = 'Pending at HOD'
        ORDER BY a.applied_at ASC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Failed to fetch HOD applications." });
        }
        res.json({ applications: rows });
    });
});

// HOD Stats
app.get("/api/hod/stats", (req, res) => {
    const sql = `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'Pending at HOD' THEN 1 ELSE 0 END) AS pending_hod,
            SUM(CASE WHEN status = 'Pending at Principal' THEN 1 ELSE 0 END) AS recommended_principal,
            SUM(CASE WHEN rejected_by_role = 'HOD' THEN 1 ELSE 0 END) AS rejected_hod
        FROM applications
    `;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json({ message: "Error fetching stats." });
        res.json({ stats: rows[0] || {} });
    });
});

// HOD: Recommend to Principal (Level 2 -> Level 3)
app.post("/api/hod/applications/:id/recommend", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, hod_name } = req.body;
    const actorName = hod_name || "Faculty / HOD";

    // Sequential Check: Must be 'Pending at HOD'
    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Pending at HOD") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot recommend application with status '${appRecord.status}'. Only applications forwarded by Scholarship Officer ('Pending at HOD') can be reviewed by HOD.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Pending at Principal',
                current_level = 'Principal',
                hod_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [remarks || "Academic details and progress verified. Recommended for scholarship.", applicationId], (updateErr) => {
            if (updateErr) {
                console.error("HOD recommend error:", updateErr.message);
                return res.status(500).json({ message: "Failed to recommend application." });
            }

            logApprovalHistory(
                applicationId,
                "HOD",
                "Recommended to Principal",
                actorName,
                "Faculty/HOD",
                remarks || "Academic attendance, discipline, and percentage verified. Recommended to Principal."
            );

            res.json({
                message: "Application academic details verified and recommended to Principal!",
                id: applicationId,
                status: "Pending at Principal",
                current_level: "Principal"
            });
        });
    });
});

// HOD: Reject Application
app.post("/api/hod/applications/:id/reject", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, reason, hod_name } = req.body;
    const actorName = hod_name || "Faculty / HOD";
    const rejectionReason = reason || remarks || "Academic criteria or departmental requirements not satisfied.";

    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Pending at HOD") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot reject application with status '${appRecord.status}' at HOD level.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Rejected',
                current_level = 'Rejected',
                rejected_by_role = 'HOD',
                rejection_reason = ?,
                hod_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [rejectionReason, rejectionReason, applicationId], (updateErr) => {
            if (updateErr) {
                console.error("HOD reject error:", updateErr.message);
                return res.status(500).json({ message: "Failed to reject application." });
            }

            logApprovalHistory(
                applicationId,
                "HOD",
                "Rejected",
                actorName,
                "Faculty/HOD",
                rejectionReason
            );

            res.json({
                message: "Application rejected at HOD level.",
                id: applicationId,
                status: "Rejected",
                rejection_reason: rejectionReason
            });
        });
    });
});

// =========================================================================
// LEVEL 3: PRINCIPAL WORKFLOW (Sequential Check: Pending at Principal -> Approved)
// =========================================================================

// Principal: View applications recommended by HOD
app.get("/api/principal/applications", (req, res) => {
    const sql = `
        SELECT a.*, s.full_name, s.email, s.phone, s.college, s.course, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        WHERE a.status = 'Pending at Principal'
        ORDER BY a.applied_at ASC
    `;
    db.query(sql, (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Failed to fetch Principal applications." });
        }
        res.json({ applications: rows });
    });
});

// Principal Stats
app.get("/api/principal/stats", (req, res) => {
    const sql = `
        SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'Pending at Principal' THEN 1 ELSE 0 END) AS pending_principal,
            SUM(CASE WHEN status IN ('Approved', 'Payment Pending', 'Paid') THEN 1 ELSE 0 END) AS approved_principal,
            SUM(CASE WHEN rejected_by_role = 'Principal' THEN 1 ELSE 0 END) AS rejected_principal
        FROM applications
    `;
    db.query(sql, (err, rows) => {
        if (err) return res.status(500).json({ message: "Error fetching stats." });
        res.json({ stats: rows[0] || {} });
    });
});

// Principal: Final Approval (Level 3 -> Level 4 Approved / Payment Pending)
app.post("/api/principal/applications/:id/approve", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, principal_name } = req.body;
    const actorName = principal_name || "Principal";

    // Sequential Check: Must be 'Pending at Principal'
    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Pending at Principal") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot give Principal approval to application with status '${appRecord.status}'. Application must be recommended by HOD first.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Approved',
                current_level = 'Completed',
                payment_status = 'Payment Pending',
                principal_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [remarks || "Final approval granted by Principal. Sent for scholarship disbursement.", applicationId], (updateErr) => {
            if (updateErr) {
                console.error("Principal approval error:", updateErr.message);
                return res.status(500).json({ message: "Failed to grant final approval." });
            }

            logApprovalHistory(
                applicationId,
                "Principal",
                "Final Approval Granted",
                actorName,
                "Principal",
                remarks || "Reviewed Officer verification & HOD recommendation. Final approval sanctioned."
            );

            res.json({
                message: "Scholarship final approval granted successfully!",
                id: applicationId,
                status: "Approved",
                current_level: "Completed"
            });
        });
    });
});

// Principal: Reject Application
app.post("/api/principal/applications/:id/reject", (req, res) => {
    const applicationId = Number(req.params.id);
    const { remarks, reason, principal_name } = req.body;
    const actorName = principal_name || "Principal";
    const rejectionReason = reason || remarks || "Final institution approval denied due to quota or criteria limitations.";

    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (appRecord.status !== "Pending at Principal") {
            return res.status(400).json({
                message: `Sequential workflow violation: Cannot reject application with status '${appRecord.status}' at Principal level.`
            });
        }

        const updateSql = `
            UPDATE applications
            SET status = 'Rejected',
                current_level = 'Rejected',
                rejected_by_role = 'Principal',
                rejection_reason = ?,
                principal_remarks = ?
            WHERE id = ?
        `;

        db.query(updateSql, [rejectionReason, rejectionReason, applicationId], (updateErr) => {
            if (updateErr) {
                console.error("Principal reject error:", updateErr.message);
                return res.status(500).json({ message: "Failed to reject application." });
            }

            logApprovalHistory(
                applicationId,
                "Principal",
                "Rejected",
                actorName,
                "Principal",
                rejectionReason
            );

            res.json({
                message: "Application rejected at Principal level.",
                id: applicationId,
                status: "Rejected",
                rejection_reason: rejectionReason
            });
        });
    });
});

// =========================================================================
// LEVEL 4 & ADMIN: SCHOLARSHIP MANAGEMENT & DISBURSEMENT
// =========================================================================

// Admin: Login (Preserved & Enhanced)
app.post("/api/admin/login", (req, res) => {
    const { email, password } = req.body;
    const adminEmail = process.env.ADMIN_EMAIL || "admin@scholarship.gov.in";
    const adminPassword = process.env.ADMIN_PASSWORD || "admin123";

    if (!email || !password) {
        return res.status(400).json({ message: "Please provide admin email and password." });
    }

    if (email.trim().toLowerCase() === adminEmail.toLowerCase() && password === adminPassword) {
        const payload = {
            id: 1,
            name: "System Administrator",
            email: adminEmail,
            role: "admin"
        };
        const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });

        return res.json({
            message: "Admin authentication successful!",
            token: token,
            admin: payload
        });
    }

    // Also check users table
    db.query("SELECT * FROM users WHERE email = ? AND role = 'admin' LIMIT 1", [email.trim().toLowerCase()], async (err, results) => {
        if (!err && results.length > 0) {
            const user = results[0];
            const match = await bcrypt.compare(password, user.password);
            if (match) {
                const payload = {
                    id: user.id,
                    name: user.full_name,
                    email: user.email,
                    role: "admin"
                };
                const token = jwt.sign(payload, JWT_SECRET, { expiresIn: "1d" });
                return res.json({
                    message: "Admin authentication successful!",
                    token: token,
                    admin: payload
                });
            }
        }
        return res.status(401).json({ message: "Invalid administrator credentials." });
    });
});

// Admin: Get all applications across all levels
app.get("/api/admin/applications", (req, res) => {
    const sql = `
        SELECT a.*,
               s.full_name, s.email, s.phone, s.college, s.course, s.category
        FROM applications a
        JOIN students s ON a.student_id = s.id
        ORDER BY a.applied_at DESC
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            console.error("Admin fetch applications error:", err.message);
            return res.status(500).json({ message: "Failed to fetch applications." });
        }

        res.json({ applications: rows });
    });
});

// Admin: Update status or override
app.patch("/api/admin/applications/:id/status", (req, res) => {
    const applicationId = Number(req.params.id);
    const { status, remarks } = req.body;

    const validStatuses = [
        "Submitted",
        "Under Verification",
        "Pending at HOD",
        "Pending at Principal",
        "Approved",
        "Rejected",
        "Payment Pending",
        "Paid"
    ];

    if (!validStatuses.includes(status)) {
        return res.status(400).json({
            message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`
        });
    }

    const sql = `UPDATE applications SET status = ? WHERE id = ?`;
    db.query(sql, [status, applicationId], (err, result) => {
        if (err) {
            console.error("Status update error:", err.message);
            return res.status(500).json({ message: "Failed to update status." });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        logApprovalHistory(
            applicationId,
            "Administrator",
            `Status changed to ${status}`,
            "System Administrator",
            "Administrator",
            remarks || `Status manually updated to ${status} by Administrator.`
        );

        res.json({
            message: `Application status updated to ${status} successfully!`,
            id: applicationId,
            status: status
        });
    });
});

// Admin: Process Payment / Disbursement (Approved -> Payment Pending -> Paid)
app.post("/api/admin/applications/:id/disburse", (req, res) => {
    const applicationId = Number(req.params.id);
    const { new_status, remarks, payment_reference } = req.body;
    const targetStatus = new_status === "Payment Pending" ? "Payment Pending" : "Paid";

    db.query("SELECT * FROM applications WHERE id = ? LIMIT 1", [applicationId], (checkErr, rows) => {
        if (checkErr || rows.length === 0) {
            return res.status(404).json({ message: "Application not found." });
        }

        const appRecord = rows[0];
        if (!["Approved", "Payment Pending"].includes(appRecord.status)) {
            return res.status(400).json({
                message: `Cannot process payment for application with status '${appRecord.status}'. Application must be Approved first.`
            });
        }

        const sql = `
            UPDATE applications
            SET status = ?,
                payment_status = ?,
                payment_reference = ?,
                payment_date = ?
            WHERE id = ?
        `;
        const paymentDate = targetStatus === "Paid" ? new Date() : null;
        const refNo = payment_reference || ("DBT-NEFT-" + Date.now());

        db.query(sql, [targetStatus, targetStatus, refNo, paymentDate, applicationId], (err) => {
            if (err) {
                return res.status(500).json({ message: "Failed to update disbursement status." });
            }

            const detailRemark = remarks || (targetStatus === "Paid"
                ? `Scholarship funds disbursed successfully. Ref: ${refNo}`
                : "Scholarship approved and queued for treasury fund transfer.");

            logApprovalHistory(
                applicationId,
                "Disbursement",
                targetStatus,
                "Disbursement Finance Officer",
                "Administrator",
                detailRemark
            );

            res.json({
                message: `Disbursement status updated to ${targetStatus}!`,
                id: applicationId,
                status: targetStatus
            });
        });
    });
});

// Admin: Manage Scholarships (CRUD)
app.get("/api/admin/scholarships", (req, res) => {
    db.query("SELECT * FROM scholarships ORDER BY created_at DESC", (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Failed to fetch scholarships." });
        }
        res.json({ scholarships: rows });
    });
});

app.post("/api/admin/scholarships", (req, res) => {
    const { id, name, description, amount, eligibility, category, deadline, status } = req.body;

    if (!id || !name || !amount || !eligibility || !category) {
        return res.status(400).json({ message: "Please fill in all required scholarship fields." });
    }

    const sql = `
        INSERT INTO scholarships (id, name, description, amount, eligibility, category, deadline, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [
        id.trim().toUpperCase(),
        name.trim(),
        description ? description.trim() : "",
        Number(amount),
        eligibility.trim(),
        category.trim(),
        deadline || null,
        status || "Active"
    ], (err) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") {
                return res.status(409).json({ message: "A scholarship with this ID already exists." });
            }
            console.error("Create scholarship error:", err.message);
            return res.status(500).json({ message: "Failed to create scholarship." });
        }

        res.status(201).json({
            message: "Scholarship scheme created successfully!",
            scholarship: { id, name, amount, category, status }
        });
    });
});

app.put("/api/admin/scholarships/:id", (req, res) => {
    const schId = req.params.id.trim();
    const { name, description, amount, eligibility, category, deadline, status } = req.body;

    const sql = `
        UPDATE scholarships
        SET name = ?, description = ?, amount = ?, eligibility = ?, category = ?, deadline = ?, status = ?
        WHERE id = ?
    `;

    db.query(sql, [
        name.trim(),
        description ? description.trim() : "",
        Number(amount),
        eligibility.trim(),
        category.trim(),
        deadline || null,
        status || "Active",
        schId
    ], (err, result) => {
        if (err) {
            console.error("Update scholarship error:", err.message);
            return res.status(500).json({ message: "Failed to update scholarship." });
        }

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Scholarship scheme not found." });
        }

        res.json({ message: "Scholarship scheme updated successfully!" });
    });
});

app.delete("/api/admin/scholarships/:id", (req, res) => {
    const schId = req.params.id.trim();
    db.query("DELETE FROM scholarships WHERE id = ?", [schId], (err, result) => {
        if (err) {
            console.error("Delete scholarship error:", err.message);
            return res.status(500).json({ message: "Failed to delete scholarship." });
        }
        res.json({ message: "Scholarship scheme removed successfully." });
    });
});

// Admin Overview Stats
app.get("/api/admin/stats", (req, res) => {
    const sql = `
        SELECT 
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('Submitted', 'Under Verification') THEN 1 ELSE 0 END) AS pending_officer,
            SUM(CASE WHEN status = 'Pending at HOD' THEN 1 ELSE 0 END) AS pending_hod,
            SUM(CASE WHEN status = 'Pending at Principal' THEN 1 ELSE 0 END) AS pending_principal,
            SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved,
            SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END) AS rejected,
            SUM(CASE WHEN status = 'Payment Pending' THEN 1 ELSE 0 END) AS payment_pending,
            SUM(CASE WHEN status = 'Paid' THEN 1 ELSE 0 END) AS paid
        FROM applications
    `;

    db.query(sql, (err, rows) => {
        if (err) {
            return res.status(500).json({ message: "Failed to fetch admin stats." });
        }
        res.json({ stats: rows[0] || {} });
    });
});

// Start Server
const server = app.listen(PORT, () => {
    console.log(`Student Scholarship Portal Backend running at http://localhost:${PORT}`);
});

module.exports = { app, server };

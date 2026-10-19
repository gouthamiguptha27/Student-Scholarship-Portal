require("dotenv").config();
const mysql = require("mysql2");
const bcrypt = require("bcryptjs");

const db = mysql.createConnection({
    host: process.env.DB_HOST || "localhost",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "gouthami123",
    database: process.env.DB_NAME || "scholarship_portal",
    multipleStatements: true
});

async function runMigration() {
    db.connect(async (err) => {
        if (err) {
            console.error("Migration failed to connect to MySQL:", err.message);
            process.exit(1);
        }
        console.log("Connected to MySQL for schema setup.");

        // 1. Create users table for staff (Officer, HOD, Principal, Admin)
        const createUsersTable = `
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(100) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                role ENUM('officer', 'hod', 'principal', 'admin') NOT NULL,
                department VARCHAR(100) DEFAULT 'General',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // 2. Create scholarships table
        const createScholarshipsTable = `
            CREATE TABLE IF NOT EXISTS scholarships (
                id VARCHAR(50) PRIMARY KEY,
                name VARCHAR(150) NOT NULL,
                description TEXT,
                amount DECIMAL(12,2) NOT NULL,
                eligibility VARCHAR(255) NOT NULL,
                category VARCHAR(50) NOT NULL,
                deadline DATE NULL,
                status ENUM('Active', 'Inactive') DEFAULT 'Active',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `;

        // 3. Create approval_history table
        const createApprovalHistoryTable = `
            CREATE TABLE IF NOT EXISTS approval_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                application_id INT NOT NULL,
                stage VARCHAR(50) NOT NULL,
                action VARCHAR(50) NOT NULL,
                actor_name VARCHAR(100) NOT NULL,
                actor_role VARCHAR(50) NOT NULL,
                remarks TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX (application_id)
            );
        `;

        db.query(createUsersTable, async (err) => {
            if (err) {
                console.error("Error creating users table:", err.message);
                process.exit(1);
            }
            console.log("Checked/created users table.");

            db.query(createScholarshipsTable, async (err) => {
                if (err) {
                    console.error("Error creating scholarships table:", err.message);
                    process.exit(1);
                }
                console.log("Checked/created scholarships table.");

                db.query(createApprovalHistoryTable, async (err) => {
                    if (err) {
                        console.error("Error creating approval_history table:", err.message);
                        process.exit(1);
                    }
                    console.log("Checked/created approval_history table.");

                    // 4. Update applications table with missing workflow and document columns
                    await updateApplicationsTable();

                    // 5. Seed default staff accounts
                    await seedStaffUsers();

                    // 6. Seed default scholarships
                    await seedScholarships();

                    console.log("Schema migration and seed complete!");
                    db.end();
                });
            });
        });
    });
}

function updateApplicationsTable() {
    return new Promise((resolve) => {
        db.query("DESCRIBE applications;", (err, cols) => {
            if (err) {
                console.error("Error describing applications:", err.message);
                return resolve();
            }

            const colNames = cols.map(c => c.Field);
            const alterStatements = [];

            if (!colNames.includes("current_level")) {
                alterStatements.push("ADD COLUMN current_level VARCHAR(50) DEFAULT 'Officer'");
            }
            if (!colNames.includes("rejection_reason")) {
                alterStatements.push("ADD COLUMN rejection_reason TEXT NULL");
            }
            if (!colNames.includes("rejected_by_role")) {
                alterStatements.push("ADD COLUMN rejected_by_role VARCHAR(50) NULL");
            }
            if (!colNames.includes("officer_remarks")) {
                alterStatements.push("ADD COLUMN officer_remarks TEXT NULL");
            }
            if (!colNames.includes("hod_remarks")) {
                alterStatements.push("ADD COLUMN hod_remarks TEXT NULL");
            }
            if (!colNames.includes("principal_remarks")) {
                alterStatements.push("ADD COLUMN principal_remarks TEXT NULL");
            }
            if (!colNames.includes("aadhar_doc")) {
                alterStatements.push("ADD COLUMN aadhar_doc VARCHAR(255) NULL");
            }
            if (!colNames.includes("income_doc")) {
                alterStatements.push("ADD COLUMN income_doc VARCHAR(255) NULL");
            }
            if (!colNames.includes("marks_doc")) {
                alterStatements.push("ADD COLUMN marks_doc VARCHAR(255) NULL");
            }
            if (!colNames.includes("bonafide_doc")) {
                alterStatements.push("ADD COLUMN bonafide_doc VARCHAR(255) NULL");
            }
            if (!colNames.includes("updated_at")) {
                alterStatements.push("ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
            }
            if (!colNames.includes("payment_status")) {
                alterStatements.push("ADD COLUMN payment_status VARCHAR(50) DEFAULT 'Pending Approval'");
            }
            if (!colNames.includes("payment_reference")) {
                alterStatements.push("ADD COLUMN payment_reference VARCHAR(100) NULL");
            }
            if (!colNames.includes("payment_date")) {
                alterStatements.push("ADD COLUMN payment_date TIMESTAMP NULL");
            }

            // Also ensure status column is VARCHAR(50) to comfortably hold 'Pending at Principal', etc.
            alterStatements.push("MODIFY COLUMN status VARCHAR(50) DEFAULT 'Submitted'");

            if (alterStatements.length > 0) {
                const sql = `ALTER TABLE applications ${alterStatements.join(", ")};`;
                db.query(sql, (alterErr) => {
                    if (alterErr) {
                        console.error("Error altering applications table:", alterErr.message);
                    } else {
                        console.log("Successfully updated applications table columns for 4-level workflow.");
                    }
                    // Normalize existing statuses and backfill payment statuses
                    db.query("UPDATE applications SET status = 'Submitted' WHERE status = 'Pending';", () => {
                        db.query("UPDATE applications SET payment_status = 'Paid' WHERE status = 'Paid';", () => {
                            db.query("UPDATE applications SET payment_status = 'Payment Pending' WHERE status IN ('Approved', 'Payment Pending');", () => {
                                resolve();
                            });
                        });
                    });
                });
            } else {
                resolve();
            }
        });
    });
}

async function seedStaffUsers() {
    const defaultUsers = [
        {
            full_name: "Scholarship Officer",
            email: "officer@scholarship.gov.in",
            password: "officer123",
            role: "officer",
            department: "Scholarship Cell"
        },
        {
            full_name: "Dr. A. Sharma (HOD)",
            email: "hod@scholarship.gov.in",
            password: "hod123",
            role: "hod",
            department: "Academic Affairs"
        },
        {
            full_name: "Prof. K. Rao (Principal)",
            email: "principal@scholarship.gov.in",
            password: "principal123",
            role: "principal",
            department: "Administration"
        },
        {
            full_name: "System Administrator",
            email: process.env.ADMIN_EMAIL || "admin@scholarship.gov.in",
            password: process.env.ADMIN_PASSWORD || "admin123",
            role: "admin",
            department: "IT Services"
        }
    ];

    for (const u of defaultUsers) {
        const hashedPassword = await bcrypt.hash(u.password, 10);
        await new Promise((resolve) => {
            const sql = `
                INSERT INTO users (full_name, email, password, role, department)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), department = VALUES(department)
            `;
            db.query(sql, [u.full_name, u.email, hashedPassword, u.role, u.department], (err) => {
                if (err) console.error(`Error seeding user ${u.email}:`, err.message);
                resolve();
            });
        });
    }
    console.log("Seeded default approver and admin accounts.");
}

async function seedScholarships() {
    const initialScholarships = [
        {
            id: "SCH001",
            name: "Merit Scholarship",
            description: "Financial assistance for academically talented students with 60%+ marks.",
            amount: 50000,
            eligibility: "60%+ marks",
            category: "Merit Based",
            status: "Active"
        },
        {
            id: "SCH002",
            name: "State Scholarship",
            description: "Scholarship support for eligible domicile students pursuing higher education.",
            amount: 30000,
            eligibility: "Income based (< ₹2,50,000/yr)",
            category: "State Scheme",
            status: "Active"
        },
        {
            id: "SCH003",
            name: "Education Support",
            description: "Financial support for students from economically weaker sections.",
            amount: 25000,
            eligibility: "Income based (< ₹2,00,000/yr)",
            category: "Need Based",
            status: "Active"
        }
    ];

    for (const s of initialScholarships) {
        await new Promise((resolve) => {
            const sql = `
                INSERT INTO scholarships (id, name, description, amount, eligibility, category, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), amount = VALUES(amount), eligibility = VALUES(eligibility), category = VALUES(category)
            `;
            db.query(sql, [s.id, s.name, s.description, s.amount, s.eligibility, s.category, s.status], (err) => {
                if (err) console.error(`Error seeding scholarship ${s.id}:`, err.message);
                resolve();
            });
        });
    }
    console.log("Seeded initial scholarships into database.");
}

runMigration();

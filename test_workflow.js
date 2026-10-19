require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");

// Let's test the workflow using the exported app with supertest or node http server
const { app } = require("./server");

async function runTests() {
    console.log("=== STARTING WORKFLOW INTEGRATION TESTS ===");
    
    // We can start listening on a test port
    const testPort = 3055;
    const testServer = app.listen(testPort, async () => {
        const baseUrl = `http://localhost:${testPort}`;
        console.log(`Test server running at ${baseUrl}`);

        try {
            // 1. Test Staff Login for Officer
            console.log("\n[Test 1] Scholarship Officer Login...");
            let res = await fetch(`${baseUrl}/api/auth/staff-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "officer@scholarship.gov.in",
                    password: "officer123",
                    role: "officer"
                })
            });
            let data = await res.json();
            console.log("Officer login response status:", res.status);
            if (res.status !== 200 || !data.token) throw new Error("Officer login failed");
            const officerToken = data.token;
            console.log("✅ Officer login verified. Token received.");

            // 2. Test Staff Login for HOD
            console.log("\n[Test 2] HOD Login...");
            res = await fetch(`${baseUrl}/api/auth/staff-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "hod@scholarship.gov.in",
                    password: "hod123",
                    role: "hod"
                })
            });
            data = await res.json();
            if (res.status !== 200 || !data.token) throw new Error("HOD login failed");
            const hodToken = data.token;
            console.log("✅ HOD login verified.");

            // 3. Test Staff Login for Principal
            console.log("\n[Test 3] Principal Login...");
            res = await fetch(`${baseUrl}/api/auth/staff-login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: "principal@scholarship.gov.in",
                    password: "principal123",
                    role: "principal"
                })
            });
            data = await res.json();
            if (res.status !== 200 || !data.token) throw new Error("Principal login failed");
            const principalToken = data.token;
            console.log("✅ Principal login verified.");

            // 4. Test Student Submission
            console.log("\n[Test 4] Submitting Student Application...");
            res = await fetch(`${baseUrl}/api/applications`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    student_id: 1,
                    scholarship_id: "SCH001",
                    scholarship_name: "Merit Scholarship",
                    academic_percentage: 88.5,
                    annual_income: 180000
                })
            });
            data = await res.json();
            console.log("Submission response:", data);
            if (res.status !== 201 || !data.applicationId) throw new Error("Application submission failed");
            const appId = data.applicationId;
            console.log(`✅ Application #${appId} created with status '${data.status}'.`);

            // 5. Test Sequential Violation: Try HOD recommending before Officer forwards
            console.log("\n[Test 5] Testing Sequential Enforcement: HOD attempting skip on 'Submitted' app...");
            res = await fetch(`${baseUrl}/api/hod/applications/${appId}/recommend`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ remarks: "Trying to skip level 1" })
            });
            data = await res.json();
            console.log("Skip attempt response status:", res.status, "message:", data.message);
            if (res.status !== 400) throw new Error("Sequential check failed! HOD was able to act on non-forwarded app!");
            console.log("✅ Sequential enforcement correctly blocked HOD skip!");

            // 6. Test Level 1: Officer Verifies and Forwards
            console.log("\n[Test 6] Level 1: Officer Verifies and Forwards to HOD...");
            res = await fetch(`${baseUrl}/api/officer/applications/${appId}/forward`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    officer_name: "Officer Sunita",
                    remarks: "Income certificate and Aadhar card verified. Eligible for Merit scheme."
                })
            });
            data = await res.json();
            console.log("Officer forward response:", data);
            if (res.status !== 200 || data.status !== "Pending at HOD") throw new Error("Officer forward failed");
            console.log("✅ Officer forward successful. Status is now 'Pending at HOD'.");

            // 7. Test Sequential Violation: Principal attempting approval before HOD recommends
            console.log("\n[Test 7] Testing Sequential Enforcement: Principal attempting skip before HOD recommends...");
            res = await fetch(`${baseUrl}/api/principal/applications/${appId}/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ remarks: "Trying to skip HOD" })
            });
            data = await res.json();
            console.log("Principal skip attempt status:", res.status, "message:", data.message);
            if (res.status !== 400) throw new Error("Sequential check failed! Principal was able to act before HOD!");
            console.log("✅ Sequential enforcement correctly blocked Principal skip!");

            // 8. Test Level 2: HOD Recommends to Principal
            console.log("\n[Test 8] Level 2: HOD Recommends to Principal...");
            res = await fetch(`${baseUrl}/api/hod/applications/${appId}/recommend`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    hod_name: "Dr. A. Sharma (HOD)",
                    remarks: "Academic marks 88.5% verified against college records. Good conduct. Recommended."
                })
            });
            data = await res.json();
            console.log("HOD recommend response:", data);
            if (res.status !== 200 || data.status !== "Pending at Principal") throw new Error("HOD recommend failed");
            console.log("✅ HOD recommendation successful. Status is now 'Pending at Principal'.");

            // 9. Test Level 3: Principal Gives Final Approval
            console.log("\n[Test 9] Level 3: Principal Gives Final Approval...");
            res = await fetch(`${baseUrl}/api/principal/applications/${appId}/approve`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    principal_name: "Prof. K. Rao (Principal)",
                    remarks: "Approved under Institutional Merit quota. Grant ₹50,000 sanctioned."
                })
            });
            data = await res.json();
            console.log("Principal approve response:", data);
            if (res.status !== 200 || data.status !== "Approved") throw new Error("Principal approve failed");
            console.log("✅ Principal approval successful. Status is now 'Approved'.");

            // 10. Test Level 4: Admin Disbursement (Approved -> Paid)
            console.log("\n[Test 10] Level 4: Admin Disbursement to Paid...");
            res = await fetch(`${baseUrl}/api/admin/applications/${appId}/disburse`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    new_status: "Paid",
                    payment_reference: "DBT-TEST-998877",
                    remarks: "Scholarship fund ₹50,000 credited to student account."
                })
            });
            data = await res.json();
            console.log("Admin disburse response:", data);
            if (res.status !== 200 || data.status !== "Paid") throw new Error("Admin disburse failed");
            console.log("✅ Admin disbursement successful. Status is now 'Paid'.");

            // 11. Test Approval History Audit Trail
            console.log("\n[Test 11] Verifying 4-Level Approval History in Database...");
            res = await fetch(`${baseUrl}/api/applications/${appId}/history`);
            data = await res.json();
            console.log("Approval History count:", data.history.length);
            data.history.forEach((h, idx) => {
                console.log(`   Step ${idx + 1}: [${h.stage}] ${h.action} by ${h.actor_name} (${h.actor_role}) - "${h.remarks}"`);
            });
            if (data.history.length < 5) throw new Error("Incomplete approval history records!");
            console.log("✅ Full 4-level audit trail verified in MySQL!");

            // 12. Test Admin Scholarship CRUD
            console.log("\n[Test 12] Admin Scholarship Management (CRUD)...");
            // Create
            res = await fetch(`${baseUrl}/api/admin/scholarships`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    id: "SCH_TEST_1",
                    name: "STEM Excellence Grant",
                    description: "Financial grant for engineering students.",
                    amount: 60000,
                    eligibility: "75%+ in STEM",
                    category: "Excellence",
                    status: "Active"
                })
            });
            data = await res.json();
            console.log("Create scholarship status:", res.status);
            if (res.status !== 201) throw new Error("Create scholarship failed");

            // Verify in catalog
            res = await fetch(`${baseUrl}/api/scholarships`);
            data = await res.json();
            const found = data.scholarships.find(s => s.id === "SCH_TEST_1");
            if (!found) throw new Error("New scholarship not found in catalog");
            console.log("✅ Admin created scholarship verified in MySQL catalog.");

            // Clean up test scholarship
            await fetch(`${baseUrl}/api/admin/scholarships/SCH_TEST_1`, { method: "DELETE" });
            console.log("✅ Cleaned up test scholarship.");

            console.log("\n🎉 ALL WORKFLOW & BACKEND TESTS PASSED WITH 100% SUCCESS!");
        } catch (err) {
            console.error("\n❌ TEST ERROR:", err);
            process.exitCode = 1;
        } finally {
            testServer.close();
            process.exit(process.exitCode || 0);
        }
    });
}

runTests();

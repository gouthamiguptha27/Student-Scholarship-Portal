require("dotenv").config();
const { app } = require("./server");

async function testRejection() {
    const testPort = 3056;
    const testServer = app.listen(testPort, async () => {
        const baseUrl = `http://localhost:${testPort}`;
        try {
            console.log("=== TESTING REJECTION AT VARIOUS WORKFLOW LEVELS ===");

            // 1. Submit App to test Officer Rejection
            let res = await fetch(`${baseUrl}/api/applications`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    student_id: 1,
                    scholarship_id: "SCH002",
                    scholarship_name: "State Scholarship",
                    academic_percentage: 55.0,
                    annual_income: 450000
                })
            });
            let data = await res.json();
            const appId = data.applicationId;
            console.log(`Created App #${appId} for Officer rejection test.`);

            // Officer rejects due to income above threshold
            res = await fetch(`${baseUrl}/api/officer/applications/${appId}/reject`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    officer_name: "Officer Sunita",
                    reason: "Annual income ₹4,50,000 exceeds maximum eligibility limit of ₹2,50,000."
                })
            });
            data = await res.json();
            console.log("Officer reject response:", data);
            if (data.status !== "Rejected" || !data.rejection_reason) throw new Error("Officer rejection failed");

            // Check track status
            res = await fetch(`${baseUrl}/api/applications/track/${data.id || appId}`);
            // Let's check history
            res = await fetch(`${baseUrl}/api/applications/${appId}/history`);
            data = await res.json();
            console.log("Approval History after rejection:", data.history);
            const lastLog = data.history[data.history.length - 1];
            if (lastLog.action !== "Rejected") throw new Error("Rejection not logged in history");

            console.log("✅ Rejection handling verified completely!");
        } catch (e) {
            console.error("Rejection test error:", e);
            process.exitCode = 1;
        } finally {
            testServer.close();
            process.exit(process.exitCode || 0);
        }
    });
}

testRejection();

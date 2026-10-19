const form = document.getElementById("registerForm");

if (form) {
    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        const name = document.getElementById("name").value.trim();
        const email = document.getElementById("email").value.trim();
        const password = document.getElementById("password").value;
        const phone = document.getElementById("phone").value.trim();
        const category = document.getElementById("category").value;
        const income = document.getElementById("income").value;
        const college = document.getElementById("college").value.trim();
        const course = document.getElementById("course").value.trim();

        if (!name || !email || !password || !phone ||
            !category || income === "" || !college || !course) {
            alert("Please fill in all fields.");
            return;
        }

        if (!/^\S+@\S+\.\S+$/.test(email)) {
            alert("Please enter a valid email address.");
            return;
        }

        try {
            const response = await fetch(
                "/api/register",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name,
                        email,
                        password,
                        phone,
                        category,
                        income,
                        college,
                        course
                    })
                }
            );

            const result = await response.json();

            if (response.ok) {
                alert(`Registration successful! Your Student ID is #${result.studentId}. Please login to continue.`);
                form.reset();
                window.location.href = "login.html";
            } else {
                alert(result.message || "Registration failed.");
            }
        } catch (error) {
            alert(
                "Backend connection failed. Please check whether the server is running."
            );
            console.error(error);
        }
    });
}

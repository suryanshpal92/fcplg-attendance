/* =========================================================
   FCPLG ATTENDANCE SYSTEM
   Frontend Application
   Flow:
   Initials → Employee Lookup → Camera → Face Verification
   ========================================================= */

/* ---------------------------------------------------------
   CONFIGURATION
   --------------------------------------------------------- */

// Your Google Apps Script Web App URL will go here later.
// DO NOT put passwords, API keys or secret credentials here.
const CONFIG = {
    GOOGLE_APPS_SCRIPT_URL: "",

    // Face detection settings
    FACE_MATCH_THRESHOLD: 0.52,

    // Camera
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,

    // Maximum time allowed for face verification
    VERIFICATION_TIMEOUT: 15000
};


/* ---------------------------------------------------------
   EMPLOYEE DATA
   --------------------------------------------------------- */

// Temporary employee database for testing.
//
// We will eventually move this to Google Sheets and fetch
// the employee information through Google Apps Script.
//
// Add employees here temporarily if required.
const EMPLOYEES = {
    "SP": {
        initials: "SP",
        name: "Suryansh Pal",
        designation: "Executive",
        department: "FCPLG"
    },

    // Example:
    //
    // "AP": {
    //     initials: "AP",
    //     name: "Apoorv XXXXX",
    //     designation: "XXXX",
    //     department: "FCPLG"
    // }
};


/* ---------------------------------------------------------
   GLOBAL VARIABLES
   --------------------------------------------------------- */

let currentEmployee = null;
let cameraStream = null;

let faceApiLoaded = false;
let modelsLoaded = false;

let referenceDescriptor = null;

let verificationRunning = false;
let verificationTimer = null;


/* ---------------------------------------------------------
   DOM ELEMENTS
   --------------------------------------------------------- */

const initialsInput = document.getElementById("initials");
const continueBtn = document.getElementById("continueBtn");

const initialStep = document.getElementById("initialStep");
const verificationStep = document.getElementById("verificationStep");

const employeeInfo = document.getElementById("employeeInfo");
const employeeDisplay = document.getElementById("employeeDisplay");

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");

const cameraStatus = document.getElementById("cameraStatus");
const verifyBtn = document.getElementById("verifyBtn");

const result = document.getElementById("result");


/* ---------------------------------------------------------
   START APPLICATION
   --------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", function () {

    console.log("FCPLG Attendance System starting...");

    if (!initialsInput || !continueBtn) {
        console.error("Required HTML elements are missing.");
        return;
    }

    continueBtn.addEventListener("click", handleInitials);

    initialsInput.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
            handleInitials();
        }
    });

    verifyBtn.addEventListener("click", verifyFace);

});


/* ---------------------------------------------------------
   STEP 1 — INITIALS
   --------------------------------------------------------- */

async function handleInitials() {

    clearResult();

    const initials = initialsInput.value
        .trim()
        .toUpperCase();

    if (!initials) {
        showResult(
            "error",
            "Please enter your initials."
        );
        return;
    }

    if (initials.length < 2) {
        showResult(
            "error",
            "Please enter valid initials."
        );
        return;
    }

    continueBtn.disabled = true;
    continueBtn.textContent = "CHECKING...";

    try {

        /*
         * First try Google Apps Script if configured.
         */
        if (CONFIG.GOOGLE_APPS_SCRIPT_URL) {

            const employee = await lookupEmployeeFromServer(initials);

            if (!employee) {

                showResult(
                    "error",
                    "Employee not found. Please check your initials."
                );

                return;
            }

            currentEmployee = employee;

        } else {

            /*
             * Temporary local employee lookup.
             */
            currentEmployee = EMPLOYEES[initials];

            if (!currentEmployee) {

                showResult(
                    "error",
                    "Employee not found. Please check your initials."
                );

                return;
            }
        }

        displayEmployee(currentEmployee);

        await startVerificationStep();

    } catch (error) {

        console.error(error);

        showResult(
            "error",
            "Unable to verify employee details. Please try again."
        );

    } finally {

        continueBtn.disabled = false;
        continueBtn.textContent = "CONTINUE";
    }
}


/* ---------------------------------------------------------
   EMPLOYEE LOOKUP — GOOGLE APPS SCRIPT
   --------------------------------------------------------- */

async function lookupEmployeeFromServer(initials) {

    const url =
        CONFIG.GOOGLE_APPS_SCRIPT_URL +
        "?action=getEmployee&initials=" +
        encodeURIComponent(initials);

    const response = await fetch(url, {
        method: "GET",
        cache: "no-store"
    });

    if (!response.ok) {
        throw new Error(
            "Server returned HTTP " + response.status
        );
    }

    const data = await response.json();

    /*
     * Expected response:
     *
     * {
     *   "success": true,
     *   "employee": {
     *       "initials": "SP",
     *       "name": "Suryansh Pal",
     *       "designation": "Executive",
     *       "department": "FCPLG"
     *   }
     * }
     */

    if (!data.success) {
        return null;
    }

    return data.employee || null;
}


/* ---------------------------------------------------------
   DISPLAY EMPLOYEE
   --------------------------------------------------------- */

function displayEmployee(employee) {

    employeeInfo.classList.remove("hidden");

    employeeInfo.innerHTML = `
        <strong>${escapeHtml(employee.name)}</strong>
        <br>
        <span>
            ${escapeHtml(employee.designation || "")}
            ${employee.department
                ? " • " + escapeHtml(employee.department)
                : ""}
        </span>
    `;

    employeeDisplay.innerHTML = `
        <strong>${escapeHtml(employee.name)}</strong>
        <br>
        <span>
            ${escapeHtml(employee.designation || "")}
            ${employee.department
                ? " • " + escapeHtml(employee.department)
                : ""}
        </span>
    `;
}


/* ---------------------------------------------------------
   STEP 2 — START VERIFICATION
   --------------------------------------------------------- */

async function startVerificationStep() {

    initialStep.classList.add("hidden");
    verificationStep.classList.remove("hidden");

    verifyBtn.disabled = true;

    setCameraStatus(
        "Loading face verification system..."
    );

    try {

        await loadFaceApi();

        setCameraStatus(
            "Loading face recognition models..."
        );

        await loadFaceModels();

        setCameraStatus(
            "Requesting camera permission..."
        );

        await startCamera();

        setCameraStatus(
            "Camera ready. Position your face inside the frame."
        );

        verifyBtn.disabled = false;

    } catch (error) {

        console.error(error);

        setCameraStatus(
            "Unable to start camera or face verification."
        );

        showResult(
            "error",
            getFriendlyCameraError(error)
        );
    }
}


/* ---------------------------------------------------------
   LOAD FACE-API.JS
   --------------------------------------------------------- */

function loadFaceApi() {

    if (faceApiLoaded && window.faceapi) {
        return Promise.resolve();
    }

    return new Promise(function (resolve, reject) {

        /*
         * If face-api.js already exists, use it.
         */
        if (window.faceapi) {

            faceApiLoaded = true;
            resolve();
            return;
        }

        const script = document.createElement("script");

        script.src =
            "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";

        script.onload = function () {

            if (window.faceapi) {

                faceApiLoaded = true;
                resolve();

            } else {

                reject(
                    new Error(
                        "face-api.js loaded but was not available."
                    )
                );
            }
        };

        script.onerror = function () {

            reject(
                new Error(
                    "Could not load face-api.js."
                )
            );
        };

        document.head.appendChild(script);
    });
}


/* ---------------------------------------------------------
   LOAD FACE MODELS
   --------------------------------------------------------- */

async function loadFaceModels() {

    if (modelsLoaded) {
        return;
    }

    /*
     * Public model repository.
     *
     * These models run inside the browser.
     * No camera image is uploaded by this code.
     */
    const MODEL_URL =
        "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";

    await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

    await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

    await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

    modelsLoaded = true;

    console.log("Face recognition models loaded.");
}


/* ---------------------------------------------------------
   START CAMERA
   --------------------------------------------------------- */

async function startCamera() {

    stopCamera();

    if (!navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia) {

        throw new Error(
            "Camera API is not supported by this browser."
        );
    }

    cameraStream =
        await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: "user",

                width: {
                    ideal: CONFIG.CAMERA_WIDTH
                },

                height: {
                    ideal: CONFIG.CAMERA_HEIGHT
                }
            },

            audio: false
        });

    video.srcObject = cameraStream;

    await new Promise(function (resolve) {

        video.onloadedmetadata = function () {

            video.play()
                .then(resolve)
                .catch(resolve);
        };
    });

    /*
     * Set canvas size to video size.
     */
    overlay.width = video.videoWidth ||
        CONFIG.CAMERA_WIDTH;

    overlay.height = video.videoHeight ||
        CONFIG.CAMERA_HEIGHT;

    console.log(
        "Camera started:",
        video.videoWidth,
        video.videoHeight
    );
}


/* ---------------------------------------------------------
   FACE VERIFICATION
   --------------------------------------------------------- */

async function verifyFace() {

    if (verificationRunning) {
        return;
    }

    if (!currentEmployee) {

        showResult(
            "error",
            "Employee information is missing."
        );

        return;
    }

    verificationRunning = true;

    verifyBtn.disabled = true;

    setCameraStatus(
        "Scanning face..."
    );

    clearResult();

    try {

        const detection =
            await detectFace();

        if (!detection) {

            setCameraStatus(
                "No clear face detected."
            );

            showResult(
                "error",
                "Face not detected. Please look directly at the camera."
            );

            return;
        }

        setCameraStatus(
            "Face detected. Checking identity..."
        );

        /*
         * IMPORTANT:
         *
         * At this stage we need the employee's registered
         * face descriptor.
         *
         * For the first prototype we create/store the
         * descriptor locally.
         *
         * Later the descriptor will come from the
         * Google Apps Script / employee database.
         */
        const currentDescriptor =
            detection.descriptor;

        if (!referenceDescriptor) {

            /*
             * FIRST TEST MODE
             *
             * This stores the first successful scan as the
             * reference face in this browser.
             *
             * We will replace this with proper employee
             * enrollment storage.
             */
            referenceDescriptor =
                Array.from(currentDescriptor);

            localStorage.setItem(
                "fcplg_face_" +
                currentEmployee.initials,
                JSON.stringify(referenceDescriptor)
            );

            showResult(
                "success",
                "Face registered successfully for " +
                currentEmployee.name +
                ". Please scan again to verify attendance."
            );

            setCameraStatus(
                "Face registration complete."
            );

            return;
        }

        const distance =
            faceapi.euclideanDistance(
                currentDescriptor,
                new Float32Array(referenceDescriptor)
            );

        console.log(
            "Face distance:",
            distance
        );

        if (
            distance <=
            CONFIG.FACE_MATCH_THRESHOLD
        ) {

            setCameraStatus(
                "Face verified successfully."
            );

            showResult(
                "success",
                "Face verified. Attendance can now be marked."
            );

            /*
             * Next stage:
             * GPS → 50 metre check → Google Sheet
             */
            await markAttendance();

        } else {

            setCameraStatus(
                "Face does not match."
            );

            showResult(
                "error",
                "Face verification failed. Please try again."
            );
        }

    } catch (error) {

        console.error(
            "Face verification error:",
            error
        );

        showResult(
            "error",
            "Face verification could not be completed."
        );

    } finally {

        verificationRunning = false;

        verifyBtn.disabled = false;
    }
}


/* ---------------------------------------------------------
   FACE DETECTION
   --------------------------------------------------------- */

async function detectFace() {

    if (!window.faceapi) {
        throw new Error(
            "Face recognition library is not loaded."
        );
    }

    const options =
        new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5
        });

    const detection =
        await faceapi
            .detectSingleFace(
                video,
                options
            )
            .withFaceLandmarks()
            .withFaceDescriptor();

    return detection;
}


/* ---------------------------------------------------------
   LOAD SAVED REFERENCE FACE
   --------------------------------------------------------- */

function loadSavedReferenceFace() {

    if (!currentEmployee) {
        return null;
    }

    const key =
        "fcplg_face_" +
        currentEmployee.initials;

    const saved =
        localStorage.getItem(key);

    if (!saved) {
        return null;
    }

    try {

        return JSON.parse(saved);

    } catch (error) {

        console.error(
            "Invalid saved face descriptor.",
            error
        );

        return null;
    }
}


/* ---------------------------------------------------------
   ATTENDANCE
   --------------------------------------------------------- */

async function markAttendance() {

    /*
     * Get location before marking attendance.
     */
    setCameraStatus(
        "Face verified. Checking location..."
    );

    try {

        const position =
            await getCurrentLocation();

        const latitude =
            position.coords.latitude;

        const longitude =
            position.coords.longitude;

        const accuracy =
            position.coords.accuracy;

        console.log(
            "Location:",
            latitude,
            longitude,
            "Accuracy:",
            accuracy
        );

        /*
         * For now we only display the location result.
         *
         * The actual office coordinates and 50m geofence
         * will be connected in the next backend stage.
         */
        showResult(
            "success",
            "Face verified successfully.<br>" +
            "Location captured.<br>" +
            "Attendance is ready to be recorded."
        );

        /*
         * If Apps Script is configured, send attendance.
         */
        if (CONFIG.GOOGLE_APPS_SCRIPT_URL) {

            await sendAttendanceToServer({
                initials:
                    currentEmployee.initials,

                name:
                    currentEmployee.name,

                designation:
                    currentEmployee.designation,

                latitude:
                    latitude,

                longitude:
                    longitude,

                accuracy:
                    accuracy,

                timestamp:
                    new Date().toISOString()
            });
        }

    } catch (error) {

        console.error(
            "Location error:",
            error
        );

        showResult(
            "error",
            "Face verified, but location could not be obtained."
        );
    }
}


/* ---------------------------------------------------------
   GET GPS LOCATION
   --------------------------------------------------------- */

function getCurrentLocation() {

    return new Promise(function (
        resolve,
        reject
    ) {

        if (!navigator.geolocation) {

            reject(
                new Error(
                    "Geolocation is not supported."
                )
            );

            return;
        }

        navigator.geolocation.getCurrentPosition(
            resolve,
            reject,
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 0
            }
        );
    });
}


/* ---------------------------------------------------------
   SEND ATTENDANCE TO GOOGLE APPS SCRIPT
   --------------------------------------------------------- */

async function sendAttendanceToServer(data) {

    const response =
        await fetch(
            CONFIG.GOOGLE_APPS_SCRIPT_URL,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "text/plain;charset=utf-8"
                },

                body: JSON.stringify({
                    action:
                        "markAttendance",

                    data:
                        data
                })
            }
        );

    if (!response.ok) {

        throw new Error(
            "Attendance server returned HTTP " +
            response.status
        );
    }

    const result =
        await response.json();

    console.log(
        "Attendance server response:",
        result
    );

    if (!result.success) {

        throw new Error(
            result.message ||
            "Attendance was not recorded."
        );
    }

    showResult(
        "success",
        result.message ||
        "Attendance marked successfully."
    );
}


/* ---------------------------------------------------------
   CAMERA STATUS
   --------------------------------------------------------- */

function setCameraStatus(message) {

    if (!cameraStatus) {
        return;
    }

    cameraStatus.textContent =
        message;
}


/* ---------------------------------------------------------
   RESULT MESSAGE
   --------------------------------------------------------- */

function showResult(
    type,
    message
) {

    if (!result) {
        return;
    }

    result.classList.remove(
        "hidden",
        "success",
        "error"
    );

    result.classList.add(type);

    result.innerHTML =
        message;
}


function clearResult() {

    if (!result) {
        return;
    }

    result.classList.add("hidden");

    result.classList.remove(
        "success",
        "error"
    );

    result.innerHTML = "";
}


/* ---------------------------------------------------------
   STOP CAMERA
   --------------------------------------------------------- */

function stopCamera() {

    if (!cameraStream) {
        return;
    }

    cameraStream
        .getTracks()
        .forEach(function (track) {
            track.stop();
        });

    cameraStream = null;

    if (video) {
        video.srcObject = null;
    }
}


/* ---------------------------------------------------------
   FRIENDLY CAMERA ERROR
   --------------------------------------------------------- */

function getFriendlyCameraError(error) {

    if (!error) {
        return "Unable to access the camera.";
    }

    if (
        error.name ===
        "NotAllowedError"
    ) {

        return (
            "Camera permission was denied. " +
            "Please allow camera access in Chrome " +
            "and reload the page."
        );
    }

    if (
        error.name ===
        "NotFoundError"
    ) {

        return (
            "No camera was found on this device."
        );
    }

    if (
        error.name ===
        "NotReadableError"
    ) {

        return (
            "The camera is being used by another application."
        );
    }

    if (
        error.name ===
        "SecurityError"
    ) {

        return (
            "Camera access is blocked by browser security settings."
        );
    }

    return (
        "Unable to access the camera. " +
        "Please check your browser permissions."
    );
}


/* ---------------------------------------------------------
   ESCAPE HTML
   --------------------------------------------------------- */

function escapeHtml(value) {

    if (value === null ||
        value === undefined) {

        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


/* ---------------------------------------------------------
   PAGE CLEANUP
   --------------------------------------------------------- */

window.addEventListener(
    "beforeunload",
    function () {

        stopCamera();

        if (verificationTimer) {
            clearTimeout(
                verificationTimer
            );
        }
    }
);


/* ---------------------------------------------------------
   DEVELOPMENT HELPERS
   --------------------------------------------------------- */

window.FCPLG = {

    getCurrentEmployee:
        function () {
            return currentEmployee;
        },

    clearSavedFace:
        function () {

            if (!currentEmployee) {
                console.log(
                    "No employee selected."
                );
                return;
            }

            localStorage.removeItem(
                "fcplg_face_" +
                currentEmployee.initials
            );

            referenceDescriptor =
                null;

            console.log(
                "Saved face cleared."
            );
        },

    loadSavedFace:
        function () {

            referenceDescriptor =
                loadSavedReferenceFace();

            console.log(
                "Saved reference:",
                referenceDescriptor
            );
        },

    stopCamera:
        stopCamera
};

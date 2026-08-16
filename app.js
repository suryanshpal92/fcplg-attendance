/* =========================================================
   FCPLG ATTENDANCE SYSTEM
   Frontend Application

   FLOW:
   Initials
      ↓
   Employee Lookup
      ↓
   Camera
      ↓
   Face Verification
      ↓
   GPS Location
      ↓
   Google Apps Script
      ↓
   Attendance Sheet
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONFIG = {

    // Google Apps Script Web App
    GOOGLE_APPS_SCRIPT_URL:
        "https://script.google.com/macros/s/AKfycbwX0scaFHFCJ8OdUYOZl3_IEhbJKHGTNYTm-Ih9piKOZc4CXIGYhHHguRjM_b16qYS2Vw/exec",

    // Face matching threshold
    // Lower = stricter
    FACE_MATCH_THRESHOLD: 0.52,

    // Camera resolution
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,

    // Camera / verification timeout
    VERIFICATION_TIMEOUT: 15000,

    // FCPLG office coordinates
    // IMPORTANT:
    // We will replace these with the exact FCPLG coordinates
    // before enabling the 50 metre geofence.
    OFFICE_LATITUDE: null,
    OFFICE_LONGITUDE: null,

    // Allowed distance in metres
    GEOFENCE_RADIUS_METERS: 50
};


/* =========================================================
   TEMPORARY EMPLOYEE DATABASE
   ========================================================= */

const EMPLOYEES = {

    "SP": {
        initials: "SP",
        name: "Suryansh Pal",
        designation: "Executive",
        department: "FCPLG"
    }

};


/* =========================================================
   GLOBAL VARIABLES
   ========================================================= */

let currentEmployee = null;

let cameraStream = null;

let faceApiLoaded = false;
let modelsLoaded = false;

let referenceDescriptor = null;

let verificationRunning = false;


/* =========================================================
   DOM ELEMENTS
   ========================================================= */

const initialsInput =
    document.getElementById("initials");

const continueBtn =
    document.getElementById("continueBtn");

const initialStep =
    document.getElementById("initialStep");

const verificationStep =
    document.getElementById("verificationStep");

const employeeInfo =
    document.getElementById("employeeInfo");

const employeeDisplay =
    document.getElementById("employeeDisplay");

const video =
    document.getElementById("video");

const overlay =
    document.getElementById("overlay");

const cameraStatus =
    document.getElementById("cameraStatus");

const verifyBtn =
    document.getElementById("verifyBtn");

const result =
    document.getElementById("result");


/* =========================================================
   APPLICATION START
   ========================================================= */

document.addEventListener(
    "DOMContentLoaded",
    function () {

        console.log(
            "FCPLG Attendance System started."
        );

        if (!initialsInput || !continueBtn) {

            console.error(
                "Required HTML elements are missing."
            );

            return;
        }

        continueBtn.addEventListener(
            "click",
            handleInitials
        );

        initialsInput.addEventListener(
            "keydown",
            function (event) {

                if (event.key === "Enter") {
                    handleInitials();
                }

            }
        );

        if (verifyBtn) {

            verifyBtn.addEventListener(
                "click",
                verifyFace
            );

        }

    }
);


/* =========================================================
   STEP 1 — INITIALS
   ========================================================= */

async function handleInitials() {

    clearResult();

    const initials =
        initialsInput.value
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

        let employee = null;


        /* -----------------------------------------
           TRY GOOGLE APPS SCRIPT FIRST
           ----------------------------------------- */

        if (CONFIG.GOOGLE_APPS_SCRIPT_URL) {

            try {

                employee =
                    await lookupEmployeeFromServer(
                        initials
                    );

            } catch (serverError) {

                console.warn(
                    "Server lookup failed.",
                    serverError
                );

            }

        }


        /* -----------------------------------------
           TEMPORARY LOCAL FALLBACK
           ----------------------------------------- */

        if (!employee) {

            employee =
                EMPLOYEES[initials];

        }


        /* -----------------------------------------
           EMPLOYEE NOT FOUND
           ----------------------------------------- */

        if (!employee) {

            showResult(
                "error",
                "Employee not found. Please check your initials."
            );

            return;
        }


        /* -----------------------------------------
           STORE EMPLOYEE
           ----------------------------------------- */

        currentEmployee = employee;

        displayEmployee(
            currentEmployee
        );


        /* -----------------------------------------
           START FACE VERIFICATION
           ----------------------------------------- */

        await startVerificationStep();


    } catch (error) {

        console.error(
            "Employee lookup error:",
            error
        );

        showResult(
            "error",
            "Unable to verify employee details."
        );


    } finally {

        continueBtn.disabled = false;

        continueBtn.textContent =
            "CONTINUE";

    }

}


/* =========================================================
   EMPLOYEE LOOKUP — GOOGLE APPS SCRIPT
   ========================================================= */

async function lookupEmployeeFromServer(
    initials
) {

    const url =
        CONFIG.GOOGLE_APPS_SCRIPT_URL +
        "?action=getEmployee&initials=" +
        encodeURIComponent(initials);

    const response =
        await fetch(
            url,
            {
                method: "GET",
                cache: "no-store"
            }
        );

    if (!response.ok) {

        throw new Error(
            "Server returned HTTP " +
            response.status
        );

    }

    const data =
        await response.json();

    if (!data.success) {
        return null;
    }

    return data.employee || null;

}


/* =========================================================
   DISPLAY EMPLOYEE
   ========================================================= */

function displayEmployee(
    employee
) {

    const html = `
        <strong>
            ${escapeHtml(employee.name)}
        </strong>
        <br>
        <span>
            ${escapeHtml(
                employee.designation || ""
            )}
            ${
                employee.department
                    ? " • " +
                      escapeHtml(
                          employee.department
                      )
                    : ""
            }
        </span>
    `;


    if (employeeInfo) {

        employeeInfo.classList.remove(
            "hidden"
        );

        employeeInfo.innerHTML =
            html;

    }


    if (employeeDisplay) {

        employeeDisplay.innerHTML =
            html;

    }

}


/* =========================================================
   STEP 2 — START VERIFICATION
   ========================================================= */

async function startVerificationStep() {

    if (initialStep) {
        initialStep.classList.add(
            "hidden"
        );
    }

    if (verificationStep) {
        verificationStep.classList.remove(
            "hidden"
        );
    }

    if (verifyBtn) {
        verifyBtn.disabled = true;
    }

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

        if (verifyBtn) {
            verifyBtn.disabled = false;
        }


    } catch (error) {

        console.error(
            "Verification startup error:",
            error
        );

        setCameraStatus(
            "Unable to start camera or face verification."
        );

        showResult(
            "error",
            getFriendlyCameraError(error)
        );

    }

}


/* =========================================================
   LOAD FACE-API.JS
   ========================================================= */

function loadFaceApi() {

    if (
        faceApiLoaded &&
        window.faceapi
    ) {

        return Promise.resolve();

    }


    return new Promise(
        function (
            resolve,
            reject
        ) {

            if (window.faceapi) {

                faceApiLoaded = true;

                resolve();

                return;

            }


            const script =
                document.createElement(
                    "script"
                );


            script.src =
                "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";


            script.onload =
                function () {

                    if (
                        window.faceapi
                    ) {

                        faceApiLoaded =
                            true;

                        resolve();

                    } else {

                        reject(
                            new Error(
                                "face-api.js loaded but is unavailable."
                            )
                        );

                    }

                };


            script.onerror =
                function () {

                    reject(
                        new Error(
                            "Could not load face-api.js."
                        )
                    );

                };


            document.head.appendChild(
                script
            );

        }
    );

}


/* =========================================================
   LOAD FACE MODELS
   ========================================================= */

async function loadFaceModels() {

    if (modelsLoaded) {
        return;
    }


    const MODEL_URL =
        "https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights";


    await faceapi.nets.tinyFaceDetector
        .loadFromUri(
            MODEL_URL
        );


    await faceapi.nets.faceLandmark68Net
        .loadFromUri(
            MODEL_URL
        );


    await faceapi.nets.faceRecognitionNet
        .loadFromUri(
            MODEL_URL
        );


    modelsLoaded = true;

    console.log(
        "Face recognition models loaded."
    );

}


/* =========================================================
   START CAMERA
   ========================================================= */

async function startCamera() {

    stopCamera();


    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {

        throw new Error(
            "Camera API is not supported."
        );

    }


    cameraStream =
        await navigator.mediaDevices
            .getUserMedia(
                {
                    video: {

                        facingMode:
                            "user",

                        width: {
                            ideal:
                                CONFIG.CAMERA_WIDTH
                        },

                        height: {
                            ideal:
                                CONFIG.CAMERA_HEIGHT
                        }

                    },

                    audio: false
                }
            );


    video.srcObject =
        cameraStream;


    await new Promise(
        function (resolve) {

            video.onloadedmetadata =
                function () {

                    video.play()
                        .then(resolve)
                        .catch(resolve);

                };

        }
    );


    if (overlay) {

        overlay.width =
            video.videoWidth ||
            CONFIG.CAMERA_WIDTH;

        overlay.height =
            video.videoHeight ||
            CONFIG.CAMERA_HEIGHT;

    }


    console.log(
        "Camera started."
    );

}


/* =========================================================
   FACE VERIFICATION
   ========================================================= */

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

    if (verifyBtn) {
        verifyBtn.disabled = true;
    }


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


        const currentDescriptor =
            detection.descriptor;


        /* -----------------------------------------
           LOAD PREVIOUSLY SAVED FACE
           ----------------------------------------- */

        if (!referenceDescriptor) {

            referenceDescriptor =
                loadSavedReferenceFace();

        }


        /* -----------------------------------------
           FIRST SCAN
           ----------------------------------------- */

        if (!referenceDescriptor) {

            referenceDescriptor =
                Array.from(
                    currentDescriptor
                );


            localStorage.setItem(
                "fcplg_face_" +
                currentEmployee.initials,

                JSON.stringify(
                    referenceDescriptor
                )
            );


            showResult(
                "success",
                "Face registered successfully for " +
                escapeHtml(
                    currentEmployee.name
                ) +
                ". Please scan again to verify attendance."
            );


            setCameraStatus(
                "Face registration complete."
            );


            return;

        }


        /* -----------------------------------------
           COMPARE FACES
           ----------------------------------------- */

        const distance =
            faceapi.euclideanDistance(
                currentDescriptor,
                new Float32Array(
                    referenceDescriptor
                )
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
                "Face verified. Checking location..."
            );


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

        if (verifyBtn) {
            verifyBtn.disabled = false;
        }

    }

}


/* =========================================================
   FACE DETECTION
   ========================================================= */

async function detectFace() {

    if (!window.faceapi) {

        throw new Error(
            "Face recognition library is not loaded."
        );

    }


    const options =
        new faceapi.TinyFaceDetectorOptions(
            {
                inputSize: 320,
                scoreThreshold: 0.5
            }
        );


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


/* =========================================================
   LOAD SAVED FACE
   ========================================================= */

function loadSavedReferenceFace() {

    if (!currentEmployee) {
        return null;
    }


    const key =
        "fcplg_face_" +
        currentEmployee.initials;


    const saved =
        localStorage.getItem(
            key
        );


    if (!saved) {
        return null;
    }


    try {

        return JSON.parse(
            saved
        );

    } catch (error) {

        console.error(
            "Invalid saved face.",
            error
        );

        return null;

    }

}


/* =========================================================
   ATTENDANCE
   ========================================================= */

async function markAttendance() {

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
            "GPS:",
            latitude,
            longitude,
            "Accuracy:",
            accuracy
        );


        /* -----------------------------------------
           GEOFENCE
           ----------------------------------------- */

        if (
            CONFIG.OFFICE_LATITUDE !== null &&
            CONFIG.OFFICE_LONGITUDE !== null
        ) {

            const distance =
                calculateDistance(
                    latitude,
                    longitude,
                    CONFIG.OFFICE_LATITUDE,
                    CONFIG.OFFICE_LONGITUDE
                );


            console.log(
                "Distance from FCPLG:",
                distance,
                "metres"
            );


            if (
                distance >
                CONFIG.GEOFENCE_RADIUS_METERS
            ) {

                showResult(
                    "error",
                    "You are outside the FCPLG attendance area."
                );


                setCameraStatus(
                    "Location verification failed."
                );


                return;

            }

        }


        /* -----------------------------------------
           SEND ATTENDANCE TO SERVER
           ----------------------------------------- */

        setCameraStatus(
            "Location verified. Recording attendance..."
        );


        await sendAttendanceToServer(
            {

                initials:
                    currentEmployee.initials,

                name:
                    currentEmployee.name,

                designation:
                    currentEmployee.designation,

                department:
                    currentEmployee.department,

                latitude:
                    latitude,

                longitude:
                    longitude,

                accuracy:
                    accuracy,

                timestamp:
                    new Date().toISOString()

            }
        );


    } catch (error) {

        console.error(
            "Attendance error:",
            error
        );


        showResult(
            "error",
            "Face verified, but attendance could not be recorded."
        );


        setCameraStatus(
            "Attendance recording failed."
        );

    }

}


/* =========================================================
   GPS
   ========================================================= */

function getCurrentLocation() {

    return new Promise(
        function (
            resolve,
            reject
        ) {

            if (
                !navigator.geolocation
            ) {

                reject(
                    new Error(
                        "Geolocation is not supported."
                    )
                );

                return;

            }


            navigator.geolocation
                .getCurrentPosition(
                    resolve,
                    reject,
                    {

                        enableHighAccuracy:
                            true,

                        timeout:
                            10000,

                        maximumAge:
                            0

                    }
                );

        }
    );

}


/* =========================================================
   DISTANCE CALCULATION
   ========================================================= */

function calculateDistance(
    lat1,
    lon1,
    lat2,
    lon2
) {

    const earthRadius =
        6371000;


    const dLat =
        toRadians(
            lat2 - lat1
        );


    const dLon =
        toRadians(
            lon2 - lon1
        );


    const a =
        Math.sin(
            dLat / 2
        ) *
        Math.sin(
            dLat / 2
        ) +

        Math.cos(
            toRadians(lat1)
        ) *
        Math.cos(
            toRadians(lat2)
        ) *

        Math.sin(
            dLon / 2
        ) *
        Math.sin(
            dLon / 2
        );


    const c =
        2 *
        Math.atan2(
            Math.sqrt(a),
            Math.sqrt(1 - a)
        );


    return (
        earthRadius *
        c
    );

}


function toRadians(
    degrees
) {

    return (
        degrees *
        Math.PI /
        180
    );

}


/* =========================================================
   SEND ATTENDANCE TO GOOGLE APPS SCRIPT
   ========================================================= */

async function sendAttendanceToServer(
    data
) {

    const response =
        await fetch(
            CONFIG.GOOGLE_APPS_SCRIPT_URL,
            {

                method:
                    "POST",

                headers:
                    {
                        "Content-Type":
                            "text/plain;charset=utf-8"
                    },

                body:
                    JSON.stringify(
                        {
                            action:
                                "markAttendance",

                            data:
                                data
                        }
                    )

            }
        );


    if (!response.ok) {

        throw new Error(
            "Attendance server returned HTTP " +
            response.status
        );

    }


    const serverResult =
        await response.json();


    console.log(
        "Attendance server response:",
        serverResult
    );


    if (
        !serverResult.success
    ) {

        throw new Error(
            serverResult.message ||
            "Attendance was not recorded."
        );

    }


    setCameraStatus(
        "Attendance marked successfully."
    );


    showResult(
        "success",
        serverResult.message ||
        "Attendance marked successfully."
    );

}


/* =========================================================
   CAMERA STATUS
   ========================================================= */

function setCameraStatus(
    message
) {

    if (!cameraStatus) {
        return;
    }


    cameraStatus.textContent =
        message;

}


/* =========================================================
   RESULT
   ========================================================= */

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


    result.classList.add(
        type
    );


    result.innerHTML =
        message;

}


function clearResult() {

    if (!result) {
        return;
    }


    result.classList.add(
        "hidden"
    );


    result.classList.remove(
        "success",
        "error"
    );


    result.innerHTML =
        "";

}


/* =========================================================
   STOP CAMERA
   ========================================================= */

function stopCamera() {

    if (!cameraStream) {
        return;
    }


    cameraStream
        .getTracks()
        .forEach(
            function (track) {

                track.stop();

            }
        );


    cameraStream =
        null;


    if (video) {

        video.srcObject =
            null;

    }

}


/* =========================================================
   CAMERA ERROR
   ========================================================= */

function getFriendlyCameraError(
    error
) {

    if (!error) {

        return (
            "Unable to access the camera."
        );

    }


    if (
        error.name ===
        "NotAllowedError"
    ) {

        return (
            "Camera permission was denied. " +
            "Please allow camera access in Chrome and reload the page."
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


/* =========================================================
   HTML ESCAPE
   ========================================================= */

function escapeHtml(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return "";

    }


    return String(value)

        .replace(
            /&/g,
            "&amp;"
        )

        .replace(
            /</g,
            "&lt;"
        )

        .replace(
            />/g,
            "&gt;"
        )

        .replace(
            /"/g,
            "&quot;"
        )

        .replace(
            /'/g,
            "&#039;"
        );

}


/* =========================================================
   DEVELOPMENT HELPERS
   ========================================================= */

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
                "Saved reference face loaded."
            );

        },


    stopCamera:
        stopCamera

};


/* =========================================================
   PAGE CLEANUP
   ========================================================= */

window.addEventListener(
    "beforeunload",
    function () {

        stopCamera();

    }
);

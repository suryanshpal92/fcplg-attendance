/* =========================================================
   FCPLG ATTENDANCE SYSTEM
   FRONTEND APPLICATION

   FLOW:

   Initials
      ↓
   Employee Lookup
      ↓
   Face Data Lookup
      ↓
   Camera
      ↓
   Face Registration / Verification
      ↓
   GPS
      ↓
   Google Apps Script
      ↓
   Attendance Sheet
   ========================================================= */


/* =========================================================
   CONFIGURATION
   ========================================================= */

const CONFIG = {

    // YOUR GOOGLE APPS SCRIPT WEB APP
    GOOGLE_APPS_SCRIPT_URL:
        "https://script.google.com/macros/s/AKfycbwX0scaFHFCJ8OdUYOZl3_IEhbJKHGTNYTm-Ih9piKOZc4CXIGYhHHguRjM_b16qYS2Vw/exec",

    // Face matching threshold
    // Lower = stricter
    FACE_MATCH_THRESHOLD: 0.52,

    // Camera
    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,

    // Verification timeout
    VERIFICATION_TIMEOUT: 15000,

    // Optional frontend geofence
    // Backend already performs the actual geofence check.
    OFFICE_LATITUDE: null,
    OFFICE_LONGITUDE: null,

    GEOFENCE_RADIUS_METERS: 50
};


/* =========================================================
   TEMPORARY LOCAL EMPLOYEE FALLBACK
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
   STEP 1
   EMPLOYEE LOOKUP
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

    continueBtn.textContent =
        "CHECKING...";


    try {

        let employee = null;


        /* -------------------------------------------------
           LOOKUP EMPLOYEE FROM GOOGLE APPS SCRIPT
           ------------------------------------------------- */

        try {

            employee =
                await lookupEmployeeFromServer(
                    initials
                );

        } catch (error) {

            console.warn(
                "Server employee lookup failed:",
                error
            );

        }


        /* -------------------------------------------------
           LOCAL FALLBACK
           ------------------------------------------------- */

        if (!employee) {

            employee =
                EMPLOYEES[initials];

        }


        if (!employee) {

            showResult(
                "error",
                "Employee not found. Please check your initials."
            );

            return;
        }


        /* -------------------------------------------------
           STORE EMPLOYEE
           ------------------------------------------------- */

        currentEmployee = employee;


        displayEmployee(
            currentEmployee
        );


        /* -------------------------------------------------
           START CAMERA / FACE SYSTEM
           ------------------------------------------------- */

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
   GOOGLE APPS SCRIPT
   EMPLOYEE LOOKUP
   ========================================================= */

function lookupEmployeeFromServer(
    initials
) {

    return jsonpRequest(
        "lookup",
        {
            initials: initials
        }
    ).then(
        function (data) {

            if (!data || !data.success) {

                return null;

            }

            return {

                initials:
                    data.initials,

                name:
                    data.name,

                email:
                    data.email,

                department:
                    data.department,

                designation:
                    data.designation,

                status:
                    data.status

            };

        }
    );

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
   STEP 2
   START VERIFICATION
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
   LOAD FACE API
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
   FACE VERIFICATION / REGISTRATION
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


    clearResult();


    setCameraStatus(
        "Scanning face..."
    );


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
            "Face detected. Checking registered face..."
        );


        const currentDescriptor =
            detection.descriptor;


        /* =================================================
           IMPORTANT

           SERVER IS THE SOURCE OF TRUTH.

           DO NOT use localStorage first.

           This fixes the exact problem we had:
           the phone had a face locally but Google Sheet
           had nothing.
           ================================================= */

        let serverFace = null;


        try {

            serverFace =
                await getRegisteredFace(
                    currentEmployee.initials
                );

        } catch (error) {

            console.error(
                "Could not retrieve registered face:",
                error
            );

        }


        /* =================================================
           NO SERVER FACE
           → REGISTER THIS FACE
           ================================================= */

        if (
            !serverFace ||
            !serverFace.enrolled ||
            !serverFace.descriptor
        ) {

            setCameraStatus(
                "No registered face found. Saving your face..."
            );


            const descriptor =
                Array.from(
                    currentDescriptor
                );


            const registrationResult =
                await registerFaceOnServer(
                    currentEmployee.initials,
                    descriptor
                );


            if (
                !registrationResult ||
                !registrationResult.success
            ) {

                throw new Error(
                    registrationResult &&
                    registrationResult.message
                        ? registrationResult.message
                        : "Face registration failed."
                );

            }


            /* ---------------------------------------------
               SAVE LOCAL BACKUP ONLY AFTER SERVER SUCCESS
               --------------------------------------------- */

            referenceDescriptor =
                descriptor;


            localStorage.setItem(
                "fcplg_face_" +
                currentEmployee.initials,
                JSON.stringify(
                    descriptor
                )
            );


            setCameraStatus(
                "Face registration complete."
            );


            showResult(
                "success",
                "Face registered successfully. Your face data has been saved to the attendance system."
            );


            return;

        }


        /* =================================================
           SERVER FACE EXISTS
           → USE IT
           ================================================= */

        try {

            referenceDescriptor =
                JSON.parse(
                    serverFace.descriptor
                );

        } catch (error) {

            throw new Error(
                "Registered face data is corrupted."
            );

        }


        if (
            !Array.isArray(
                referenceDescriptor
            ) ||
            referenceDescriptor.length === 0
        ) {

            throw new Error(
                "Registered face data is invalid."
            );

        }


        /* =================================================
           COMPARE FACES
           ================================================= */

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
                "Face does not match the registered face. Please try again."
            );

        }


    } catch (error) {

        console.error(
            "Face verification error:",
            error
        );


        showResult(
            "error",
            error && error.message
                ? escapeHtml(
                    error.message
                  )
                : "Face verification could not be completed."
        );


        setCameraStatus(
            "Face verification failed."
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
   GET REGISTERED FACE FROM GOOGLE SHEET
   ========================================================= */

function getRegisteredFace(
    initials
) {

    return jsonpRequest(
        "getface",
        {
            initials: initials
        }
    );

}


/* =========================================================
   REGISTER FACE ON GOOGLE APPS SCRIPT
   ========================================================= */

function registerFaceOnServer(
    initials,
    descriptor
) {

    return jsonpRequest(
        "enroll",
        {
            initials:
                initials,

            descriptor:
                JSON.stringify(
                    descriptor
                )
        }
    );

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


        /* =================================================
           OPTIONAL CLIENT-SIDE GEOFENCE
           ================================================= */

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


        /* =================================================
           SEND TO APPS SCRIPT

           Backend action = attendance
           ================================================= */

        setCameraStatus(
            "Location verified. Recording attendance..."
        );


        const serverResult =
            await jsonpRequest(
                "attendance",
                {

                    initials:
                        currentEmployee.initials,

                    lat:
                        latitude,

                    lng:
                        longitude

                }
            );


        if (
            !serverResult ||
            !serverResult.success
        ) {

            throw new Error(
                serverResult &&
                serverResult.message
                    ? serverResult.message
                    : "Attendance was not recorded."
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


    } catch (error) {

        console.error(
            "Attendance error:",
            error
        );


        showResult(
            "error",
            error && error.message
                ? escapeHtml(
                    error.message
                  )
                : "Face verified, but attendance could not be recorded."
        );


        setCameraStatus(
            "Attendance recording failed."
        );

    }

}


/* =========================================================
   GOOGLE APPS SCRIPT JSONP REQUEST

   IMPORTANT:

   We intentionally use JSONP instead of fetch().

   GitHub Pages and Google Apps Script are different
   origins. JSONP avoids the browser CORS problem.

   Your Apps Script backend already supports callback=...
   ========================================================= */

function jsonpRequest(
    action,
    params
) {

    return new Promise(
        function (
            resolve,
            reject
        ) {

            const callbackName =
                "fcplgCallback_" +
                Date.now() +
                "_" +
                Math.floor(
                    Math.random() * 100000
                );


            let finished = false;


            const script =
                document.createElement(
                    "script"
                );


            const timeout =
                setTimeout(
                    function () {

                        if (finished) {
                            return;
                        }


                        finished = true;


                        cleanup();


                        reject(
                            new Error(
                                "Google Apps Script request timed out."
                            )
                        );

                    },
                    20000
                );


            function cleanup() {

                clearTimeout(
                    timeout
                );


                try {

                    delete window[
                        callbackName
                    ];

                } catch (error) {

                    window[
                        callbackName
                    ] = undefined;

                }


                if (
                    script &&
                    script.parentNode
                ) {

                    script.parentNode.removeChild(
                        script
                    );

                }

            }


            window[
                callbackName
            ] =
                function (data) {

                    if (finished) {
                        return;
                    }


                    finished = true;


                    cleanup();


                    resolve(
                        data
                    );

                };


            const query =
                new URLSearchParams();


            query.set(
                "action",
                action
            );


            query.set(
                "callback",
                callbackName
            );


            if (params) {

                Object.keys(
                    params
                ).forEach(
                    function (key) {

                        const value =
                            params[key];


                        if (
                            value !== null &&
                            value !== undefined
                        ) {

                            query.set(
                                key,
                                String(value)
                            );

                        }

                    }
                );

            }


            script.src =
                CONFIG.GOOGLE_APPS_SCRIPT_URL +
                "?" +
                query.toString();


            script.async =
                true;


            script.onerror =
                function () {

                    if (finished) {
                        return;
                    }


                    finished = true;


                    cleanup();


                    reject(
                        new Error(
                            "Unable to connect to Google Apps Script."
                        )
                    );

                };


            document.body.appendChild(
                script
            );

        }
    );

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
            "Please allow camera access and reload the page."
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
                "Local saved face cleared."
            );

        },


    loadSavedFace:
        function () {

            if (!currentEmployee) {

                console.log(
                    "No employee selected."
                );

                return;

            }


            try {

                const saved =
                    localStorage.getItem(
                        "fcplg_face_" +
                        currentEmployee.initials
                    );


                if (saved) {

                    referenceDescriptor =
                        JSON.parse(
                            saved
                        );

                    console.log(
                        "Local backup face loaded."
                    );

                }

            } catch (error) {

                console.error(
                    "Unable to load local face backup.",
                    error
                );

            }

        },


    clearLocalFace:
        function () {

            if (!currentEmployee) {

                return;

            }


            localStorage.removeItem(
                "fcplg_face_" +
                currentEmployee.initials
            );


            referenceDescriptor =
                null;


            console.log(
                "Local face backup deleted."
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

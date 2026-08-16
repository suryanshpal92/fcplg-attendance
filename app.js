/* =========================================================
   FCPLG ATTENDANCE SYSTEM
   FRONTEND APPLICATION
   ========================================================= */

const CONFIG = {
    GOOGLE_APPS_SCRIPT_URL:
        "https://script.google.com/macros/s/AKfycbwX0scaFHFCJ8OdUYOZl3_IEhbJKHGTNYTm-Ih9piKOZc4CXIGYhHHguRjM_b16qYS2Vw/exec",

    FACE_MATCH_THRESHOLD: 0.52,

    CAMERA_WIDTH: 640,
    CAMERA_HEIGHT: 480,

    LOCATION_TIMEOUT: 15000
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
let referenceDescriptor = null;

let faceApiLoaded = false;
let modelsLoaded = false;
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
   START
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    if (!initialsInput || !continueBtn) {
        console.error("Required HTML elements are missing.");
        return;
    }

    continueBtn.addEventListener(
        "click",
        handleInitials
    );

    initialsInput.addEventListener(
        "keydown",
        event => {
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

    console.log(
        "FCPLG Attendance System loaded."
    );
});


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

    continueBtn.disabled = true;
    continueBtn.textContent = "CHECKING...";

    try {

        let employee = null;

        /* Try Google Apps Script first */

        try {

            employee =
                await lookupEmployeeFromServer(
                    initials
                );

        } catch (error) {

            console.warn(
                "Server lookup failed:",
                error
            );

        }

        /* Local fallback */

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

        currentEmployee = employee;

        displayEmployee(
            currentEmployee
        );

        setCameraStatus(
            "Checking registered face..."
        );

        referenceDescriptor =
            await getSavedFaceFromServer(
                currentEmployee.initials
            );

        await startVerificationStep();

    } catch (error) {

        console.error(
            "Initialisation error:",
            error
        );

        showResult(
            "error",
            error.message ||
            "Unable to start attendance verification."
        );

    } finally {

        continueBtn.disabled = false;
        continueBtn.textContent = "CONTINUE";

    }
}


/* =========================================================
   EMPLOYEE LOOKUP
   ========================================================= */

async function lookupEmployeeFromServer(
    initials
) {

    const url =
        CONFIG.GOOGLE_APPS_SCRIPT_URL +
        "?action=lookup&initials=" +
        encodeURIComponent(initials) +
        "&_=" +
        Date.now();

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
            "Employee lookup failed: HTTP " +
            response.status
        );
    }

    const data =
        await response.json();

    console.log(
        "Employee lookup:",
        data
    );

    if (!data.success) {
        return null;
    }

    return (
        data.employee ||
        data.data ||
        null
    );
}


/* =========================================================
   GET SAVED FACE
   ========================================================= */

async function getSavedFaceFromServer(
    initials
) {

    try {

        const url =
            CONFIG.GOOGLE_APPS_SCRIPT_URL +
            "?action=getface&initials=" +
            encodeURIComponent(initials) +
            "&_=" +
            Date.now();

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
                "Face lookup failed: HTTP " +
                response.status
            );
        }

        const data =
            await response.json();

        console.log(
            "Saved face response:",
            data
        );

        if (!data.success) {
            return null;
        }

        let descriptor =
            data.faceDescriptor ||
            data.descriptor ||
            data.face ||
            data.data;

        if (!descriptor) {
            return null;
        }

        if (typeof descriptor === "string") {

            try {

                descriptor =
                    JSON.parse(descriptor);

            } catch (error) {

                console.error(
                    "Could not parse face descriptor:",
                    error
                );

                return null;
            }
        }

        if (
            Array.isArray(descriptor) &&
            descriptor.length > 0
        ) {

            return descriptor;
        }

        return null;

    } catch (error) {

        console.warn(
            "No registered face found:",
            error
        );

        return null;
    }
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

    clearResult();

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
            "Unable to start camera."
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
        (resolve, reject) => {

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

            script.onload = () => {

                if (window.faceapi) {

                    faceApiLoaded = true;
                    resolve();

                } else {

                    reject(
                        new Error(
                            "Face recognition library unavailable."
                        )
                    );
                }
            };

            script.onerror = () => {

                reject(
                    new Error(
                        "Could not load face recognition library."
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
        .loadFromUri(MODEL_URL);

    await faceapi.nets.faceLandmark68Net
        .loadFromUri(MODEL_URL);

    await faceapi.nets.faceRecognitionNet
        .loadFromUri(MODEL_URL);

    modelsLoaded = true;

    console.log(
        "Face recognition models loaded."
    );
}


/* =========================================================
   CAMERA
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
            .getUserMedia({
                video: {
                    facingMode: "user",
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
            });

    video.srcObject =
        cameraStream;

    await new Promise(
        resolve => {

            video.onloadedmetadata =
                () => {

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
}


/* =========================================================
   VERIFY FACE
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

        const currentDescriptor =
            detection.descriptor;

        setCameraStatus(
            "Face detected. Checking identity..."
        );


        /* =================================================
           NO SAVED FACE
           REGISTER CURRENT FACE
           ================================================= */

        if (!referenceDescriptor) {

            setCameraStatus(
                "No registered face found. Registering this face..."
            );

            const registered =
                await enrollFaceOnServer(
                    currentDescriptor
                );

            if (registered) {

                referenceDescriptor =
                    Array.from(
                        currentDescriptor
                    );

                setCameraStatus(
                    "Face registration complete."
                );

                showResult(
                    "success",
                    "Face registered successfully for " +
                    escapeHtml(
                        currentEmployee.name
                    ) +
                    ". Please press VERIFY FACE again."
                );

                return;
            }

            throw new Error(
                "Face registration failed."
            );
        }


        /* =================================================
           COMPARE FACE
           ================================================= */

        const savedDescriptor =
            new Float32Array(
                referenceDescriptor
            );

        const distance =
            faceapi.euclideanDistance(
                currentDescriptor,
                savedDescriptor
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
                "Face verified. Checking location..."
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
            error.message ||
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
        new faceapi.TinyFaceDetectorOptions({
            inputSize: 320,
            scoreThreshold: 0.5
        });

    return await faceapi
        .detectSingleFace(
            video,
            options
        )
        .withFaceLandmarks()
        .withFaceDescriptor();
}


/* =========================================================
   FACE REGISTRATION
   ========================================================= */

async function enrollFaceOnServer(
    descriptor
) {

    if (!currentEmployee) {
        return false;
    }

    setCameraStatus(
        "Saving registered face..."
    );

    const payload = {
        action: "enroll",

        initials:
            currentEmployee.initials,

        name:
            currentEmployee.name,

        designation:
            currentEmployee.designation,

        department:
            currentEmployee.department,

        descriptor:
            Array.from(descriptor)
    };

    console.log(
        "Sending face registration..."
    );

    try {

        /*
         * IMPORTANT:
         * Use POST with text/plain.
         * This avoids the browser sending
         * a CORS preflight request.
         */

        const response =
            await fetch(
                CONFIG.GOOGLE_APPS_SCRIPT_URL,
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "text/plain;charset=utf-8"
                    },

                    body:
                        JSON.stringify(
                            payload
                        )
                }
            );

        if (!response.ok) {

            throw new Error(
                "Registration server HTTP " +
                response.status
            );
        }

        const text =
            await response.text();

        console.log(
            "Registration raw response:",
            text
        );

        let data;

        try {

            data =
                JSON.parse(text);

        } catch (error) {

            throw new Error(
                "Google Apps Script returned an invalid response."
            );
        }

        console.log(
            "Registration response:",
            data
        );

        if (
            data &&
            data.success === true
        ) {

            return true;
        }

        if (
            data &&
            data.status === "success"
        ) {

            return true;
        }

        throw new Error(
            data && data.message
                ? data.message
                : "Google Apps Script rejected face registration."
        );

    } catch (error) {

        console.error(
            "Face registration error:",
            error
        );

        showResult(
            "error",
            "Unable to register your face. " +
            (error.message || "")
        );

        return false;
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
            accuracy
        );

        setCameraStatus(
            "Location obtained. Recording attendance..."
        );

        await sendAttendanceToServer({
            initials:
                currentEmployee.initials,

            latitude:
                latitude,

            longitude:
                longitude,

            accuracy:
                accuracy
        });

    } catch (error) {

        console.error(
            "Attendance error:",
            error
        );

        setCameraStatus(
            "Attendance recording failed."
        );

        showResult(
            "error",
            error.message ||
            "Face verified, but attendance could not be recorded."
        );
    }
}


/* =========================================================
   GPS
   ========================================================= */

function getCurrentLocation() {

    return new Promise(
        (resolve, reject) => {

            if (!navigator.geolocation) {

                reject(
                    new Error(
                        "Geolocation is not supported on this device."
                    )
                );

                return;
            }

            navigator.geolocation.getCurrentPosition(
                resolve,

                error => {

                    let message =
                        "Unable to get your location.";

                    if (
                        error.code ===
                        error.PERMISSION_DENIED
                    ) {

                        message =
                            "Location permission was denied. Please allow location access and try again.";
                    }

                    if (
                        error.code ===
                        error.POSITION_UNAVAILABLE
                    ) {

                        message =
                            "Your location could not be determined. Please try again.";
                    }

                    if (
                        error.code ===
                        error.TIMEOUT
                    ) {

                        message =
                            "Location request timed out. Please try again.";
                    }

                    reject(
                        new Error(
                            message
                        )
                    );
                },

                {
                    enableHighAccuracy: true,
                    timeout:
                        CONFIG.LOCATION_TIMEOUT,
                    maximumAge: 0
                }
            );
        }
    );
}


/* =========================================================
   SEND ATTENDANCE
   ========================================================= */

async function sendAttendanceToServer(
    data
) {

    const url =
        CONFIG.GOOGLE_APPS_SCRIPT_URL +
        "?action=attendance" +
        "&initials=" +
        encodeURIComponent(
            data.initials
        ) +
        "&lat=" +
        encodeURIComponent(
            data.latitude
        ) +
        "&lng=" +
        encodeURIComponent(
            data.longitude
        ) +
        "&accuracy=" +
        encodeURIComponent(
            data.accuracy
        ) +
        "&_=" +
        Date.now();

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
            "Attendance server HTTP " +
            response.status
        );
    }

    const dataFromServer =
        await response.json();

    console.log(
        "Attendance response:",
        dataFromServer
    );

    if (!dataFromServer.success) {

        throw new Error(
            dataFromServer.message ||
            "Attendance was not recorded."
        );
    }

    setCameraStatus(
        "Attendance marked successfully."
    );

    showResult(
        "success",
        dataFromServer.message ||
        "Attendance marked successfully."
    );

    setTimeout(
        () => {
            stopCamera();
        },
        1000
    );
}


/* =========================================================
   STATUS
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
            track => track.stop()
        );

    cameraStream = null;

    if (video) {
        video.srcObject = null;
    }
}


/* =========================================================
   CAMERA ERROR
   ========================================================= */

function getFriendlyCameraError(
    error
) {

    if (!error) {
        return "Unable to access the camera.";
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
        () => currentEmployee,

    clearSavedFace:
        () => {
            referenceDescriptor = null;

            console.log(
                "Local face reference cleared."
            );
        },

    loadSavedFace:
        async () => {

            if (!currentEmployee) {

                console.log(
                    "Enter initials first."
                );

                return;
            }

            referenceDescriptor =
                await getSavedFaceFromServer(
                    currentEmployee.initials
                );

            console.log(
                "Saved face loaded:",
                referenceDescriptor
                    ? "YES"
                    : "NO"
            );
        },

    stopCamera:
        stopCamera
};


/* =========================================================
   CLEANUP
   ========================================================= */

window.addEventListener(
    "beforeunload",
    stopCamera
);

import { HandLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs";

const video = document.getElementById("webcam");
const canvasElement = document.getElementById("output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const gestureStatus = document.getElementById("gesture_status");
const virtualCursor = document.getElementById("virtual_cursor");
const cursorLabel = document.querySelector(".cursor-label");

let handLandmarker = undefined;
let runningMode = "VIDEO";
let lastVideoTime = -1;
let results = undefined;

// Smoothing variables
let currentCursorPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let targetCursorPos = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
const smoothingFactor = 0.5; // Increased for better responsiveness

// State management
let lastGesture = "NONE";

// 1. Initialize Hand Landmarker
const init = async () => {
    try {
        const vision = await FilesetResolver.forVisionTasks(
            "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
                delegate: "CPU" // Forced CPU for better mobile stability
            },
            runningMode: runningMode,
            numHands: 1
        });
        gestureStatus.innerText = "준비 완료 (손을 보여주세요)";
        startWebcam();
    } catch (error) {
        console.error("Initialization failed:", error);
        gestureStatus.innerText = "초기화 실패 (HTTPS 확인 필요)";
    }
};

// 2. Start Webcam with Mobile Constraints
const startWebcam = () => {
    const constraints = {
        video: {
            facingMode: "user", // Selfie camera for mobile
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then((stream) => {
            video.srcObject = stream;
            // Ensure video plays on mobile
            video.onloadedmetadata = () => {
                video.play();
                requestAnimationFrame(predictWebcam);
            };
        })
        .catch((err) => {
            console.error("Camera access denied:", err);
            gestureStatus.innerText = "카메라 접근 거부됨";
        });
};

// 3. Main Prediction Loop
const predictWebcam = async () => {
    // Canvas sizing to match window (Full screen)
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;

    if (!handLandmarker) {
        requestAnimationFrame(predictWebcam);
        return;
    }

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = handLandmarker.detectForVideo(video, performance.now());
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    const drawingUtils = new DrawingUtils(canvasCtx);

    if (results && results.landmarks && results.landmarks.length > 0) {
        const landmarks = results.landmarks[0];
        
        // Draw skeleton
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00f2ff", lineWidth: 3 });
        drawingUtils.drawLandmarks(landmarks, { color: "#ffffff", lineWidth: 1, radius: 2 });

        // Calculate Palm Center
        // We use average of Wrist(0) and 4 MCPs(5,9,13,17) for geometric palm center
        const palmX = (landmarks[0].x + landmarks[5].x + landmarks[9].x + landmarks[13].x + landmarks[17].x) / 5;
        const palmY = (landmarks[0].y + landmarks[5].y + landmarks[9].y + landmarks[13].y + landmarks[17].y) / 5;

        // Map to 1:1 overlay (mirrored X)
        targetCursorPos.x = (1 - palmX) * window.innerWidth;
        targetCursorPos.y = palmY * window.innerHeight;

        // Gesture Detection
        const thumbExtended = landmarks[4].y < landmarks[3].y;
        const indexExtended = landmarks[8].y < landmarks[6].y;
        const middleExtended = landmarks[12].y < landmarks[10].y;
        const ringExtended = landmarks[16].y < landmarks[14].y;
        const pinkyExtended = landmarks[20].y < landmarks[18].y;

        let currentGesture = "MOVE";
        if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            currentGesture = "LEFT_CLICK";
        } else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
            currentGesture = "MIDDLE_CLICK";
        } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
            currentGesture = "RIGHT_CLICK";
        }

        handleGesture(currentGesture);
    } else {
        gestureStatus.innerText = "손을 찾는 중...";
    }

    // Smooth movement
    currentCursorPos.x += (targetCursorPos.x - currentCursorPos.x) * smoothingFactor;
    currentCursorPos.y += (targetCursorPos.y - currentCursorPos.y) * smoothingFactor;

    virtualCursor.style.left = `${currentCursorPos.x}px`;
    virtualCursor.style.top = `${currentCursorPos.y}px`;

    canvasCtx.restore();
    requestAnimationFrame(predictWebcam);
};

const handleGesture = (gesture) => {
    if (gesture === lastGesture) return;

    virtualCursor.className = "";
    
    switch (gesture) {
        case "LEFT_CLICK":
            gestureStatus.innerText = "좌클릭 (주먹)";
            virtualCursor.classList.add("cursor-left");
            cursorLabel.innerText = "L-CLICK";
            dispatchClick("click");
            break;
        case "MIDDLE_CLICK":
            gestureStatus.innerText = "휠클릭 (검지)";
            virtualCursor.classList.add("cursor-middle");
            cursorLabel.innerText = "WHEEL";
            dispatchClick("auxclick", { button: 1 });
            break;
        case "RIGHT_CLICK":
            gestureStatus.innerText = "우클릭 (엄지)";
            virtualCursor.classList.add("cursor-right");
            cursorLabel.innerText = "R-CLICK";
            dispatchClick("contextmenu");
            break;
        default:
            gestureStatus.innerText = "이동 중 (보자기)";
            cursorLabel.innerText = "MOVE";
            break;
    }
    lastGesture = gesture;
};

const dispatchClick = (type, options = {}) => {
    const el = document.elementFromPoint(currentCursorPos.x, currentCursorPos.y);
    if (el) {
        const event = new MouseEvent(type, {
            view: window, bubbles: true, cancelable: true,
            clientX: currentCursorPos.x, clientY: currentCursorPos.y,
            ...options
        });
        el.dispatchEvent(event);
    }
};

// Window resize handling
window.addEventListener('resize', () => {
    canvasElement.width = window.innerWidth;
    canvasElement.height = window.innerHeight;
});

init();

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
const smoothingFactor = 0.2; // 0 to 1, lower is smoother but slower

// Click state management
let isClicking = false;
let lastGesture = "NONE";

// Initialize MediaPipe
const createHandLandmarker = async () => {
    const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/wasm"
    );
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: runningMode,
        numHands: 1
    });
    console.log("HandLandmarker loaded");
    startWebcam();
};

const startWebcam = () => {
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predictWebcam);
    });
};

const isFingerExtended = (landmarks, fingerIndexes) => {
    // fingerIndexes: [TIP, PIP, MCP]
    // Simple logic: If Tip is higher than PIP and MCP (in Y axis), it's extended
    // Note: Landmarks Y is 0 at top, 1 at bottom. So "higher" means "smaller Y value"
    const tip = landmarks[fingerIndexes[0]];
    const pip = landmarks[fingerIndexes[1]];
    const mcp = landmarks[fingerIndexes[2]];
    
    // For general fingers, tip Y should be less than PIP Y
    return tip.y < pip.y;
};

const predictWebcam = async () => {
    canvasElement.style.width = video.videoWidth;
    canvasElement.style.height = video.videoHeight;
    canvasElement.width = video.videoWidth;
    canvasElement.height = video.videoHeight;

    if (lastVideoTime !== video.currentTime) {
        lastVideoTime = video.currentTime;
        results = handLandmarker.detectForVideo(video, performance.now());
    }

    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    const drawingUtils = new DrawingUtils(canvasCtx);

    if (results && results.landmarks) {
        for (const landmarks of results.landmarks) {
            // Draw skeleton for feedback
            drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: "#00f2ff", lineWidth: 2 });
            drawingUtils.drawLandmarks(landmarks, { color: "#ffffff", lineWidth: 1, radius: 2 });

            // 1. Position Tracking (using Index Finger Base or MCP for stability)
            const mcp = landmarks[9]; // Middle finger MCP
            // Map 0-1 to window size (X is mirrored)
            targetCursorPos.x = (1 - mcp.x) * window.innerWidth;
            targetCursorPos.y = mcp.y * window.innerHeight;

            // 2. Gesture Detection
            const thumbExtended = landmarks[4].y < landmarks[3].y;
            const indexExtended = landmarks[8].y < landmarks[6].y;
            const middleExtended = landmarks[12].y < landmarks[10].y;
            const ringExtended = landmarks[16].y < landmarks[14].y;
            const pinkyExtended = landmarks[20].y < landmarks[18].y;

            let currentGesture = "MOVE";
            
            // Check for specific gestures
            if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
                // Fist (excluding thumb)
                currentGesture = "LEFT_CLICK";
            } else if (indexExtended && !middleExtended && !ringExtended && !pinkyExtended && !thumbExtended) {
                // Index only
                currentGesture = "MIDDLE_CLICK";
            } else if (thumbExtended && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
                // Thumb only
                currentGesture = "RIGHT_CLICK";
            } else {
                currentGesture = "MOVE";
            }

            updateUIAndEvents(currentGesture);
        }
    } else {
        gestureStatus.innerText = "손을 인식 중...";
        virtualCursor.className = "";
        cursorLabel.innerText = "Searching...";
    }

    // Smooth cursor movement
    currentCursorPos.x += (targetCursorPos.x - currentCursorPos.x) * smoothingFactor;
    currentCursorPos.y += (targetCursorPos.y - currentCursorPos.y) * smoothingFactor;
    
    virtualCursor.style.left = `${currentCursorPos.x}px`;
    virtualCursor.style.top = `${currentCursorPos.y}px`;

    canvasCtx.restore();
    window.requestAnimationFrame(predictWebcam);
};

const updateUIAndEvents = (gesture) => {
    if (gesture === lastGesture) return; // Prevent repeated events

    // Reset classes
    virtualCursor.className = "";
    
    switch (gesture) {
        case "LEFT_CLICK":
            gestureStatus.innerText = "제스처: 좌클릭 (주먹)";
            virtualCursor.classList.add("cursor-left");
            cursorLabel.innerText = "LEFT CLICK";
            dispatchEventAtCursor("click");
            break;
        case "MIDDLE_CLICK":
            gestureStatus.innerText = "제스처: 휠클릭 (검지)";
            virtualCursor.classList.add("cursor-middle");
            cursorLabel.innerText = "WHEEL CLICK";
            dispatchEventAtCursor("auxclick", { button: 1 });
            break;
        case "RIGHT_CLICK":
            gestureStatus.innerText = "제스처: 우클릭 (엄지)";
            virtualCursor.classList.add("cursor-right");
            cursorLabel.innerText = "RIGHT CLICK";
            dispatchEventAtCursor("contextmenu");
            break;
        default:
            gestureStatus.innerText = "제스처: 이동 (보자기)";
            cursorLabel.innerText = "MOVE";
            break;
    }
    
    lastGesture = gesture;
};

const dispatchEventAtCursor = (type, options = {}) => {
    const el = document.elementFromPoint(currentCursorPos.x, currentCursorPos.y);
    if (!el) return;

    console.log(`Dispatching ${type} on`, el);
    
    const event = new MouseEvent(type, {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: currentCursorPos.x,
        clientY: currentCursorPos.y,
        ...options
    });
    
    el.dispatchEvent(event);
    
    // For contextmenu, we usually want to prevent default if it's our own area
    if (type === "contextmenu") {
        // Handled by the button inline but could be added here
    }
};

createHandLandmarker();

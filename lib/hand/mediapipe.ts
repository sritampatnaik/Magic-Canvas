import { FilesetResolver, HandLandmarker, GestureRecognizer } from "@mediapipe/tasks-vision";

export async function createHandDetector() {
	const fileset = await FilesetResolver.forVisionTasks(
		"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
	);
	const landmarker = await HandLandmarker.createFromOptions(fileset, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
		},
		runningMode: "VIDEO",
		numHands: 1,
	});
	return landmarker;
}

export async function createGestureRecognizer() {
	const fileset = await FilesetResolver.forVisionTasks(
		"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
	);
	const recognizer = await GestureRecognizer.createFromOptions(fileset, {
		baseOptions: {
			modelAssetPath:
				"https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
		},
		runningMode: "VIDEO",
		numHands: 1,
	});
	return recognizer;
}



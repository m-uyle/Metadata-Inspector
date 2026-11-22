import { runEngineTask } from "../dispatcher.js";

let engineWorker = null;
let engineJob = 0;
const engineWaiting = new Map();

function getEngineWorker() {
  if (engineWorker) return engineWorker;
  engineWorker = new Worker(new URL("./engine.worker.js", import.meta.url), {
    type: "module",
  });
  engineWorker.onmessage = (e) => {
    const w = engineWaiting.get(e.data.id);
    if (!w) return;
    engineWaiting.delete(e.data.id);
    if (e.data.error) w.reject(new Error(e.data.error));
    else w.resolve(e.data.result);
  };
  engineWorker.onerror = () => {
    for (const w of engineWaiting.values()) {
      w.reject(new Error("Worker failed"));
    }
    engineWaiting.clear();
    if (engineWorker) {
      engineWorker.terminate();
      engineWorker = null;
    }
  };
  return engineWorker;
}

export async function processAsync(buffer, name, options = {}) {
  if (typeof Worker === "undefined") {
    return runEngineTask(buffer, name, options);
  }
  let worker;
  try {
    worker = getEngineWorker();
  } catch {
    return runEngineTask(buffer, name, options);
  }
  const id = ++engineJob;
  return await new Promise((resolve, reject) => {
    engineWaiting.set(id, { resolve, reject });
    worker.postMessage({ id, buffer, name, options }, [buffer]);
  });
}

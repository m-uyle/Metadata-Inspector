import { runEngineTask } from "../dispatcher.js";

self.onmessage = (e) => {
  const { id, buffer, name, options } = e.data;
  try {
    const result = runEngineTask(buffer, name, options);
    const transfers = [];
    if (result.cleanedBytes?.buffer) {
      transfers.push(result.cleanedBytes.buffer);
    }
    if (
      result.thumbnailBytes?.buffer &&
      !transfers.includes(result.thumbnailBytes.buffer)
    ) {
      transfers.push(result.thumbnailBytes.buffer);
    }
    self.postMessage({ id, result }, transfers);
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};

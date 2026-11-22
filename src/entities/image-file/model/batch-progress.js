export const batch = {
  cancel: false,
  active: false,
  label: "",
  total: 0,
  done: 0,
};

const batchListeners = new Set();

function notifyBatch() {
  for (const fn of batchListeners) {
    fn(batch);
  }
}

export function subscribeBatch(fn) {
  batchListeners.add(fn);
  return () => batchListeners.delete(fn);
}

export function batchStart(label, total) {
  batch.active = true;
  batch.cancel = false;
  batch.label = label;
  batch.total = total;
  batch.done = 0;
  notifyBatch();
}

export function batchTick(done) {
  batch.done = done;
  notifyBatch();
}

export function batchRequestCancel() {
  batch.cancel = true;
  notifyBatch();
}

export function batchEnd() {
  batch.active = false;
  notifyBatch();
}

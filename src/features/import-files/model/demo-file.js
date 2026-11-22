import {
  buildCustomExifApp1,
  concatUint8Arrays,
} from "../../../shared/lib/index.js";

export async function createSyntheticDemoFile() {
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#efeeec";
  ctx.fillRect(0, 0, 1280, 800);
  ctx.strokeStyle = "#181817";
  ctx.lineWidth = 24;
  ctx.strokeRect(48, 48, 1184, 704);
  ctx.fillStyle = "#181817";
  ctx.font = "400 28px Geist, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("METADATA INSPECTOR // CLEAN & EDIT DEMO", 640, 390);
  ctx.font = "400 18px Geist, sans-serif";
  ctx.fillText(
    "JPEG • PNG / APNG • WEBP • GIF • EXIF • GPS • THUMBNAIL",
    640,
    430
  );

  const mainBlob = await new Promise((res) =>
    canvas.toBlob(res, "image/jpeg", 0.92)
  );
  const rawJpeg = new Uint8Array(await mainBlob.arrayBuffer());

  const tCanvas = document.createElement("canvas");
  tCanvas.width = 160;
  tCanvas.height = 100;
  const tCtx = tCanvas.getContext("2d");
  tCtx.fillStyle = "#efeeec";
  tCtx.fillRect(0, 0, 160, 100);
  tCtx.strokeStyle = "#181817";
  tCtx.lineWidth = 4;
  tCtx.strokeRect(10, 10, 140, 80);
  const thumbBlob = await new Promise((res) =>
    tCanvas.toBlob(res, "image/jpeg", 0.85)
  );
  const thumbBytes = new Uint8Array(await thumbBlob.arrayBuffer());

  const demoTags = [
    { id: "0x010F", value: "Apple" },
    { id: "0x0110", value: "iPhone 16 Pro Max" },
    { id: "0x0131", value: "Adobe Photoshop Lightroom Classic 14.0" },
    { id: "0x0132", value: "2026:10:24 15:30:12" },
    { id: "0x013C", value: "MacBookPro18,3 macOS 15.1" },
    { id: "0x013B", value: "Alex Lab" },
    { id: "0x9003", value: "2026:10:24 15:30:12" },
    { id: "0x9290", value: "842" },
    { id: "0xA431", value: "SN-APPL-99281-Z" },
    { id: "GPS:LOC", value: "60.170833, 24.938444" },
  ];
  const app1Segment = buildCustomExifApp1(demoTags, 6, thumbBytes);
  return new File(
    [
      concatUint8Arrays([
        rawJpeg.subarray(0, 2),
        app1Segment,
        rawJpeg.subarray(2),
      ]),
    ],
    "SAMPLE_DEMO.JPG",
    { type: "image/jpeg" }
  );
}

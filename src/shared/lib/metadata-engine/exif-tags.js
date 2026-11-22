export const ORIENTATION_TAG_ID = "0x0112";
export const CORE_GPS_IDS = new Set(["0x0001", "0x0002", "0x0003", "0x0004"]);

export const EXIF_TAGS = {};
for (const [id, label, cat, priv, ifd, type] of [
  [0x010e, "Image Description", "Description", 0, "IFD0", 2],
  [0x010f, "Camera Make", "Hardware", 1, "IFD0", 2],
  [0x0110, "Camera Model", "Hardware", 1, "IFD0", 2],
  [0x0112, "Orientation Tag", "Hardware", 0, "IFD0", 3],
  [0x0131, "Software / Firmware", "Software", 1, "IFD0", 2],
  [0x0132, "Modify Date", "Timestamp", 1, "IFD0", 2],
  [0x013b, "Artist / Author", "Identity", 1, "IFD0", 2],
  [0x013c, "Host Computer", "Environment", 1, "IFD0", 2],
  [0x8298, "Copyright Notice", "Identity", 0, "IFD0", 2],
  [0x829a, "Exposure Time", "Optics", 0, "EXIF", 5],
  [0x829d, "F-Number", "Optics", 0, "EXIF", 5],
  [0x8827, "ISO Speed Ratings", "Optics", 0, "EXIF", 3],
  [0x9003, "Date/Time Original", "Timestamp", 1, "EXIF", 2],
  [0x9004, "Create Date", "Timestamp", 1, "EXIF", 2],
  [0x9010, "Offset Time", "Timestamp", 1, "EXIF", 2],
  [0x9011, "Offset Time Original", "Timestamp", 1, "EXIF", 2],
  [0x920a, "Focal Length", "Optics", 0, "EXIF", 5],
  [0x927c, "MakerNote Block", "Hardware", 1, "EXIF", 7],
  [0x9286, "User Comment", "Description", 1, "EXIF", 7],
  [0x9290, "Sub-second Time", "Timestamp", 1, "EXIF", 2],
  [0xa404, "Digital Zoom Ratio", "Optics", 0, "EXIF", 5],
  [0xa405, "Focal Length (35mm)", "Optics", 0, "EXIF", 3],
  [0xa420, "Unique Image ID", "Identity", 1, "EXIF", 2],
  [0xa430, "Owner Name", "Identity", 1, "EXIF", 2],
  [0xa431, "Body Serial Number", "Hardware", 1, "EXIF", 2],
  [0xa432, "Lens Specification", "Optics", 0, "EXIF", 5],
  [0xa433, "Lens Make", "Hardware", 1, "EXIF", 2],
  [0xa434, "Lens Model", "Hardware", 1, "EXIF", 2],
  [0xa435, "Lens Serial Number", "Hardware", 1, "EXIF", 2],
  [0x9c9b, "Windows XP Title", "Description", 1, "IFD0", 1],
  [0x9c9c, "Windows XP Comment", "Description", 1, "IFD0", 1],
  [0x9c9d, "Windows XP Author", "Identity", 1, "IFD0", 1],
  [0x9c9e, "Windows XP Keywords", "Description", 1, "IFD0", 1],
  [0x9c9f, "Windows XP Subject", "Description", 1, "IFD0", 1],
  [0x8649, "Photoshop Resources (IPTC/XMP)", "Identity", 1, "IFD0", 1],
  [0xc614, "Unique Camera Model (DNG)", "Hardware", 1, "IFD0", 2],
  [0xc615, "Localized Camera Model", "Hardware", 1, "IFD0", 2],
  [0xc62f, "Camera Serial Number (DNG)", "Hardware", 1, "IFD0", 2],
  [0xc630, "Lens Info (DNG)", "Optics", 0, "IFD0", 5],
]) {
  EXIF_TAGS[id] = { label, cat, privacy: !!priv, ifd, type };
}

export const GPS_TAGS = {};
for (const [id, label, type] of [
  [0x0001, "Latitude Reference (N/S)", 2],
  [0x0002, "Latitude Coordinates", 5],
  [0x0003, "Longitude Reference (E/W)", 2],
  [0x0004, "Longitude Coordinates", 5],
  [0x0005, "Altitude Reference", 1],
  [0x0006, "Altitude (Meters)", 5],
  [0x0007, "UTC GPS TimeStamp", 5],
  [0x0011, "Camera Azimuth / Bearing", 5],
  [0x001d, "GPS Date Stamp", 2],
]) {
  GPS_TAGS[id] = { label, cat: "Geolocation", privacy: true, type };
}

export const TIFF_IMAGE_STRUCT_TAGS = new Set([
  0x00fe, 0x00ff, 0x0100, 0x0101, 0x0102, 0x0103, 0x0106, 0x010a, 0x0111,
  0x0112, 0x0115, 0x0116, 0x0117, 0x011a, 0x011b, 0x011c, 0x0128, 0x013d,
  0x0140, 0x0142, 0x0143, 0x0144, 0x0145, 0x014a, 0x0152, 0x0153, 0x0201,
  0x0202, 0x0211, 0x0212, 0x0213, 0x0214, 0x828d, 0x828e, 0x8773, 0xc612,
  0xc613, 0xc616, 0xc617, 0xc618, 0xc619, 0xc61a, 0xc61d, 0xc61e, 0xc61f,
  0xc620, 0xc621, 0xc622, 0xc623, 0xc624, 0xc625, 0xc626, 0xc627, 0xc628,
  0xc629, 0xc62a, 0xc62b, 0xc62c, 0xc62d, 0xc62e, 0xc634, 0xc68d, 0xc68e,
  0xc740, 0xc741, 0xc74e, 0xc5d8, 0xc5e0,
]);

export const EXIF_SUBIFD_IDS = new Set([
  0x829a, 0x829d, 0x8822, 0x8827, 0x9000, 0x9003, 0x9004, 0x9010, 0x9011,
  0x9012, 0x9101, 0x9102, 0x9201, 0x9202, 0x9203, 0x9204, 0x9205, 0x9206,
  0x9207, 0x9208, 0x9209, 0x920a, 0x927c, 0x9286, 0x9290, 0x9291, 0x9292,
  0xa000, 0xa001, 0xa002, 0xa003, 0xa401, 0xa402, 0xa403, 0xa404, 0xa405,
  0xa406, 0xa420, 0xa430, 0xa431, 0xa432, 0xa433, 0xa434, 0xa435,
]);

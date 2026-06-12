/**
 * Classify extracted PDF images: 3D primary shots, supportive photos, or text-only pages.
 */

const THREE_D_PATTERNS =
  /\b3[\s-]?d\b|360|panorama|pano\b|virtual tour|matterport|immersive|wide[\s-]?angle room|spherical|cubic photo/i;

const TEXT_ONLY_PAGE_PATTERNS =
  /tenant signature|landlord signature|disclaimer|terms and conditions|acknowledgment|table of contents|signature page|please sign|agreement only/i;

const MIN_ROOM_PHOTO_PIXELS = 200 * 200;

export const PHOTO_ROLE = {
  PRIMARY: "primary",
  SUPPORTIVE: "supportive",
  REFERENCE: "reference",
};

/**
 * @param {string} pageText
 * @param {string} fileName
 */
export function is3DPhoto(pageText, fileName = "") {
  return THREE_D_PATTERNS.test(`${pageText}\n${fileName}`);
}

/**
 * Pages that are mostly writing — skip for comparison (still used for date parsing).
 * @param {string} pageText
 * @param {Array<{width?: number, height?: number}>} pagePhotos
 */
export function isTextOnlyPage(pageText, pagePhotos = []) {
  if (!pagePhotos.length) {
    return true;
  }

  const textChars = pageText.replace(/\s+/g, "").length;
  const photoAreas = pagePhotos.map((photo) => (photo.width || 0) * (photo.height || 0));
  const maxArea = Math.max(...photoAreas, 0);
  const totalArea = photoAreas.reduce((sum, area) => sum + area, 0);

  if (TEXT_ONLY_PAGE_PATTERNS.test(pageText) && maxArea < MIN_ROOM_PHOTO_PIXELS * 4) {
    return true;
  }

  if (textChars > 400 && maxArea < MIN_ROOM_PHOTO_PIXELS * 2) {
    return true;
  }

  if (textChars > 700 && totalArea < MIN_ROOM_PHOTO_PIXELS * 6 && !is3DPhoto(pageText)) {
    return true;
  }

  return false;
}

/**
 * @param {string} pageText
 * @param {string} fileName
 * @param {number} width
 * @param {number} height
 */
export function classifyPhotoRole(pageText, fileName, width, height) {
  const area = (width || 0) * (height || 0);

  if (is3DPhoto(pageText, fileName)) {
    return PHOTO_ROLE.PRIMARY;
  }

  if (area >= MIN_ROOM_PHOTO_PIXELS * 2) {
    return PHOTO_ROLE.SUPPORTIVE;
  }

  return PHOTO_ROLE.REFERENCE;
}

export function roleLabel(role) {
  if (role === PHOTO_ROLE.PRIMARY) {
    return "3D (compared)";
  }
  if (role === PHOTO_ROLE.SUPPORTIVE) {
    return "Support photo";
  }
  return "Reference";
}

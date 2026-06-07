import multer from "multer";

/**
 * Shared multer config for agent bundle ZIP uploads. Bundles are small (prompts
 * plus a few markdown/TS files), so memory storage avoids temp-file cleanup and
 * the buffer can be handed straight to the installer/marketplace store. Used by
 * both session creation (`config` field) and the marketplace (`bundle` field).
 */
export const bundleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

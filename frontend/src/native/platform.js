/**
 * Native (Android app) integration. The Android app is the same React build wrapped by Capacitor; on the
 * web every function here is a no-op, so the website is unaffected.
 */
import { Capacitor } from '@capacitor/core';

export const isNativeApp = Capacitor.isNativePlatform();

/** Hardware back button: go back through the app's pages; on the first page, close the app. */
export async function initNativeApp() {
  if (!isNativeApp) return;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.history.length > 1) window.history.back();
    else App.exitApp();
  });
}

/**
 * Saves a generated file. Browsers download it; inside the Android app (a WebView cannot download blobs)
 * it is written to the app's cache and handed to Android's share sheet: Save to Files, Drive, WhatsApp, email...
 */
export async function saveGeneratedFile({ filename, base64, mimeType, fallback }) {
  if (!isNativeApp) return fallback();
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/share')]);
  const { uri } = await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
  return Share.share({ title: filename, url: uri, dialogTitle: `Save or share ${mimeType === 'application/pdf' ? 'the PDF' : 'the file'}` });
}

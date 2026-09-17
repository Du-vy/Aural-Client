import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "src-tauri/gen/android/app/src/main/AndroidManifest.xml");

if (!existsSync(manifestPath)) {
  console.error(`AndroidManifest.xml not found at ${manifestPath}`);
  process.exit(1);
}

let content = readFileSync(manifestPath, "utf-8");

const permissions = `
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />
`;

if (!content.includes("android.permission.RECORD_AUDIO")) {
  if (content.includes("<application")) {
    content = content.replace("<application", `${permissions}\n    <application`);
    writeFileSync(manifestPath, content, "utf-8");
    console.log("Successfully injected WebRTC & audio permissions into AndroidManifest.xml");
  } else {
    console.warn("Could not find <application> tag to inject permissions");
  }
} else {
  console.log("Audio permissions already present in AndroidManifest.xml");
}

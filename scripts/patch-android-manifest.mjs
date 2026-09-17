import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "src-tauri/gen/android/app/src/main/AndroidManifest.xml");
const buildGradlePath = resolve(process.cwd(), "src-tauri/gen/android/app/build.gradle.kts");

if (!existsSync(manifestPath)) {
  console.error(`AndroidManifest.xml not found at ${manifestPath}`);
  process.exit(1);
}

let content = readFileSync(manifestPath, "utf-8");

const permissions = `
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.RECORD_AUDIO" />
    <uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-feature android:name="android.hardware.microphone" android:required="false" />
`;

if (!content.includes("android.permission.RECORD_AUDIO")) {
  if (content.includes("<application")) {
    content = content.replace("<application", `${permissions}\n    <application`);
    console.log("Successfully injected WebRTC & audio permissions into AndroidManifest.xml");
  }
}

// 1. Ensure usesCleartextTraffic is true (replace placeholder without creating duplicate attributes)
if (content.includes("${usesCleartextTraffic}")) {
  content = content.replace("${usesCleartextTraffic}", "true");
  console.log("Replaced ${usesCleartextTraffic} with true in AndroidManifest.xml");
} else if (content.includes('android:usesCleartextTraffic="false"')) {
  content = content.replace('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"');
  console.log("Updated android:usesCleartextTraffic to true in AndroidManifest.xml");
} else if (!content.includes("android:usesCleartextTraffic=")) {
  content = content.replace("<application", '<application\n        android:usesCleartextTraffic="true"');
  console.log('Added android:usesCleartextTraffic="true" to <application>');
}

// 2. Add networkSecurityConfig to <application> if not present
if (!content.includes("android:networkSecurityConfig=")) {
  content = content.replace("<application", '<application\n        android:networkSecurityConfig="@xml/network_security_config"');
  console.log("Added android:networkSecurityConfig to <application>");
}

writeFileSync(manifestPath, content, "utf-8");

// 3. In build.gradle.kts, ensure usesCleartextTraffic is true
if (existsSync(buildGradlePath)) {
  let gradle = readFileSync(buildGradlePath, "utf-8");
  let modified = false;
  if (gradle.includes('"usesCleartextTraffic", "false"')) {
    gradle = gradle.replaceAll('"usesCleartextTraffic", "false"', '"usesCleartextTraffic", "true"');
    modified = true;
  }
  if (gradle.includes('["usesCleartextTraffic"] = "false"')) {
    gradle = gradle.replaceAll('["usesCleartextTraffic"] = "false"', '["usesCleartextTraffic"] = "true"');
    modified = true;
  }
  if (modified) {
    writeFileSync(buildGradlePath, gradle, "utf-8");
    console.log("Updated usesCleartextTraffic to true in build.gradle.kts");
  }
}

// src/device.ts
import { existsSync } from "fs";

// === Detect if running on Termux/Android ===
export function isTermux(): boolean {
    return existsSync("/data/data/com.termux") ||
           !!process.env.TERMUX_VERSION ||
           process.platform === "android";
}

// === Comprehensive App Registry (Deep Links) ===
export const APP_REGISTRY: Record<string, { android: string; ios: string; web: string; package?: string }> = {
    whatsapp:    { android: "whatsapp://",         ios: "whatsapp://",         web: "https://wa.me/",                package: "com.whatsapp" },
    telegram:    { android: "tg://",               ios: "tg://",               web: "https://t.me/",                 package: "org.telegram.messenger" },
    gmail:       { android: "gmail://",            ios: "googlegmail://",      web: "https://mail.google.com",       package: "com.google.android.gm" },
    youtube:     { android: "vnd.youtube://",      ios: "vnd.youtube://",      web: "https://youtube.com",           package: "com.google.android.youtube" },
    maps:        { android: "geo:0,0",             ios: "maps://",             web: "https://maps.google.com",       package: "com.google.android.apps.maps" },
    chrome:      { android: "googlechrome://",     ios: "googlechrome://",     web: "https://google.com",            package: "com.android.chrome" },
    instagram:   { android: "instagram://",        ios: "instagram://",        web: "https://instagram.com",         package: "com.instagram.android" },
    twitter:     { android: "twitter://",          ios: "twitter://",          web: "https://twitter.com",           package: "com.twitter.android" },
    facebook:    { android: "fb://",               ios: "fb://",               web: "https://facebook.com",          package: "com.facebook.katana" },
    spotify:     { android: "spotify:",            ios: "spotify:",            web: "https://open.spotify.com",      package: "com.spotify.music" },
    tiktok:      { android: "snssdk1128://",       ios: "snssdk1128://",       web: "https://tiktok.com",            package: "com.zhiliaoapp.musically" },
    netflix:     { android: "netflix://",          ios: "netflix://",          web: "https://netflix.com",           package: "com.netflix.mediaclient" },
    camera:      { android: "intent:#Intent;action=android.media.action.IMAGE_CAPTURE;end", ios: "", web: "" },
    dialer:      { android: "tel:",                ios: "tel:",                web: "" },
    sms:         { android: "sms:",                ios: "sms:",                web: "" },
    settings:    { android: "app-settings:",       ios: "App-Prefs:",          web: "" },
    calendar:    { android: "content://com.android.calendar", ios: "calshow:", web: "" },
    photos:      { android: "content://media/internal/images/media", ios: "photos-redirect://", web: "" },
    files:       { android: "content://com.android.externalstorage.documents", ios: "shareddocuments://", web: "" },
};

// === Launch an app directly on Termux via Android's `am start` ===
export async function launchOnTermux(appName: string, extra: string = ""): Promise<string> {
    const key = appName.toLowerCase();
    const app = APP_REGISTRY[key];

    // Case 1: Known app → use deep link
    if (app?.android) {
        const uri = app.android + extra;
        const proc = Bun.spawn(
            ["am", "start", "-a", "android.intent.action.VIEW", "-d", uri],
            { stdout: "pipe", stderr: "pipe" }
        );
        const err = await new Response(proc.stderr).text();
        await proc.exited;
        if (err.toLowerCase().includes("no activity found")) {
            throw new Error(`No app on device can handle "${appName}"`);
        }
        return `✅ Launched ${appName} on your device.`;
    }

    // Case 2: Treat input as Android package name (e.g., com.whatsapp)
    if (appName.includes(".")) {
        const proc = Bun.spawn(
            ["monkey", "-p", appName, "-c", "android.intent.category.LAUNCHER", "1"],
            { stdout: "pipe", stderr: "pipe" }
        );
        const output = await new Response(proc.stderr).text();
        await proc.exited;
        if (output.includes("no activities") || output.includes("Error")) {
            throw new Error(`Package "${appName}" not found on device.`);
        }
        return `✅ Launched package ${appName}.`;
    }

    throw new Error(`Unknown app "${appName}". Provide a known name or Android package name.`);
}

// === List installed third-party apps on Termux ===
export async function listInstalledApps(): Promise<string[]> {
    const proc = Bun.spawn(["pm", "list", "packages", "-3"], { stdout: "pipe" });
    const out = await new Response(proc.stdout).text();
    return out
        .split("\n")
        .map(line => line.replace("package:", "").trim())
        .filter(Boolean)
        .sort();
}

// === Get the list of known app names ===
export function getKnownApps(): string[] {
    return Object.keys(APP_REGISTRY);
}

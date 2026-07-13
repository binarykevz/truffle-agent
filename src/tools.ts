import { Context } from "grammy";
import * as cheerio from "cheerio";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { getConfig } from "./db";
import {
    isTermux,
    launchOnTermux,
    listInstalledApps,
    getKnownApps,
    APP_REGISTRY,
} from "./device";

export interface Tool {
    name: string;
    description: string;
    parameters: Record<string, any>;
    execute: (args: any, ctx: Context) => Promise<any>;
}

const WORKSPACE = "/tmp/bot_workspace";

export const tools: Tool[] = [
    {
        name: "web_crawl",
        description: "Crawl a URL and extract its main text content. Useful for research.",
        parameters: {
            type: "object",
            properties: { url: { type: "string", description: "The URL to crawl" } },
            required: ["url"],
        },
        execute: async ({ url }) => {
            const res = await fetch(url, { headers: { "User-Agent": "AgenticBot/1.0" } });
            const html = await res.text();
            const $ = cheerio.load(html);
            $("script, style, nav, footer").remove();
            return $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);
        },
    },
    {
        name: "generate_and_deploy_program",
        description:
            "Generate a TypeScript program based on a prompt, save it to the VPS, and execute/deploy it.",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the program to create" },
                type: { type: "string", enum: ["script", "web_server"], default: "script" },
            },
            required: ["prompt"],
        },
        execute: async ({ prompt, type = "script" }) => {
            await mkdir(WORKSPACE, { recursive: true });
            const fileName = `program_${Date.now()}.ts`;
            const filePath = join(WORKSPACE, fileName);

            const apiKey = await getConfig("api_key");
            const baseUrl = await getConfig("base_url");
            const model = (await getConfig("model")) || "qwen-max";

            const codeRes = await fetch(`${baseUrl!.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages: [
                        {
                            role: "system",
                            content: "Write clean, runnable TypeScript code. Return ONLY the code, no markdown fences, no explanation.",
                        },
                        { role: "user", content: prompt },
                    ],
                    temperature: 0.1,
                }),
            });
            const code = ((await codeRes.json()) as any).choices[0].message.content.trim();
            await writeFile(filePath, code);

            if (type === "web_server") {
                const proc = Bun.spawn(["bun", "run", filePath], {
                    stdout: "ignore",
                    stderr: "ignore",
                    detached: true,
                });
                proc.unref();
                return `Deployed web server. File: ${fileName}. Running in background.`;
            } else {
                const proc = Bun.spawn(["bun", "run", filePath], { timeout: 15000 });
                const output = await new Response(proc.stdout).text();
                return `Executed ${fileName}. Output:\n${output}`;
            }
        },
    },
        {
        name: "openclaw_action",
        description:
            "Send a message to the OpenClaw agent. Use this to ask questions, trigger actions, or interact with the OpenClaw system. Returns the response from OpenClaw.",
        parameters: {
            type: "object",
            properties: {
                message: {
                    type: "string",
                    description: "The message or question to send to the OpenClaw agent",
                },
                session: {
                    type: "string",
                    description: "The OpenClaw session to use (default: 'agent:main:main')",
                },
            },
            required: ["message"],
        },
        execute: async ({ message, session = "agent:main:main" }, ctx) => {
            const openclawUrl =
                (await getConfig("openclaw_url")) || "http://127.0.0.1:18789/hooks/agent";
            const openclawToken = await getConfig("openclaw_token");

            if (!openclawToken) {
                return "❌ OpenClaw token not configured. Owner must run: /setconfig openclaw_token <token>";
            }

            try {
                const response = await fetch(openclawUrl, {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${openclawToken}`,
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        message: message,
                        session: session,
                        name: "telegram",
                        user: String(ctx.from?.id || "unknown"),
                    }),
                });

                if (!response.ok) {
                    return `❌ OpenClaw request failed: ${response.status} ${response.statusText}`;
                }

                const data = await response.json();
                
                // OpenClaw might return various structures. Stringify it cleanly for the LLM.
                if (typeof data === "string") return data;
                return JSON.stringify(data, null, 2).slice(0, 4000);
            } catch (err: any) {
                return `❌ OpenClaw request failed: ${err.message}. Is OpenClaw running on ${openclawUrl}?`;
            }
        },
    },
    {
        name: "open_app",
        description: `Open an application on the user's device. Accepts a known app name (${getKnownApps().join(", ")}) OR an Android package name (e.g., com.whatsapp). On Termux, launches directly. On VPS, sends a clickable inline button.`,
        parameters: {
            type: "object",
            properties: {
                app: { type: "string", description: "App name or Android package name" },
                extra: { type: "string", description: "Optional extra data (phone number, URL, etc.)" },
            },
            required: ["app"],
        },
        execute: async ({ app, extra = "" }, ctx) => {
            if (isTermux()) {
                return await launchOnTermux(app, extra);
            }
            const key = app.toLowerCase();
            const known = APP_REGISTRY[key];
            const url = known ? known.web + extra : extra;
            if (!url) {
                return `❌ Cannot open "${app}" remotely. Provide a URL or run the bot on Termux.`;
            }
            await ctx.reply(`🚀 Tap to open ${app}:`, {
                reply_markup: {
                    inline_keyboard: [[{ text: `Open ${app}`, url }]],
                },
            });
            return `Sent button to open ${app}.`;
        },
    },
    {
        name: "list_installed_apps",
        description: "List all third-party apps installed on the device. Only works when the bot runs on Termux/Android.",
        parameters: { type: "object", properties: {} },
        execute: async () => {
            if (!isTermux()) {
                return "❌ This tool only works when the bot runs on Termux/Android.";
            }
            const apps = await listInstalledApps();
            if (apps.length === 0) return "No third-party apps found.";
            const preview = apps.slice(0, 100).join("\n");
            return `Installed apps (${apps.length} total, showing first 100):\n${preview}`;
        },
    },
    {
        name: "open_url",
        description: "Open any URL or deep link on the user's device. The OS will route it to the appropriate app.",
        parameters: {
            type: "object",
            properties: { url: { type: "string", description: "The URL or deep link to open" } },
            required: ["url"],
        },
        execute: async ({ url }, ctx) => {
            if (isTermux()) {
                const proc = Bun.spawn(
                    ["am", "start", "-a", "android.intent.action.VIEW", "-d", url],
                    { stdout: "pipe", stderr: "pipe" }
                );
                await proc.exited;
                return `✅ Opened ${url} on device.`;
            }
            await ctx.reply(`🔗 Tap to open:`, {
                reply_markup: { inline_keyboard: [[{ text: "Open Link", url }]] },
            });
            return `Sent link button.`;
        },
    },
];

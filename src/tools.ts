import { Context } from "grammy";
import * as cheerio from "cheerio";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

// Interface for our tools
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
            required: ["url"]
        },
        execute: async ({ url }) => {
            const res = await fetch(url, { headers: { "User-Agent": "AgenticBot/1.0" } });
            const html = await res.text();
            const $ = cheerio.load(html);
            $("script, style, nav, footer").remove();
            return $("body").text().replace(/\s+/g, " ").trim().slice(0, 4000);
        }
    },
    {
        name: "generate_and_deploy_program",
        description: "Generate a script or web app based on a prompt, save it to the VPS, and execute/deploy it.",
        parameters: {
            type: "object",
            properties: {
                prompt: { type: "string", description: "Description of the program to create" },
                type: { type: "string", enum: ["script", "web_server"], default: "script" }
            },
            required: ["prompt"]
        },
        execute: async ({ prompt, type = "script" }) => {
            await mkdir(WORKSPACE, { recursive: true });
            const fileName = `program_${Date.now()}.ts`;
            const filePath = join(WORKSPACE, fileName);

            // Ask LLM to generate code
            const codeRes = await fetch(`${process.env.DASHSCOPE_BASE_URL}/chat/completions`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}` },
                body: JSON.stringify({
                    model: process.env.MODEL,
                    messages: [
                        { role: "system", content: "Write clean, runnable TypeScript code. Return ONLY the code, no markdown." },
                        { role: "user", content: prompt }
                    ]
                })
            });
            const code = (await codeRes.json() as any).choices[0].message.content.trim();
            await writeFile(filePath, code);

            if (type === "web_server") {
                // Start in background
                const proc = Bun.spawn(["bun", "run", filePath], { stdout: "ignore", stderr: "ignore", detached: true });
                proc.unref();
                return `Deployed web server. File: ${fileName}. It is running in the background.`;
            } else {
                // Execute script and capture output
                const proc = Bun.spawn(["bun", "run", filePath], { timeout: 15000 });
                const output = await new Response(proc.stdout).text();
                return `Executed ${fileName}. Output:\n${output}`;
            }
        }
    },
    {
        name: "openclaw_action",
        description: "Perform an action on OpenClaw by sending an HTTP request.",
        parameters: {
            type: "object",
            properties: {
                endpoint: { type: "string", description: "The API endpoint or action name" },
                payload: { type: "object", description: "JSON payload to send" }
            },
            required: ["endpoint"]
        },
        execute: async ({ endpoint, payload = {} }) => {
            // Replace with your actual OpenClaw base URL
            const res = await fetch(`https://api.openclaw.example/${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            return await res.text();
        }
    },
    {
        name: "open_device_app",
        description: "Open an application on the user's device (e.g., Gmail, Browser) by sending a clickable inline button.",
        parameters: {
            type: "object",
            properties: {
                app_name: { type: "string", description: "The name of the app to open" },
                url: { type: "string", description: "The web URL or deep link for the app" }
            },
            required: ["app_name", "url"]
        },
        execute: async ({ app_name, url }, ctx: Context) => {
            await ctx.reply(`🚀 Opening ${app_name}...`, {
                reply_markup: {
                    inline_keyboard: [[ { text: `Click to open ${app_name}`, url: url } ]]
                }
            });
            return `Sent link to open ${app_name}.`;
        }
    }
];

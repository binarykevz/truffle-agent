import { Bot } from "grammy";
import { runAgent, resetAgent } from "./agent";

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!);

// Security Middleware: Whitelist users
const allowedIds = (process.env.ALLOWED_USER_IDS || "").split(",").map(Number);
bot.use(async (ctx, next) => {
    if (allowedIds.length > 0 && !allowedIds.includes(ctx.from?.id || 0)) {
        return ctx.reply("⛔ Unauthorized.");
    }
    await next();
});

bot.command("start", (ctx) => {
    ctx.reply("👋 Hello! I am your agentic assistant. I can crawl the web, write/deploy code, and open apps. Type /reset to clear my memory.");
});

bot.command("reset", (ctx) => {
    resetAgent(ctx.from!.id);
    ctx.reply("🧹 Memory cleared.");
});

// Handle all text messages
bot.on("message:text", async (ctx) => {
    try {
        const response = await runAgent(ctx, ctx.message.text);
        
        // Telegram has a 4096 character limit
        if (response.length > 4000) {
            const chunks = response.match(/.{1,4000}/g) || [];
            for (const chunk of chunks) {
                await ctx.reply(chunk);
            }
        } else {
            await ctx.reply(response);
        }
    } catch (error: any) {
        console.error("Agent Error:", error);
        await ctx.reply(`❌ An error occurred: ${error.message}`);
    }
});

console.log("🤖 Bot is starting...");
bot.start();

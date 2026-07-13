import { Bot } from "grammy";
import { runAgent, resetAgent } from "./agent";
import {
    initDB,
    seedOwner,
    getOwner,
    isOwner,
    isAllowedUser,
    addAllowedUser,
    removeAllowedUser,
    listAllowedUsers,
    getConfig,
    setConfig,
    deleteConfig,
    getAllConfig,
} from "./db";

async function main() {
    await initDB();
    console.log("✅ Database initialized");

    const ownerId = await seedOwner();
    if (ownerId) {
        console.log(`👑 Owner locked to Telegram ID: ${ownerId}`);
    }

    // Auto-seed OpenClaw defaults if not yet configured
    if (!(await getConfig("openclaw_url"))) {
        await setConfig("openclaw_url", "http://127.0.0.1:18789/hooks/agent");
        console.log("🔌 OpenClaw URL seeded: http://127.0.0.1:18789/hooks/agent");
    }
    if (!(await getConfig("openclaw_token"))) {
        await setConfig(
            "openclaw_token",
            "f1d98b9579ab55a32afefac44feafe681457c903178409f9"
        );
        console.log("🔑 OpenClaw gateway token seeded");
    }

    // Auto-seed bot token from .env if not yet in DB
    let botToken = await getConfig("bot_token");
    if (!botToken && process.env.BOT_TOKEN) {
        await setConfig("bot_token", process.env.BOT_TOKEN);
        botToken = process.env.BOT_TOKEN;
        console.log("🔑 Bot token auto-seeded from .env");
    }
    if (!botToken) {
        console.error("❌ bot_token not set. Add BOT_TOKEN to .env or seed it into Turso.");
        process.exit(1);
    }

    const bot = new Bot(botToken);

    // === Middleware: block unauthorized users ===
    bot.use(async (ctx, next) => {
        if (!ctx.from) return;
        const allowed = await isAllowedUser(ctx.from.id);
        if (!allowed) {
            if (ctx.message) {
                const owner = await getOwner();
                await ctx.reply(
                    `⛔ Unauthorized. Your ID: \`${ctx.from.id}\`\n` +
                    `Ask the owner${owner ? ` (ID: \`${owner}\`)` : ""} to run:\n` +
                    `\`/adduser ${ctx.from.id}\``,
                    { parse_mode: "Markdown" }
                );
            }
            return;
        }
        await next();
    });

    // === /start ===
    bot.command("start", async (ctx) => {
        await ctx.reply(
            `👋 Welcome, ${ctx.from.first_name}!\n` +
            `I'm your agentic assistant. I can crawl the web, generate/deploy code, interact with OpenClaw, and open apps on your device.\n\n` +
            `Use /help for commands.`
        );
    });

    // === /help ===
    bot.command("help", async (ctx) => {
        const owner = await isOwner(ctx.from.id);
        let msg =
            "**User Commands**\n" +
            "/reset — Clear your conversation memory\n" +
            "/help — Show this message\n\n" +
            "**Examples**\n" +
            '• "Open WhatsApp"\n' +
            '• "Call +628123456789"\n' +
            '• "What apps do I have installed?"\n' +
            '• "Crawl https://example.com"\n' +
            '• "Build me a todo app and deploy it"\n\n';
        if (owner) {
            msg +=
                "**Owner Commands**\n" +
                "/adduser `<id>` — Allow a user\n" +
                "/removeuser `<id>` — Revoke a user\n" +
                "/listusers — Show allowed users\n" +
                "/setconfig `<key>` `<value>` — Set a config value\n" +
                "/getconfig `[key]` — View config\n" +
                "/delconfig `<key>` — Delete a config key\n" +
                "/status — Show bot status\n";
        }
        await ctx.reply(msg, { parse_mode: "Markdown" });
    });

    // === /adduser (owner only) ===
    bot.command("adduser", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const targetId = Number(ctx.match?.trim());
        if (!targetId || isNaN(targetId)) return ctx.reply("Usage: `/adduser <user_id>`", { parse_mode: "Markdown" });
        const added = await addAllowedUser(targetId, undefined, ctx.from.id);
        await ctx.reply(added ? `✅ Added user \`${targetId}\`` : `ℹ️ User \`${targetId}\` was already allowed`, {
            parse_mode: "Markdown",
        });
    });

    // === /removeuser (owner only) ===
    bot.command("removeuser", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const targetId = Number(ctx.match?.trim());
        if (!targetId || isNaN(targetId)) return ctx.reply("Usage: `/removeuser <user_id>`", { parse_mode: "Markdown" });
        if (targetId === ctx.from.id) return ctx.reply("⛔ You cannot remove yourself.");
        const removed = await removeAllowedUser(targetId);
        await ctx.reply(removed ? `✅ Removed user \`${targetId}\`` : `ℹ️ User \`${targetId}\` was not in the list`, {
            parse_mode: "Markdown",
        });
    });

    // === /listusers (owner only) ===
    bot.command("listusers", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const users = await listAllowedUsers();
        if (users.length === 0) return ctx.reply("No allowed users yet.");
        const lines = users.map((u) => `• \`${u.user_id}\` ${u.username ? `(@${u.username})` : ""}`);
        await ctx.reply(`**Allowed users (${users.length}):**\n` + lines.join("\n"), { parse_mode: "Markdown" });
    });

    // === /setconfig (owner only) ===
    bot.command("setconfig", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const parts = (ctx.match ?? "").split(/\s+/);
        if (parts.length < 2) return ctx.reply("Usage: `/setconfig <key> <value>`", { parse_mode: "Markdown" });
        const [key, ...rest] = parts;
        const value = rest.join(" ");
        await setConfig(key, value);
        await ctx.reply(`✅ Set \`${key}\` = \`${value.slice(0, 50)}${value.length > 50 ? "..." : ""}\``, {
            parse_mode: "Markdown",
        });
    });

    // === /getconfig (owner only) ===
    bot.command("getconfig", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const key = ctx.match?.trim();
        if (key) {
            const val = await getConfig(key);
            await ctx.reply(val === null ? `❓ \`${key}\` is not set` : `\`${key}\` = \`${val}\``, {
                parse_mode: "Markdown",
            });
        } else {
            const all = await getAllConfig();
            const lines = Object.entries(all).map(([k, v]) => {
                const masked = ["api_key", "bot_token", "openclaw_key"].includes(k)
                    ? v.slice(0, 6) + "***" + v.slice(-4)
                    : v;
                return `\`${k}\` = \`${masked}\``;
            });
            await ctx.reply("**Config:**\n" + (lines.join("\n") || "(empty)"), { parse_mode: "Markdown" });
        }
    });

    // === /delconfig (owner only) ===
    bot.command("delconfig", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const key = ctx.match?.trim();
        if (!key) return ctx.reply("Usage: `/delconfig <key>`", { parse_mode: "Markdown" });
        await deleteConfig(key);
        await ctx.reply(`✅ Deleted \`${key}\``, { parse_mode: "Markdown" });
    });

    // === /status (owner only) ===
    bot.command("status", async (ctx) => {
        if (!(await isOwner(ctx.from.id))) return ctx.reply("⛔ Owner only.");
        const config = await getAllConfig();
        const users = await listAllowedUsers();
        const owner = await getOwner();
        await ctx.reply(
            `**Bot Status**\n` +
                `• Owner: \`${owner ?? "not set"}\`\n` +
                `• Allowed users: ${users.length}\n` +
                `• Model: \`${config.model ?? "not set"}\`\n` +
                `• Base URL: \`${config.base_url ?? "not set"}\`\n` +
                `• API Key: ${config.api_key ? "✅ set" : "❌ missing"}\n` +
                `• Bot Token: ${config.bot_token ? "✅ set" : "❌ missing"}\n` +
                `• OpenClaw URL: \`${config.openclaw_url ?? "not set"}\`\n` +
                `• OpenClaw Key: ${config.openclaw_key ? "✅ set" : "❌ missing"}`,
            { parse_mode: "Markdown" }
        );
    });
    

    // === /reset (all allowed users) ===
    bot.command("reset", async (ctx) => {
        await resetAgent(ctx.from.id);
        await ctx.reply("🧹 Memory cleared.");
    });

    // === Main message handler ===
    bot.on("message:text", async (ctx) => {
        try {
            const response = await runAgent(ctx, ctx.message.text);
            const chunks = response.match(/.{1,4000}/gs) || [""];
            for (const chunk of chunks) await ctx.reply(chunk);
        } catch (error: any) {
            console.error("Agent Error:", error);
            await ctx.reply(`❌ Error: ${error.message}`);
        }
    });

    console.log("🤖 Bot starting...");
    await bot.start();
    console.log(`✅ Online as @${bot.botInfo?.username}`);
}

main().catch((e) => {
    console.error("Fatal:", e);
    process.exit(1);
});

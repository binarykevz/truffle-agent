import { Context } from "grammy";
import { callLLM, type ToolDef } from "./llm";
import { tools } from "./tools";
import { getHistory, saveMessage, clearHistory, type Message } from "./db";

const SYSTEM_PROMPT = `You are an autonomous agentic assistant. You can:
- Crawl the web for research
- Generate and deploy TypeScript programs
- Interact with OpenClaw
- Open apps on the user's device (WhatsApp, Gmail, YouTube, Instagram, etc.)
- List installed apps (if running on Termux/Android)
- Open arbitrary URLs and deep links

Guidelines:
- When the user asks to open an app, use the "open_app" tool with the app name.
- If the app isn't in the known list, ask the user for the Android package name.
- For phone calls, use app="dialer" with extra="+1234567890".
- For SMS, use app="sms" with extra="+1234567890".
- Keep responses concise and confirm actions clearly.`;

export async function runAgent(ctx: Context, userMessage: string): Promise<string> {
    const userId = ctx.from!.id;

    // 1. Initialize history
    let history = getHistory(userId);
    if (history.length === 0) {
        history.push({ role: "system", content: SYSTEM_PROMPT });
    }
    history.push({ role: "user", content: userMessage });
    saveMessage(userId, { role: "user", content: userMessage });

    const toolDefs: ToolDef[] = tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
    }));

    // 2. Agent Loop (max 5 iterations)
    for (let i = 0; i < 5; i++) {
        await ctx.replyWithChatAction("typing");

        // Defensive: validate history before every LLM call
        history = validateForLLM(history);

        const reply = await callLLM(history, toolDefs);
        history.push(reply);
        saveMessage(userId, reply);

        if (!reply.tool_calls || reply.tool_calls.length === 0) {
            return reply.content || "I'm not sure how to respond to that.";
        }

        // 3. Execute tools
        for (const toolCall of reply.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: any = {};
            try {
                toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch {
                toolArgs = {};
            }

            const tool = tools.find(t => t.name === toolName);
            let result: any = "Tool not found";

            if (tool) {
                try {
                    result = await tool.execute(toolArgs, ctx);
                } catch (err: any) {
                    result = `Error: ${err.message}`;
                }
            }

            const toolMsg: Message = {
                role: "tool",
                content: typeof result === "string" ? result : JSON.stringify(result),
                tool_call_id: toolCall.id,
                name: toolName,
            };
            history.push(toolMsg);
            saveMessage(userId, toolMsg);
        }
    }

    return "⚠️ I reached the maximum number of steps. Please try again.";
}

/**
 * Final safety net: ensures history is valid for the LLM.
 * Removes any trailing assistant message with unfulfilled tool_calls.
 */
function validateForLLM(messages: Message[]): Message[] {
    const copy = [...messages];
    // Walk backwards and remove trailing incomplete sequences
    while (copy.length > 0) {
        const last = copy[copy.length - 1];
        if (last.role === "assistant" && last.tool_calls && last.tool_calls.length > 0) {
            copy.pop(); // drop orphaned assistant tool_calls
            continue;
        }
        if (last.role === "tool") {
            // Check if there's a matching assistant tool_call before it
            const match = copy
                .slice(0, -1)
                .reverse()
                .find(m => m.role === "assistant" && m.tool_calls?.some((tc: any) => tc.id === last.tool_call_id));
            if (!match) {
                copy.pop(); // orphaned tool response — drop it
                continue;
            }
        }
        break;
    }
    return copy;
}

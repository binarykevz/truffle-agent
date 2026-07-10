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
        name: t.name, description: t.description, parameters: t.parameters
    }));

    // 2. Agent Loop (Max 5 iterations to prevent infinite loops)
    for (let i = 0; i < 5; i++) {
        await ctx.replyWithChatAction("typing");
        
        const reply = await callLLM(history, toolDefs);
        history.push(reply);
        saveMessage(userId, reply);

        // If no tool calls, we have our final answer
        if (!reply.tool_calls || reply.tool_calls.length === 0) {
            return reply.content || "I'm not sure how to respond to that.";
        }

        // 3. Execute Tools
        for (const toolCall of reply.tool_calls) {
            const toolName = toolCall.function.name;
            const toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            
            const tool = tools.find(t => t.name === toolName);
            let result = "Tool not found";
            
            if (tool) {
                try {
                    result = await tool.execute(toolArgs, ctx);
                } catch (err: any) {
                    result = `Error: ${err.message}`;
                }
            }

            // Save tool result to history
            const toolMsg: Message = {
                role: "tool",
                content: typeof result === 'string' ? result : JSON.stringify(result),
                tool_call_id: toolCall.id,
                name: toolName
            };
            history.push(toolMsg);
            saveMessage(userId, toolMsg);
        }
    }

    return "⚠️ I reached the maximum number of steps. Please try again.";
}

export function resetAgent(userId: number) {
    clearHistory(userId);
}

import { type Message } from "./db";

export interface ToolDef {
    name: string;
    description: string;
    parameters: Record<string, any>;
}

export async function callLLM(messages: Message[], tools: ToolDef[]): Promise<Message> {
    const res = await fetch(`${process.env.DASHSCOPE_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
        },
        body: JSON.stringify({
            model: process.env.MODEL || "qwen-max",
            messages,
            tools: tools.map(t => ({
                type: "function",
                function: { name: t.name, description: t.description, parameters: t.parameters }
            })),
            tool_choice: "auto",
            stream: false
        })
    });

    if (!res.ok) {
        throw new Error(`LLM Error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json() as any;
    return data.choices[0].message;
}

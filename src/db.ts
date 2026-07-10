import { Database } from "bun:sqlite";

const db = new Database("bot_history.sqlite");
db.run(`
    CREATE TABLE IF NOT EXISTS history (
        user_id INTEGER,
        role TEXT,
        content TEXT,
        tool_calls TEXT,
        tool_call_id TEXT,
        name TEXT,
        timestamp INTEGER
    )
`);

export interface Message {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content?: string | null;
    tool_calls?: any[];
    tool_call_id?: string;
    name?: string;
}

// Load ALL messages for a user (no LIMIT — we sanitize instead)
export function getHistory(userId: number): Message[] {
    const rows = db.query(
        "SELECT * FROM history WHERE user_id = ? ORDER BY timestamp ASC"
    ).all(userId) as any[];

    const messages: Message[] = rows.map(row => {
        const msg: Message = { role: row.role, content: row.content };
        if (row.tool_calls) msg.tool_calls = JSON.parse(row.tool_calls);
        if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
        if (row.name) msg.name = row.name;
        return msg;
    });

    return sanitizeHistory(messages);
}

/**
 * Ensures the history is valid for the LLM API:
 * - Every assistant message with tool_calls is followed by matching tool responses.
 * - Truncates the history at the last "safe" point where all tool calls are fulfilled.
 * - If history is too long, trims from the front (keeping system message).
 */
function sanitizeHistory(messages: Message[]): Message[] {
    if (messages.length === 0) return messages;

    // 1. Find the last safe truncation point
    let lastSafePoint = 0;
    let pendingToolIds = new Set<string>();

    for (let i = 0; i < messages.length; i++) {
        const msg = messages[i];

        if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
            // Reset pending set to this assistant's tool calls
            pendingToolIds = new Set(msg.tool_calls.map((tc: any) => tc.id));
        } else if (msg.role === "tool" && msg.tool_call_id) {
            pendingToolIds.delete(msg.tool_call_id);
        }

        // A point is "safe" when there are no pending tool responses
        if (pendingToolIds.size === 0) {
            lastSafePoint = i + 1;
        }
    }

    // 2. Truncate at the last safe point (drops orphaned tool sequences)
    let safe = messages.slice(0, lastSafePoint);

    // 3. If still too long, trim from the front but ALWAYS keep the system message
    const MAX_MESSAGES = 40;
    if (safe.length > MAX_MESSAGES) {
        const systemMsg = safe.find(m => m.role === "system");
        const rest = safe.filter(m => m.role !== "system").slice(-MAX_MESSAGES + 1);
        safe = systemMsg ? [systemMsg, ...rest] : rest;
    }

    return safe;
}

export function saveMessage(userId: number, msg: Message) {
    db.run(
        "INSERT INTO history (user_id, role, content, tool_calls, tool_call_id, name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
            userId,
            msg.role,
            msg.content ?? null,
            msg.tool_calls ? JSON.stringify(msg.tool_calls) : null,
            msg.tool_call_id ?? null,
            msg.name ?? null,
            Date.now(),
        ]
    );
}

export function clearHistory(userId: number) {
    db.run("DELETE FROM history WHERE user_id = ?", [userId]);
}

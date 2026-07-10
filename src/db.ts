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

export function getHistory(userId: number): Message[] {
    const rows = db.query("SELECT * FROM history WHERE user_id = ? ORDER BY timestamp ASC LIMIT 50").all(userId) as any[];
    return rows.map(row => {
        const msg: Message = { role: row.role, content: row.content };
        if (row.tool_calls) msg.tool_calls = JSON.parse(row.tool_calls);
        if (row.tool_call_id) msg.tool_call_id = row.tool_call_id;
        if (row.name) msg.name = row.name;
        return msg;
    });
}

export function saveMessage(userId: number, msg: Message) {
    db.run(
        "INSERT INTO history (user_id, role, content, tool_calls, tool_call_id, name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [userId, msg.role, msg.content || null, msg.tool_calls ? JSON.stringify(msg.tool_calls) : null, msg.tool_call_id || null, msg.name || null, Date.now()]
    );
}

export function clearHistory(userId: number) {
    db.run("DELETE FROM history WHERE user_id = ?", [userId]);
}

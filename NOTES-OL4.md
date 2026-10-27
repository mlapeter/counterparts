# OL4 progress (branch feat/ol4-chat-script)

Done: tools/trials/claude-ai/chat-script.ts (7 chats + a night over the HTTP door, model-free, scored);
test/trial-chat-script.test.ts (passes; a shareless wake fails it); TESTING.md §5 row; README line.
Next: PR, CI, medium review. Fold this into src/adapters/remote/NOTES.md before ready.
Learned: on a hookless host the briefing ("Coming up", "Last night") is composed only by the
worker's sleep, so a stubbed worker gives chat 7 the bootstrap wake; the script runs the worker's
heavy half in-process after each wake that asks for one.

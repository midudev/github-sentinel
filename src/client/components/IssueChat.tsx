import { useEffect, useRef, useState } from "react";
import { api, type ChatMessage } from "../api";
import { formatRelative } from "../utils";

type Props = {
  issueId: number;
  issueTitle: string;
};

export function IssueChat({ issueId, issueTitle }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    api
      .listIssueChat(issueId)
      .then((data) => {
        if (active) setMessages(data);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      active = false;
    };
  }, [issueId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userText = input.trim();
    setInput("");
    setError(null);
    setLoading(true);

    // 1. Mensaje del usuario (optimista)
    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      role: "user",
      content: userText,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);

    try {
      const response = await api.sendIssueChatMessage(issueId, userText);

      if (!response.ok) {
        throw new Error(
          `Error en servidor: ${response.status} ${response.statusText}`,
        );
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("El servidor no retornó un stream de datos.");
      }

      const decoder = new TextDecoder();
      let assistantText = "";
      const assistantMsgId = Date.now() + 1;

      // 2. Insertar mensaje vacío del asistente para ir actualizándolo
      setMessages((prev) => [
        ...prev,
        {
          id: assistantMsgId,
          role: "assistant",
          content: "",
          created_at: new Date().toISOString(),
        },
      ]);

      // 3. Leer el stream en bucle
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        assistantText += chunk;

        // Actualizar el contenido de la respuesta en tiempo real
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMsgId
              ? { ...msg, content: assistantText }
              : msg,
          ),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const clearChat = async () => {
    if (loading || !window.confirm("¿Seguro que quieres vaciar el chat?"))
      return;
    setLoading(true);
    try {
      await api.clearIssueChat(issueId);
      setMessages([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border border-[var(--color-ink-3)] bg-[var(--color-ink-0)] p-4 flex flex-col h-[400px]">
      <div className="flex items-center justify-between border-b border-[var(--color-ink-3)] pb-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span className="font-pixel uppercase text-[10px] text-[var(--color-fg-1)] tracking-wider">
            asistente local interactivo
          </span>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            disabled={loading}
            className="font-pixel uppercase text-[9px] text-[var(--color-fg-4)] hover:text-[var(--color-danger)] transition-colors disabled:opacity-40"
          >
            [vaciar chat]
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-3 pr-2 scrollbar-thin max-h-[290px]"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6">
            <div className="font-pixel text-xl text-[var(--color-fg-4)] mb-2">
              💬
            </div>
            <p className="text-xs text-[var(--color-fg-3)] max-w-xs font-mono">
              Pregúntame sobre esta issue. Puedes pedirme que proponga un "test
              de código", "cómo solucionar" el bug o alternativas.
            </p>
          </div>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${
                m.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div className="flex items-center gap-1.5 mb-1 px-1 text-[9px] font-mono text-[var(--color-fg-4)]">
                <span>{m.role === "user" ? "Tú" : "Asistente"}</span>
                <span>·</span>
                <span>{formatRelative(m.created_at)}</span>
              </div>
              <div
                className={`max-w-[85%] rounded p-2.5 text-xs font-mono leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-[var(--color-ink-2)] text-[var(--color-accent)] border border-[var(--color-ink-3)]"
                    : "bg-[var(--color-ink-1)] text-[var(--color-fg-2)] border border-[var(--color-ink-3)]"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex items-center gap-2 text-[10px] font-mono text-[var(--color-accent)]">
            <span className="animate-bounce">●</span>
            <span className="animate-bounce [animation-delay:0.2s]">●</span>
            <span className="animate-bounce [animation-delay:0.4s]">●</span>
            <span className="text-[var(--color-fg-4)] italic">
              analizando contexto...
            </span>
          </div>
        )}

        {error && (
          <div className="text-[10px] font-mono text-[var(--color-danger)] bg-[rgba(var(--color-danger-rgb),0.1)] border border-[var(--color-danger)] p-2">
            ⚠️ {error}
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="mt-auto pt-3 border-t border-[var(--color-ink-3)] flex gap-2"
      >
        <div className="flex-1 flex items-center border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] focus-within:border-[var(--color-accent)]">
          <span className="pl-2.5 text-[var(--color-accent)] font-mono text-xs select-none">
            &gt;
          </span>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={loading}
            placeholder="Pregunta algo sobre esta issue..."
            className="w-full bg-transparent border-0 outline-none text-xs py-2 px-1.5 text-[var(--color-fg-1)] placeholder:text-[var(--color-fg-4)] font-mono"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="font-pixel uppercase text-[10px] px-4 py-2 border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          enviar
        </button>
      </form>
    </div>
  );
}

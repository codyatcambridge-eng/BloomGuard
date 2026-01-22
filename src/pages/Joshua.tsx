import { useState, useRef, useEffect } from "react";
import { Send, BookOpen } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "joshua";
  content: string;
}

const initialMessages: Message[] = [
  {
    id: "1",
    role: "joshua",
    content: "Greetings, soldier. I am Joshua, your KJV Biblical Scholar and Disciplinarian. How may I counsel thee this day? Speak freely, and let us reason together according to Scripture.",
  },
];

const Joshua = () => {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: "user",
      content: input.trim(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsTyping(true);

    // Simulate AI response (placeholder)
    setTimeout(() => {
      const joshuaResponse: Message = {
        id: (Date.now() + 1).toString(),
        role: "joshua",
        content: "The Scripture sayeth in Proverbs 3:5-6, 'Trust in the LORD with all thine heart; and lean not unto thine own understanding. In all thy ways acknowledge him, and he shall direct thy paths.' Let this wisdom guide thy steps, warrior.",
      };
      setMessages((prev) => [...prev, joshuaResponse]);
      setIsTyping(false);
    }, 1500);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Fixed Header */}
      <header className="px-4 py-4 border-b border-border bg-card/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-sm bg-primary flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-aqua" />
          </div>
          <div>
            <h1 className="font-display text-lg tracking-wider">JOSHUA</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              KJV Biblical Scholar & Disciplinarian
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-4 py-4 pb-32 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] px-4 py-3 rounded-sm ${
                message.role === "user"
                  ? "bg-aqua text-accent-foreground"
                  : "bg-primary text-foreground border border-border"
              }`}
            >
              <p className="text-sm leading-relaxed">{message.content}</p>
            </div>
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-primary text-foreground border border-border px-4 py-3 rounded-sm">
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-aqua rounded-full animate-pulse" />
                <span className="w-2 h-2 bg-aqua rounded-full animate-pulse delay-100" />
                <span className="w-2 h-2 bg-aqua rounded-full animate-pulse delay-200" />
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <div className="fixed bottom-16 left-0 right-0 px-4 py-3 bg-card/95 backdrop-blur-sm border-t border-border">
        <div className="flex gap-3 max-w-lg mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Speak unto Joshua..."
            className="flex-1 bg-input border border-border rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="w-12 h-12 flex items-center justify-center bg-aqua text-accent-foreground rounded-sm disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Joshua;

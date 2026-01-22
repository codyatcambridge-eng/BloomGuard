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
    <div className="min-h-screen flex flex-col warroom-bg relative">
      {/* Fixed Header */}
      <header 
        className="relative z-10 px-4 py-4 border-b border-silver/30 sticky top-0"
        style={{
          background: 'linear-gradient(180deg, hsl(220 50% 8% / 0.98) 0%, hsl(220 50% 6% / 0.95) 100%)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex items-center gap-3">
          <div 
            className="w-10 h-10 rounded-sm flex items-center justify-center"
            style={{
              background: 'linear-gradient(145deg, hsl(220 15% 28%) 0%, hsl(220 20% 18%) 100%)',
              border: '1px solid hsl(220 10% 40% / 0.4)',
              boxShadow: 'inset 0 1px 0 hsl(220 10% 50% / 0.2)',
            }}
          >
            <BookOpen className="w-5 h-5 text-aqua drop-shadow-[0_0_8px_hsl(180_100%_50%/0.6)]" />
          </div>
          <div>
            <h1 className="font-display text-lg tracking-wider">JOSHUA</h1>
            <p className="text-xs text-silver uppercase tracking-widest">
              KJV Biblical Scholar & Disciplinarian
            </p>
          </div>
        </div>
      </header>

      {/* Messages */}
      <main className="relative z-10 flex-1 overflow-y-auto px-4 py-4 pb-32 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            {message.role === "joshua" ? (
              // Silver tablet style for Joshua
              <div
                className="max-w-[85%] px-5 py-4 silver-tablet"
                style={{
                  borderRadius: '2px',
                }}
              >
                <p 
                  className="text-sm leading-relaxed"
                  style={{
                    color: 'hsl(180 100% 50%)',
                    textShadow: '0 0 10px hsl(180 100% 50% / 0.4)',
                  }}
                >
                  {message.content}
                </p>
              </div>
            ) : (
              // Aqua style for user
              <div
                className="max-w-[85%] px-5 py-4"
                style={{
                  background: 'linear-gradient(135deg, hsl(180 100% 45%) 0%, hsl(180 80% 35%) 100%)',
                  color: 'hsl(220 100% 8%)',
                  borderRadius: '2px',
                  boxShadow: '0 0 20px hsl(180 100% 50% / 0.3)',
                }}
              >
                <p className="text-sm leading-relaxed font-medium">{message.content}</p>
              </div>
            )}
          </div>
        ))}
        
        {isTyping && (
          <div className="flex justify-start">
            <div className="silver-tablet px-5 py-4" style={{ borderRadius: '2px' }}>
              <div className="flex gap-1.5">
                <span 
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ 
                    background: 'hsl(180 100% 50%)',
                    boxShadow: '0 0 6px hsl(180 100% 50%)',
                  }}
                />
                <span 
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ 
                    background: 'hsl(180 100% 50%)',
                    boxShadow: '0 0 6px hsl(180 100% 50%)',
                    animationDelay: '150ms',
                  }}
                />
                <span 
                  className="w-2 h-2 rounded-full animate-pulse"
                  style={{ 
                    background: 'hsl(180 100% 50%)',
                    boxShadow: '0 0 6px hsl(180 100% 50%)',
                    animationDelay: '300ms',
                  }}
                />
              </div>
            </div>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </main>

      {/* Input Area */}
      <div 
        className="fixed bottom-16 left-0 right-0 px-4 py-3 border-t border-silver/30"
        style={{
          background: 'linear-gradient(180deg, hsl(220 50% 8% / 0.98) 0%, hsl(220 50% 6% / 0.95) 100%)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="flex gap-3 max-w-lg mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Speak unto Joshua..."
            className="flex-1 bg-input border border-silver/30 rounded-sm px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-aqua transition-colors"
            style={{
              boxShadow: 'inset 0 2px 4px hsl(220 100% 3% / 0.3)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="w-12 h-12 flex items-center justify-center gold-button rounded-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none transition-all"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default Joshua;
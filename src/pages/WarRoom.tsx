import { useState } from "react";
import { Play, Pause, Clock, Headphones } from "lucide-react";

type Category = "hard-discipline" | "sovereignty" | "focus";

interface AudioModule {
  id: string;
  title: string;
  duration: string;
  category: Category;
}

const audioModules: AudioModule[] = [
  { id: "1", title: "The Iron Will Protocol", duration: "12:45", category: "hard-discipline" },
  { id: "2", title: "No Retreat, No Surrender", duration: "8:30", category: "hard-discipline" },
  { id: "3", title: "Dominion Over Flesh", duration: "15:20", category: "hard-discipline" },
  { id: "4", title: "The Lord's Authority", duration: "10:15", category: "sovereignty" },
  { id: "5", title: "Kingdom Mindset", duration: "14:00", category: "sovereignty" },
  { id: "6", title: "Under His Command", duration: "9:45", category: "sovereignty" },
  { id: "7", title: "Laser Focus Activation", duration: "7:30", category: "focus" },
  { id: "8", title: "Distraction Destroyer", duration: "11:20", category: "focus" },
  { id: "9", title: "Single-Minded Pursuit", duration: "13:00", category: "focus" },
];

const categoryLabels: Record<Category, string> = {
  "hard-discipline": "HARD DISCIPLINE",
  "sovereignty": "SOVEREIGNTY",
  "focus": "FOCUS",
};

const WarRoom = () => {
  const [activeCategory, setActiveCategory] = useState<Category>("hard-discipline");
  const [playingId, setPlayingId] = useState<string | null>(null);

  const filteredModules = audioModules.filter(m => m.category === activeCategory);

  const handlePlay = (id: string) => {
    setPlayingId(playingId === id ? null : id);
  };

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="px-4 pt-8 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <Headphones className="w-8 h-8 text-aqua" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">WAR ROOM</h1>
            <p className="text-xs text-muted-foreground uppercase tracking-widest">
              High-Intensity Audio Modules
            </p>
          </div>
        </div>
      </header>

      {/* Category Tabs */}
      <div className="flex px-4 py-4 gap-2 overflow-x-auto">
        {(Object.keys(categoryLabels) as Category[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 text-xs font-display tracking-wider whitespace-nowrap transition-all duration-200 border ${
              activeCategory === cat
                ? "bg-aqua text-accent-foreground border-aqua"
                : "bg-transparent text-muted-foreground border-border hover:border-aqua/50"
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {/* Audio List */}
      <main className="px-4 space-y-3">
        {filteredModules.map((module) => {
          const isPlaying = playingId === module.id;
          return (
            <div
              key={module.id}
              className={`cathedral-card flex items-center gap-4 transition-all duration-200 ${
                isPlaying ? "border-aqua" : ""
              }`}
            >
              <button
                onClick={() => handlePlay(module.id)}
                className={`w-12 h-12 flex items-center justify-center rounded-sm transition-all duration-200 ${
                  isPlaying
                    ? "bg-aqua text-accent-foreground"
                    : "bg-secondary hover:bg-aqua hover:text-accent-foreground"
                }`}
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5" />
                )}
              </button>
              <div className="flex-1">
                <h3 className="font-display text-sm tracking-wide">{module.title}</h3>
                <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">{module.duration}</span>
                </div>
              </div>
            </div>
          );
        })}
      </main>
    </div>
  );
};

export default WarRoom;

import { useState } from "react";
import { Play, Pause, Clock, Headphones, X, SkipBack, SkipForward, Volume2 } from "lucide-react";

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
  const [progress, setProgress] = useState(35);

  const filteredModules = audioModules.filter(m => m.category === activeCategory);
  const currentModule = playingId ? audioModules.find(m => m.id === playingId) : null;

  const handlePlay = (id: string) => {
    setPlayingId(playingId === id ? null : id);
  };

  const handleClose = () => {
    setPlayingId(null);
  };

  return (
    <div className="min-h-screen pb-24 warroom-bg relative">
      {/* Header */}
      <header className="relative z-10 px-4 pt-8 pb-4 border-b border-silver/20">
        <div className="flex items-center gap-3">
          <Headphones className="w-8 h-8 text-aqua drop-shadow-[0_0_10px_hsl(180_100%_50%/0.5)]" />
          <div>
            <h1 className="font-display text-2xl tracking-wider">WAR ROOM</h1>
            <p className="text-xs text-silver uppercase tracking-widest">
              High-Intensity Audio Modules
            </p>
          </div>
        </div>
      </header>

      {/* Category Tabs */}
      <div className="relative z-10 flex px-4 py-4 gap-2 overflow-x-auto">
        {(Object.keys(categoryLabels) as Category[]).map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 text-xs font-display tracking-wider whitespace-nowrap transition-all duration-200 border ${
              activeCategory === cat
                ? "gold-button border-gold"
                : "bg-transparent text-silver border-silver/30 hover:border-silver/60"
            }`}
          >
            {categoryLabels[cat]}
          </button>
        ))}
      </div>

      {/* Audio List */}
      <main className="relative z-10 px-4 space-y-3 pb-32">
        {filteredModules.map((module) => {
          const isPlaying = playingId === module.id;
          return (
            <div
              key={module.id}
              className={`cathedral-card flex items-center gap-4 transition-all duration-200 ${
                isPlaying ? "border-aqua shadow-[0_0_20px_hsl(180_100%_50%/0.2)]" : "border-silver/20"
              }`}
            >
              <button
                onClick={() => handlePlay(module.id)}
                className={`w-12 h-12 flex items-center justify-center transition-all duration-200 ${
                  isPlaying
                    ? "bg-aqua text-accent-foreground shadow-[0_0_15px_hsl(180_100%_50%/0.5)]"
                    : "gold-button"
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
                <div className="flex items-center gap-2 mt-1 text-silver">
                  <Clock className="w-3 h-3" />
                  <span className="text-xs">{module.duration}</span>
                </div>
              </div>
            </div>
          );
        })}
      </main>

      {/* Mini Player - Now Playing */}
      {currentModule && (
        <div 
          className="fixed bottom-16 left-0 right-0 z-20 border-t border-silver/30"
          style={{
            background: 'linear-gradient(180deg, hsl(220 50% 10%) 0%, hsl(220 60% 6%) 100%)',
            boxShadow: '0 -4px 30px hsl(220 100% 3% / 0.8)',
          }}
        >
          {/* Progress bar */}
          <div className="h-1 bg-muted">
            <div 
              className="h-full bg-aqua transition-all duration-300"
              style={{ 
                width: `${progress}%`,
                boxShadow: '0 0 10px hsl(180 100% 50% / 0.5)',
              }}
            />
          </div>
          
          <div className="px-4 py-3 flex items-center gap-4">
            {/* Track info */}
            <div className="flex-1 min-w-0">
              <h4 className="font-display text-sm tracking-wide truncate text-aqua">
                {currentModule.title}
              </h4>
              <p className="text-xs text-silver truncate">
                {categoryLabels[currentModule.category]}
              </p>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors">
                <SkipBack className="w-4 h-4" />
              </button>
              <button 
                onClick={() => handlePlay(currentModule.id)}
                className="w-10 h-10 flex items-center justify-center bg-aqua text-accent-foreground rounded-full shadow-[0_0_15px_hsl(180_100%_50%/0.5)]"
              >
                {playingId === currentModule.id ? (
                  <Pause className="w-5 h-5" />
                ) : (
                  <Play className="w-5 h-5 ml-0.5" />
                )}
              </button>
              <button className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors">
                <SkipForward className="w-4 h-4" />
              </button>
            </div>

            {/* Volume & Close */}
            <div className="flex items-center gap-2">
              <button className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors">
                <Volume2 className="w-4 h-4" />
              </button>
              <button 
                onClick={handleClose}
                className="w-8 h-8 flex items-center justify-center text-silver hover:text-foreground transition-colors border border-silver/20 hover:border-silver/40"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WarRoom;
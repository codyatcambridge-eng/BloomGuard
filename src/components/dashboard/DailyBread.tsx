import { BookOpen } from "lucide-react";

const dailyVerses = [
  {
    verse: "Be strong and of a good courage; be not afraid, neither be thou dismayed: for the LORD thy God is with thee whithersoever thou goest.",
    reference: "Joshua 1:9",
  },
  {
    verse: "I can do all things through Christ which strengtheneth me.",
    reference: "Philippians 4:13",
  },
  {
    verse: "The LORD is my shepherd; I shall not want.",
    reference: "Psalm 23:1",
  },
];

export const DailyBread = () => {
  // Use date to get consistent daily verse
  const dayIndex = new Date().getDate() % dailyVerses.length;
  const { verse, reference } = dailyVerses[dayIndex];

  return (
    <div className="cathedral-card">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-5 h-5 text-aqua" />
        <h3 className="font-display text-sm tracking-widest text-muted-foreground">
          DAILY BREAD
        </h3>
      </div>
      <blockquote className="text-foreground leading-relaxed mb-3 italic">
        "{verse}"
      </blockquote>
      <cite className="text-aqua font-display text-sm not-italic">
        — {reference} KJV
      </cite>
    </div>
  );
};

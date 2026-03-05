import { AlertTriangle, Shield, BookOpen, FileText, Eye, Play, Users } from "lucide-react";
import { BrowserView } from "@/hooks/useBrowserNavigation";

interface ModeBannerProps {
  view: BrowserView;
  platformName?: string;
}

const MODE_CONFIG: Record<string, {
  icon: React.ReactNode;
  title: string;
  description: string;
  bgClass: string;
  textClass: string;
}> = {
  reader: {
    icon: <BookOpen className="w-4 h-4" />,
    title: "Protected Reader Mode",
    description: "Content has been extracted and sanitized. Scripts and trackers removed. Images moderated with on-device AI.",
    bgClass: "bg-aqua/10 border-aqua/20",
    textClass: "text-aqua",
  },
  preview: {
    icon: <Eye className="w-4 h-4" />,
    title: "Static Preview Mode",
    description: "Showing sanitized static content. Interactivity is disabled. Forms and buttons will not function.",
    bgClass: "bg-amber-500/10 border-amber-500/20",
    textClass: "text-amber-600",
  },
  fallback: {
    icon: <AlertTriangle className="w-4 h-4" />,
    title: "Protected Mode Required",
    description: "This site cannot load in the Focus Browser iframe. Use Reader Mode to view content safely.",
    bgClass: "bg-amber-500/10 border-amber-500/20",
    textClass: "text-amber-600",
  },
  youtube: {
    icon: <Play className="w-4 h-4" />,
    title: "YouTube Preview Mode",
    description: "Video playback is disabled for your protection. View metadata and open externally to watch.",
    bgClass: "bg-red-500/10 border-red-500/20",
    textClass: "text-red-500",
  },
  social: {
    icon: <Users className="w-4 h-4" />,
    title: "Social Preview Mode",
    description: "Interactive content is disabled. Showing static metadata only.",
    bgClass: "bg-pink-500/10 border-pink-500/20",
    textClass: "text-pink-500",
  },
  pdf: {
    icon: <FileText className="w-4 h-4" />,
    title: "PDF Viewer",
    description: "Displaying PDF document in a protected viewer.",
    bgClass: "bg-blue-500/10 border-blue-500/20",
    textClass: "text-blue-500",
  },
  failure: {
    icon: <AlertTriangle className="w-4 h-4" />,
    title: "Cannot Render Safely",
    description: "This content could not be extracted or rendered in a protected way.",
    bgClass: "bg-destructive/10 border-destructive/20",
    textClass: "text-destructive",
  },
  blocked: {
    icon: <Shield className="w-4 h-4" />,
    title: "Site Blocked",
    description: "This site has been blocked by GoodCreation protection.",
    bgClass: "bg-destructive/10 border-destructive/20",
    textClass: "text-destructive",
  },
};

export const ModeBanner = ({ view, platformName }: ModeBannerProps) => {
  const config = MODE_CONFIG[view];
  
  if (!config) return null;
  
  const title = platformName && view === 'social' 
    ? `${platformName} Preview Mode` 
    : config.title;

  return (
    <div className={`px-4 py-3 border-b ${config.bgClass}`}>
      <div className="flex items-start gap-2">
        <span className={`flex-shrink-0 mt-0.5 ${config.textClass}`}>
          {config.icon}
        </span>
        <div>
          <p className={`text-sm font-medium ${config.textClass}`}>
            {title}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {config.description}
          </p>
        </div>
      </div>
    </div>
  );
};

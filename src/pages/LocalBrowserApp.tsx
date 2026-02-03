import { useState } from "react";
import { Globe, Settings, Shield, FileText, List } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import LocalSafeBrowser from "@/pages/LocalSafeBrowser";
import { ImageScanner } from "@/components/browser/ImageScanner";
import { BlocklistManager } from "@/components/browser/BlocklistManager";
import LocalSettingsPanel from "@/components/browser/LocalSettingsPanel";
import { LocalLogsPanel } from "@/components/browser/LocalLogsPanel";

const LocalBrowserApp = () => {
  const [activeTab, setActiveTab] = useState("browser");

  return (
    <div className="min-h-screen bg-background">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-screen flex flex-col">
        {/* Main content area */}
        <div className="flex-1 overflow-hidden">
          <TabsContent value="browser" className="h-full m-0">
            <LocalSafeBrowser />
          </TabsContent>
          
          <TabsContent value="scanner" className="h-full m-0 overflow-y-auto pb-20">
            <div className="max-w-2xl mx-auto">
              <ImageScanner />
            </div>
          </TabsContent>
          
          <TabsContent value="blocklist" className="h-full m-0 overflow-y-auto pb-20">
            <div className="max-w-2xl mx-auto">
              <BlocklistManager />
            </div>
          </TabsContent>
          
          <TabsContent value="settings" className="h-full m-0 overflow-y-auto pb-20">
            <div className="max-w-2xl mx-auto">
              <LocalSettingsPanel />
            </div>
          </TabsContent>
          
          <TabsContent value="logs" className="h-full m-0 overflow-y-auto pb-20">
            <div className="max-w-2xl mx-auto">
              <LocalLogsPanel />
            </div>
          </TabsContent>
        </div>

        {/* Bottom tab bar */}
        <TabsList className="fixed bottom-0 left-0 right-0 h-16 rounded-none border-t border-border bg-card/95 backdrop-blur-sm grid grid-cols-5 gap-0">
          <TabsTrigger 
            value="browser" 
            className="flex flex-col items-center gap-1 h-full data-[state=active]:text-aqua data-[state=active]:bg-transparent"
          >
            <Globe className="w-5 h-5" />
            <span className="text-xs font-display tracking-wider">BROWSE</span>
          </TabsTrigger>
          
          <TabsTrigger 
            value="scanner" 
            className="flex flex-col items-center gap-1 h-full data-[state=active]:text-aqua data-[state=active]:bg-transparent"
          >
            <Shield className="w-5 h-5" />
            <span className="text-xs font-display tracking-wider">SCAN</span>
          </TabsTrigger>
          
          <TabsTrigger 
            value="blocklist" 
            className="flex flex-col items-center gap-1 h-full data-[state=active]:text-aqua data-[state=active]:bg-transparent"
          >
            <List className="w-5 h-5" />
            <span className="text-xs font-display tracking-wider">BLOCK</span>
          </TabsTrigger>
          
          <TabsTrigger 
            value="logs" 
            className="flex flex-col items-center gap-1 h-full data-[state=active]:text-aqua data-[state=active]:bg-transparent"
          >
            <FileText className="w-5 h-5" />
            <span className="text-xs font-display tracking-wider">LOGS</span>
          </TabsTrigger>
          
          <TabsTrigger 
            value="settings" 
            className="flex flex-col items-center gap-1 h-full data-[state=active]:text-aqua data-[state=active]:bg-transparent"
          >
            <Settings className="w-5 h-5" />
            <span className="text-xs font-display tracking-wider">CONFIG</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
};

export default LocalBrowserApp;

import { createContext, useContext, useState, ReactNode, useCallback } from "react";

interface SidebarContextType {
  isHovered: boolean;
  setHovered: (hovered: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [isHovered, setIsHovered] = useState(false);

  const setHovered = useCallback((hovered: boolean) => setIsHovered(hovered), []);

  return (
    <SidebarContext.Provider value={{ isHovered, setHovered }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar() {
  const context = useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

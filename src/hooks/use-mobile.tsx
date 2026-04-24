import * as React from "react";

// Alles unter 1024px (< lg) behandeln wir als mobile. Bei 768-1023px (md-Tablet)
// waere die fixed Sidebar mit w-64 zu breit — das Content-Area bekommt nur noch
// ~500px. Deshalb: Sheet-Drawer bis lg, ab lg volle Sidebar.
const MOBILE_BREAKPOINT = 1024;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}

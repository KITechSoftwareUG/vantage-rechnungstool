import { Upload, FileText, CreditCard, Building2, LayoutDashboard } from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Upload", url: "/upload", icon: Upload },
  { title: "Rechnungen", url: "/invoices", icon: FileText },
  { title: "Kontoauszüge", url: "/statements", icon: Building2 },
];

export function AppSidebar() {
  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Logo */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-primary">
          <FileText className="h-5 w-5 text-primary-foreground" />
        </div>
        <span className="font-heading text-lg font-semibold text-foreground">DocVault</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 p-4">
        {navItems.map((item, index) => (
          <NavLink
            key={item.title}
            to={item.url}
            end={item.url === "/"}
            className={cn(
              "group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-foreground/70 transition-all duration-200 hover:bg-sidebar-accent hover:text-sidebar-foreground",
              "animate-slide-in-left opacity-0"
            )}
            activeClassName="bg-sidebar-accent text-sidebar-primary shadow-sm"
            style={{ animationDelay: `${index * 0.05}s` }}
          >
            <item.icon className="h-5 w-5 transition-colors group-hover:text-sidebar-primary" />
            <span>{item.title}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-sidebar-border p-4">
        <div className="glass-card p-4">
          <p className="text-xs text-muted-foreground">
            Dokumente sicher verwalten mit KI-gestützter OCR-Erkennung
          </p>
        </div>
      </div>
    </aside>
  );
}

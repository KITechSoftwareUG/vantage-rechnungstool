import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { 
  Copy, 
  Check, 
  Link2, 
  ArrowDownLeft, 
  ArrowUpRight, 
  Building, 
  CreditCard,
  Receipt,
  Wallet,
  ChevronDown,
  ChevronRight
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;

const MONTHS = [
  { value: 1, label: "Januar" },
  { value: 2, label: "Februar" },
  { value: 3, label: "März" },
  { value: 4, label: "April" },
  { value: 5, label: "Mai" },
  { value: 6, label: "Juni" },
  { value: 7, label: "Juli" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "Oktober" },
  { value: 11, label: "November" },
  { value: 12, label: "Dezember" },
];

interface EndpointInfo {
  category: string;
  label: string;
  icon: React.ElementType;
  requiresMonth: boolean;
}

const ENDPOINTS: EndpointInfo[] = [
  { category: "incoming", label: "Eingangsrechnungen", icon: ArrowDownLeft, requiresMonth: true },
  { category: "outgoing", label: "Ausgangsrechnungen", icon: ArrowUpRight, requiresMonth: true },
  { category: "volksbank", label: "Volksbank", icon: Building, requiresMonth: false },
  { category: "amex", label: "American Express", icon: CreditCard, requiresMonth: false },
  { category: "commission", label: "Provisionsabrechnung", icon: Receipt, requiresMonth: false },
  { category: "cash", label: "Kasse", icon: Wallet, requiresMonth: false },
];

export function EndpointUrlsCard() {
  const { user } = useAuth();
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});

  const years = [currentYear - 1, currentYear, currentYear + 1];

  const getEndpointUrl = (category: string, month?: number) => {
    const basePath = month 
      ? `${category}/${selectedYear}/${String(month).padStart(2, "0")}`
      : `${category}/${selectedYear}`;
    
    return `${SUPABASE_URL}/functions/v1/n8n-webhook/${basePath}?user_id=${user?.id || "YOUR_USER_ID"}`;
  };

  const copyToClipboard = async (url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedUrl(url);
    setTimeout(() => setCopiedUrl(null), 2000);
  };

  const toggleCategory = (category: string) => {
    setExpandedCategories(prev => ({
      ...prev,
      [category]: !prev[category]
    }));
  };

  const renderEndpointRow = (category: string, label: string, month?: number, Icon?: React.ElementType) => {
    const url = getEndpointUrl(category, month);
    const displayLabel = month ? MONTHS.find(m => m.value === month)?.label : label;
    
    return (
      <div 
        key={`${category}-${month || "base"}`}
        className="flex items-center gap-2 rounded-md border bg-muted/30 p-2"
      >
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">{displayLabel}</p>
          <p className="truncate text-xs font-mono text-muted-foreground">
            /{category}/{selectedYear}{month ? `/${String(month).padStart(2, "0")}` : ""}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 h-8 w-8"
          onClick={() => copyToClipboard(url)}
        >
          {copiedUrl === url ? (
            <Check className="h-4 w-4 text-primary" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Link2 className="h-5 w-5" />
              n8n Webhook Endpoints
            </CardTitle>
            <CardDescription className="mt-1">
              Verwende diese URLs in deinem n8n Workflow
            </CardDescription>
          </div>
          <Select value={String(selectedYear)} onValueChange={(v) => setSelectedYear(parseInt(v))}>
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map(year => (
                <SelectItem key={year} value={String(year)}>
                  {year}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        <div className="mb-4 rounded-lg bg-accent/50 p-3 text-sm border border-accent">
          <p className="font-medium text-accent-foreground">API-Key erforderlich</p>
          <p className="mt-1 text-muted-foreground">
            Füge den Header <code className="rounded bg-muted px-1">x-api-key</code> zu deinen n8n Requests hinzu.
          </p>
        </div>

        <Tabs defaultValue="invoices" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="invoices" className="flex-1">Rechnungen</TabsTrigger>
            <TabsTrigger value="statements" className="flex-1">Kontoauszüge</TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="mt-4">
            <ScrollArea className="h-[350px] pr-4">
              <div className="space-y-3">
                {ENDPOINTS.filter(e => e.requiresMonth).map(endpoint => (
                  <Collapsible 
                    key={endpoint.category}
                    open={expandedCategories[endpoint.category]}
                    onOpenChange={() => toggleCategory(endpoint.category)}
                  >
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" className="w-full justify-between p-3 h-auto">
                        <div className="flex items-center gap-2">
                          <endpoint.icon className="h-4 w-4" />
                          <span className="font-medium">{endpoint.label}</span>
                          <Badge variant="secondary" className="text-xs">12 Endpoints</Badge>
                        </div>
                        {expandedCategories[endpoint.category] ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pl-6 pt-2">
                      {MONTHS.map(month => renderEndpointRow(endpoint.category, month.label, month.value))}
                    </CollapsibleContent>
                  </Collapsible>
                ))}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="statements" className="mt-4">
            <div className="space-y-2">
              {ENDPOINTS.filter(e => !e.requiresMonth).map(endpoint => 
                renderEndpointRow(endpoint.category, endpoint.label, undefined, endpoint.icon)
              )}
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
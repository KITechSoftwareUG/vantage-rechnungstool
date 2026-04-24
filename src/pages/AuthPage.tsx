import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTheme } from "next-themes";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Mail, Lock, Loader2, ArrowLeft } from "lucide-react";
import { isAllowed } from "@/lib/allowlist";
import logoDarkmode from "@/assets/logo_darkmode.png";
import logoLightmode from "@/assets/logo_lightmode.png";


export default function AuthPage() {
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const { resolvedTheme } = useTheme();

  const logoSrc = resolvedTheme === "dark" ? logoDarkmode : logoLightmode;

  useEffect(() => {
    const checkInviteFlow = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        const type = searchParams.get("type");
        const tokenHash = searchParams.get("token_hash");
        
        if (tokenHash && (type === "invite" || type === "signup" || type === "recovery")) {
          const { data, error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: type === "invite" ? "invite" : type === "recovery" ? "recovery" : "signup",
          });
          
          if (!error && data.session) {
            setIsSettingPassword(true);
            setEmail(data.session.user.email || "");
          }
        } else if (session) {
          navigate("/");
        }
      } catch (error) {
        console.error("Error checking session:", error);
      } finally {
        setIsCheckingSession(false);
      }
    };

    checkInviteFlow();
  }, [navigate, searchParams]);

  const handleSetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast({
        title: "Fehler",
        description: "Die Passwörter stimmen nicht überein",
        variant: "destructive",
      });
      return;
    }

    if (password.length < 6) {
      toast({
        title: "Fehler",
        description: "Das Passwort muss mindestens 6 Zeichen lang sein",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password: password,
      });

      if (error) throw error;

      toast({ title: "Passwort erfolgreich gesetzt" });
      navigate("/");
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth`,
      });

      if (error) throw error;

      toast({
        title: "E-Mail gesendet",
        description: "Prüfen Sie Ihre E-Mails für den Link zum Zurücksetzen des Passworts",
      });
      setIsForgotPassword(false);
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) throw error;
      if (!isAllowed(data.user?.email)) {
        await supabase.auth.signOut();
        toast({
          title: "Kein Zugriff",
          description: "Dieser Account hat keine Berechtigung für dieses Tool.",
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Erfolgreich angemeldet" });
      navigate("/");
    } catch (error: any) {
      toast({
        title: "Fehler",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {/* Background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 right-0 h-[500px] w-[500px] rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 left-1/4 h-[400px] w-[400px] rounded-full bg-primary/3 blur-3xl" />
      </div>

      <div className="relative z-10 w-full max-w-md animate-fade-in">
        <div className="glass-card p-8">
          {/* Logo */}
          <div className="mb-8 flex flex-col items-center">
            <img src={logoSrc} alt="Logo" className="h-14 w-auto" />
            <h1 className="mt-4 font-heading text-2xl font-bold text-foreground">
              Matching Tool
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isSettingPassword
                ? "Neues Passwort vergeben"
                : isForgotPassword
                ? "Passwort zurücksetzen"
                : "Melden Sie sich an"}
            </p>
          </div>

          {isSettingPassword ? (
            <form onSubmit={handleSetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    disabled
                    className="pl-9 bg-muted"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Neues Passwort</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    minLength={6}
                    required
                    autoFocus
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Passwort bestätigen</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="pl-9"
                    minLength={6}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="gradient"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Passwort speichern
              </Button>
            </form>
          ) : isForgotPassword ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">E-Mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ihre@email.de"
                    className="pl-9"
                    required
                    autoFocus
                  />
                </div>
              </div>

              <Button
                type="submit"
                variant="gradient"
                className="w-full"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Link senden
              </Button>

              <button
                type="button"
                onClick={() => setIsForgotPassword(false)}
                className="flex w-full items-center justify-center gap-2 text-sm text-muted-foreground hover:text-primary"
              >
                <ArrowLeft className="h-4 w-4" />
                Zurück zur Anmeldung
              </button>
            </form>
          ) : (
            <>
              <form onSubmit={handleLogin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">E-Mail</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ihre@email.de"
                      className="pl-9"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Passwort</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="pl-9"
                      minLength={6}
                      required
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  variant="gradient"
                  className="w-full"
                  disabled={isLoading}
                >
                  {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Anmelden
                </Button>
              </form>


              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setIsForgotPassword(true)}
                  className="text-sm text-muted-foreground hover:text-primary"
                >
                  Passwort vergessen?
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

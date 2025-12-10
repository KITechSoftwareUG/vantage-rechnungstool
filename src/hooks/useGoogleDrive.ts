import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

interface GoogleDriveState {
  isConnected: boolean;
  isLoading: boolean;
  accessToken: string | null;
}

export function useGoogleDrive() {
  const { user } = useAuth();
  const [state, setState] = useState<GoogleDriveState>({
    isConnected: false,
    isLoading: true,
    accessToken: null,
  });

  const checkConnection = useCallback(async () => {
    if (!user) {
      setState({ isConnected: false, isLoading: false, accessToken: null });
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "get-access-token" },
      });

      if (response.error) {
        throw response.error;
      }

      setState({
        isConnected: response.data.connected,
        isLoading: false,
        accessToken: response.data.accessToken || null,
      });
    } catch (error) {
      console.error("Error checking Google Drive connection:", error);
      setState({ isConnected: false, isLoading: false, accessToken: null });
    }
  }, [user]);

  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  const connect = useCallback(async () => {
    try {
      const redirectUri = `${window.location.origin}/upload`;
      
      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "get-auth-url", redirectUri },
      });

      if (response.error) {
        throw response.error;
      }

      // Store redirect URI for callback
      localStorage.setItem("google_drive_redirect_uri", redirectUri);
      
      // Redirect to Google OAuth
      window.location.href = response.data.authUrl;
    } catch (error) {
      console.error("Error starting Google Drive auth:", error);
      throw error;
    }
  }, []);

  const handleCallback = useCallback(async (code: string) => {
    try {
      const redirectUri = localStorage.getItem("google_drive_redirect_uri");
      if (!redirectUri) {
        throw new Error("Missing redirect URI");
      }

      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "exchange-code", code, redirectUri },
      });

      if (response.error) {
        throw response.error;
      }

      localStorage.removeItem("google_drive_redirect_uri");
      
      // Refresh connection state
      await checkConnection();
      
      return true;
    } catch (error) {
      console.error("Error exchanging Google auth code:", error);
      throw error;
    }
  }, [checkConnection]);

  const disconnect = useCallback(async () => {
    try {
      const response = await supabase.functions.invoke("google-drive-auth", {
        body: { action: "disconnect" },
      });

      if (response.error) {
        throw response.error;
      }

      setState({ isConnected: false, isLoading: false, accessToken: null });
    } catch (error) {
      console.error("Error disconnecting Google Drive:", error);
      throw error;
    }
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    handleCallback,
    checkConnection,
  };
}

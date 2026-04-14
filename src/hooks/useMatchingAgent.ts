import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type AgentAction = "match" | "recurring" | "ignored" | "no_match" | "ask";

export interface AgentCandidate {
  nummer: number;
  invoiceId: string;
  issuer: string;
  amount: number;
  currency: string;
  date: string;
  file: string | null;
  invoiceNumber: string | null;
  type: string | null;
}

export interface AgentResponse {
  action: AgentAction;
  invoiceId: string | null;
  confidence: number;
  message: string;
  followUp?: string;
  topCandidates: AgentCandidate[];
}

export interface AgentRequest {
  transactionId: string;
  userMessage: string;
  chatHistory: { role: "user" | "assistant"; content: string }[];
}

export function useMatchingAgent() {
  return useMutation<AgentResponse, Error, AgentRequest>({
    mutationFn: async (payload) => {
      const { data, error } = await supabase.functions.invoke("matching-agent", {
        body: payload,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as AgentResponse;
    },
  });
}

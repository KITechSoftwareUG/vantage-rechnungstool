export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      bank_statements: {
        Row: {
          account_number: string
          bank: string
          bank_type: string
          closing_balance: number
          created_at: string
          date: string
          file_name: string
          file_url: string | null
          id: string
          month: number
          opening_balance: number
          source_endpoint: string | null
          status: string
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          account_number: string
          bank: string
          bank_type?: string
          closing_balance: number
          created_at?: string
          date: string
          file_name: string
          file_url?: string | null
          id?: string
          month: number
          opening_balance: number
          source_endpoint?: string | null
          status?: string
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          account_number?: string
          bank?: string
          bank_type?: string
          closing_balance?: number
          created_at?: string
          date?: string
          file_name?: string
          file_url?: string | null
          id?: string
          month?: number
          opening_balance?: number
          source_endpoint?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      bank_transactions: {
        Row: {
          amount: number
          bank_statement_id: string | null
          created_at: string
          date: string
          description: string
          id: string
          match_confidence: number | null
          match_status: string
          matched_invoice_id: string | null
          original_currency: string | null
          transaction_type: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          bank_statement_id?: string | null
          created_at?: string
          date: string
          description: string
          id?: string
          match_confidence?: number | null
          match_status?: string
          matched_invoice_id?: string | null
          original_currency?: string | null
          transaction_type?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          bank_statement_id?: string | null
          created_at?: string
          date?: string
          description?: string
          id?: string
          match_confidence?: number | null
          match_status?: string
          matched_invoice_id?: string | null
          original_currency?: string | null
          transaction_type?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_bank_statement_id_fkey"
            columns: ["bank_statement_id"]
            isOneToOne: false
            referencedRelation: "bank_statements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_matched_invoice_id_fkey"
            columns: ["matched_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      document_ingestion_log: {
        Row: {
          created_at: string
          document_id: string | null
          document_type: string
          endpoint_category: string
          endpoint_month: number | null
          endpoint_year: number
          error_message: string | null
          file_name: string
          id: string
          status: string
          user_id: string
          warning_message: string | null
        }
        Insert: {
          created_at?: string
          document_id?: string | null
          document_type: string
          endpoint_category: string
          endpoint_month?: number | null
          endpoint_year: number
          error_message?: string | null
          file_name: string
          id?: string
          status?: string
          user_id: string
          warning_message?: string | null
        }
        Update: {
          created_at?: string
          document_id?: string | null
          document_type?: string
          endpoint_category?: string
          endpoint_month?: number | null
          endpoint_year?: number
          error_message?: string | null
          file_name?: string
          id?: string
          status?: string
          user_id?: string
          warning_message?: string | null
        }
        Relationships: []
      }
      google_drive_tokens: {
        Row: {
          access_token: string
          created_at: string
          expires_at: string
          id: string
          refresh_token: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          created_at?: string
          expires_at: string
          id?: string
          refresh_token: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          created_at?: string
          expires_at?: string
          id?: string
          refresh_token?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      invoices: {
        Row: {
          amount: number
          created_at: string
          currency: string
          date: string
          file_name: string
          file_url: string | null
          id: string
          invoice_number: string | null
          issuer: string
          month: number
          payment_method: string
          source_endpoint: string | null
          status: string
          type: string
          updated_at: string
          user_id: string
          year: number
        }
        Insert: {
          amount: number
          created_at?: string
          currency?: string
          date: string
          file_name: string
          file_url?: string | null
          id?: string
          invoice_number?: string | null
          issuer: string
          month: number
          payment_method?: string
          source_endpoint?: string | null
          status?: string
          type: string
          updated_at?: string
          user_id: string
          year: number
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          date?: string
          file_name?: string
          file_url?: string | null
          id?: string
          invoice_number?: string | null
          issuer?: string
          month?: number
          payment_method?: string
          source_endpoint?: string | null
          status?: string
          type?: string
          updated_at?: string
          user_id?: string
          year?: number
        }
        Relationships: []
      }
      processed_drive_files: {
        Row: {
          created_at: string
          drive_file_id: string
          file_name: string
          folder_type: string
          id: string
          processed_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          drive_file_id: string
          file_name: string
          folder_type: string
          id?: string
          processed_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          drive_file_id?: string
          file_name?: string
          folder_type?: string
          id?: string
          processed_at?: string
          user_id?: string
        }
        Relationships: []
      }
      recurring_patterns: {
        Row: {
          created_at: string
          description_pattern: string
          id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          description_pattern: string
          id?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          description_pattern?: string
          id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

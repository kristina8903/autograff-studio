export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: { Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json }; Returns: Json };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      audit_events: {
        Row: {
          action: string;
          actor_kind: Database["public"]["Enums"]["actor_kind"];
          actor_user_id: string | null;
          company_id: string | null;
          entity_id: string | null;
          entity_type: string | null;
          id: number;
          occurred_at: string;
          summary: NonNullable<Json>;
        };
        ComputedFields: never;
        Insert: {
          action: string;
          actor_kind: Database["public"]["Enums"]["actor_kind"];
          actor_user_id?: string | null;
          company_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          occurred_at?: string;
          summary?: NonNullable<Json>;
        };
        Update: {
          action?: string;
          actor_kind?: Database["public"]["Enums"]["actor_kind"];
          actor_user_id?: string | null;
          company_id?: string | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: never;
          occurred_at?: string;
          summary?: NonNullable<Json>;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          slug: string;
        };
        ComputedFields: never;
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          slug: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          slug?: string;
        };
        Relationships: [];
      };
      founder_visibility_grants: {
        Row: {
          company_id: string;
          created_at: string;
          expires_at: string | null;
          granted_by: string | null;
          grantee_founder_id: string;
          id: string;
          scope: Database["public"]["Enums"]["visibility_scope"];
          subject_founder_id: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          grantee_founder_id: string;
          id?: string;
          scope: Database["public"]["Enums"]["visibility_scope"];
          subject_founder_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          expires_at?: string | null;
          granted_by?: string | null;
          grantee_founder_id?: string;
          id?: string;
          scope?: Database["public"]["Enums"]["visibility_scope"];
          subject_founder_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "founder_visibility_grants_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "founder_visibility_grants_granted_by_fkey";
            columns: ["granted_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "founder_visibility_grants_grantee_founder_id_fkey";
            columns: ["grantee_founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "founder_visibility_grants_subject_founder_id_fkey";
            columns: ["subject_founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
        ];
      };
      founders: {
        Row: {
          active: boolean;
          company_id: string;
          created_at: string;
          created_by: string | null;
          display_name: string;
          id: string;
          linkedin_profile_url: string | null;
          role_title: string;
          timezone: string;
          updated_at: string;
          user_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          active?: boolean;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          display_name: string;
          id?: string;
          linkedin_profile_url?: string | null;
          role_title: string;
          timezone?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          active?: boolean;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          display_name?: string;
          id?: string;
          linkedin_profile_url?: string | null;
          role_title?: string;
          timezone?: string;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "founders_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "founders_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "founders_user_id_fkey";
            columns: ["user_id"];
            isOneToOne: true;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      profiles: {
        Row: {
          activated_at: string | null;
          company_id: string;
          created_at: string;
          deactivated_at: string | null;
          display_name: string;
          email: string;
          invited_by: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status: Database["public"]["Enums"]["user_status"];
          updated_at: string;
          user_id: string;
        };
        ComputedFields: never;
        Insert: {
          activated_at?: string | null;
          company_id: string;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string;
          email: string;
          invited_by?: string | null;
          role: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["user_status"];
          updated_at?: string;
          user_id: string;
        };
        Update: {
          activated_at?: string | null;
          company_id?: string;
          created_at?: string;
          deactivated_at?: string | null;
          display_name?: string;
          email?: string;
          invited_by?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          status?: Database["public"]["Enums"]["user_status"];
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "profiles_invited_by_fkey";
            columns: ["invited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      settings: {
        Row: {
          allowed_email_domains: string[];
          company_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          allowed_email_domains?: string[];
          company_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          allowed_email_domains?: string[];
          company_id?: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "settings_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "settings_updated_by_fkey";
            columns: ["updated_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      admin_deactivate_user: { Args: { p_user_id: string }; Returns: undefined };
      admin_set_user_role: {
        Args: { p_role: Database["public"]["Enums"]["user_role"]; p_user_id: string };
        Returns: undefined;
      };
      provision_invited_user: {
        Args: {
          p_founder_id?: string;
          p_invited_by: string;
          p_role: Database["public"]["Enums"]["user_role"];
          p_user_id: string;
        };
        Returns: undefined;
      };
      record_sign_in: { Args: Record<PropertyKey, never>; Returns: Database["public"]["Enums"]["user_status"] };
    };
    Enums: {
      actor_kind: "user" | "system" | "job";
      user_role: "admin" | "founder";
      user_status: "invited" | "active" | "deactivated";
      visibility_scope: "calendar" | "approved_content" | "drafts";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    keyof (DefaultSchema["Tables"] & DefaultSchema["Views"]) | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      actor_kind: ["user", "system", "job"],
      user_role: ["admin", "founder"],
      user_status: ["invited", "active", "deactivated"],
      visibility_scope: ["calendar", "approved_content", "drafts"],
    },
  },
} as const;

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
      brief_versions: {
        Row: {
          approved_facts: NonNullable<Json>;
          brief_id: string;
          change_note: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at: string;
          created_by: string | null;
          founder_emphasis: NonNullable<Json>;
          id: string;
          version_no: number;
        };
        ComputedFields: never;
        Insert: {
          approved_facts?: NonNullable<Json>;
          brief_id: string;
          change_note?: string;
          company_id: string;
          content: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          founder_emphasis?: NonNullable<Json>;
          id?: string;
          version_no: number;
        };
        Update: {
          approved_facts?: NonNullable<Json>;
          brief_id?: string;
          change_note?: string;
          company_id?: string;
          content?: NonNullable<Json>;
          created_at?: string;
          created_by?: string | null;
          founder_emphasis?: NonNullable<Json>;
          id?: string;
          version_no?: number;
        };
        Relationships: [
          {
            foreignKeyName: "brief_versions_brief_id_fkey";
            columns: ["brief_id"];
            isOneToOne: false;
            referencedRelation: "monthly_briefs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brief_versions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "brief_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      cadence_rules: {
        Row: {
          buffer_target: number;
          candidate_target_max: number;
          candidate_target_min: number;
          change_reason: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          effective_from: string;
          effective_to: string | null;
          founder_id: string;
          id: string;
          low_buffer_threshold: number;
          max_posts: number;
          min_posts: number;
          period: Database["public"]["Enums"]["cadence_period"];
          preferred_local_time: string | null;
          publishing_days: number[];
          reserved_timely_slots_per_month: number;
          weekly_pattern: number[] | null;
        };
        ComputedFields: never;
        Insert: {
          buffer_target?: number;
          candidate_target_max?: number;
          candidate_target_min?: number;
          change_reason?: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          effective_from: string;
          effective_to?: string | null;
          founder_id: string;
          id?: string;
          low_buffer_threshold?: number;
          max_posts: number;
          min_posts: number;
          period: Database["public"]["Enums"]["cadence_period"];
          preferred_local_time?: string | null;
          publishing_days: number[];
          reserved_timely_slots_per_month?: number;
          weekly_pattern?: number[] | null;
        };
        Update: {
          buffer_target?: number;
          candidate_target_max?: number;
          candidate_target_min?: number;
          change_reason?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          effective_from?: string;
          effective_to?: string | null;
          founder_id?: string;
          id?: string;
          low_buffer_threshold?: number;
          max_posts?: number;
          min_posts?: number;
          period?: Database["public"]["Enums"]["cadence_period"];
          preferred_local_time?: string | null;
          publishing_days?: number[];
          reserved_timely_slots_per_month?: number;
          weekly_pattern?: number[] | null;
        };
        Relationships: [
          {
            foreignKeyName: "cadence_rules_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "cadence_rules_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "cadence_rules_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
        ];
      };
      calendar_slots: {
        Row: {
          cadence_rule_id: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          draft_id: string | null;
          founder_id: string;
          id: string;
          kind: Database["public"]["Enums"]["slot_kind"];
          note: string;
          ordinal: number;
          slot_date: string;
          status: Database["public"]["Enums"]["slot_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          cadence_rule_id?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          draft_id?: string | null;
          founder_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["slot_kind"];
          note?: string;
          ordinal?: number;
          slot_date: string;
          status?: Database["public"]["Enums"]["slot_status"];
          updated_at?: string;
        };
        Update: {
          cadence_rule_id?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          draft_id?: string | null;
          founder_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["slot_kind"];
          note?: string;
          ordinal?: number;
          slot_date?: string;
          status?: Database["public"]["Enums"]["slot_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "calendar_slots_cadence_rule_id_fkey";
            columns: ["cadence_rule_id"];
            isOneToOne: false;
            referencedRelation: "cadence_rules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_slots_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "calendar_slots_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "calendar_slots_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
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
      feedback_signals: {
        Row: {
          applied_voice_profile_version_id: string | null;
          comment_id: string | null;
          company_id: string;
          created_at: string;
          created_by: string | null;
          draft_version_id: string | null;
          format: Database["public"]["Enums"]["post_format"] | null;
          founder_id: string;
          id: string;
          kind: Database["public"]["Enums"]["feedback_kind"];
          proposed_by: Database["public"]["Enums"]["feedback_proposer"];
          review_note: string;
          reviewed_at: string | null;
          reviewed_by: string | null;
          statement: string;
          status: Database["public"]["Enums"]["feedback_status"];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          applied_voice_profile_version_id?: string | null;
          comment_id?: string | null;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          draft_version_id?: string | null;
          format?: Database["public"]["Enums"]["post_format"] | null;
          founder_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["feedback_kind"];
          proposed_by: Database["public"]["Enums"]["feedback_proposer"];
          review_note?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          statement: string;
          status?: Database["public"]["Enums"]["feedback_status"];
          updated_at?: string;
        };
        Update: {
          applied_voice_profile_version_id?: string | null;
          comment_id?: string | null;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          draft_version_id?: string | null;
          format?: Database["public"]["Enums"]["post_format"] | null;
          founder_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["feedback_kind"];
          proposed_by?: Database["public"]["Enums"]["feedback_proposer"];
          review_note?: string;
          reviewed_at?: string | null;
          reviewed_by?: string | null;
          statement?: string;
          status?: Database["public"]["Enums"]["feedback_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_signals_applied_voice_profile_version_id_fkey";
            columns: ["applied_voice_profile_version_id"];
            isOneToOne: false;
            referencedRelation: "voice_profile_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_signals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_signals_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "feedback_signals_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "feedback_signals_reviewed_by_fkey";
            columns: ["reviewed_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
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
      monthly_briefs: {
        Row: {
          company_id: string;
          created_at: string;
          created_by: string | null;
          current_version_id: string | null;
          id: string;
          month: string;
          title: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          id?: string;
          month: string;
          title?: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          id?: string;
          month?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "monthly_briefs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "monthly_briefs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "monthly_briefs_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "brief_versions";
            referencedColumns: ["id"];
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
      voice_profile_versions: {
        Row: {
          attributes: NonNullable<Json>;
          avoid_phrases: string[];
          change_reason: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          expertise_topics: string[];
          format_preferences: NonNullable<Json>;
          founder_id: string;
          id: string;
          notes: string;
          preferred_phrases: string[];
          profile_id: string;
          source_feedback_ids: string[];
          style_rules: string[];
          version_no: number;
          writing_habits: string[];
        };
        ComputedFields: never;
        Insert: {
          attributes?: NonNullable<Json>;
          avoid_phrases?: string[];
          change_reason: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          expertise_topics?: string[];
          format_preferences?: NonNullable<Json>;
          founder_id: string;
          id?: string;
          notes?: string;
          preferred_phrases?: string[];
          profile_id: string;
          source_feedback_ids?: string[];
          style_rules?: string[];
          version_no: number;
          writing_habits?: string[];
        };
        Update: {
          attributes?: NonNullable<Json>;
          avoid_phrases?: string[];
          change_reason?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          expertise_topics?: string[];
          format_preferences?: NonNullable<Json>;
          founder_id?: string;
          id?: string;
          notes?: string;
          preferred_phrases?: string[];
          profile_id?: string;
          source_feedback_ids?: string[];
          style_rules?: string[];
          version_no?: number;
          writing_habits?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "voice_profile_versions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_profile_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "voice_profile_versions_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_profile_versions_profile_id_fkey";
            columns: ["profile_id"];
            isOneToOne: false;
            referencedRelation: "voice_profiles";
            referencedColumns: ["id"];
          },
        ];
      };
      voice_profiles: {
        Row: {
          company_id: string;
          created_at: string;
          current_version_id: string | null;
          founder_id: string;
          id: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          created_at?: string;
          current_version_id?: string | null;
          founder_id: string;
          id?: string;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          current_version_id?: string | null;
          founder_id?: string;
          id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "voice_profiles_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_profiles_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "voice_profile_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "voice_profiles_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: true;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
        ];
      };
      writing_examples: {
        Row: {
          added_by: string | null;
          approved_for_voice: boolean;
          body: string;
          body_hash: string | null;
          company_id: string;
          created_at: string;
          eval_holdout: boolean;
          format: Database["public"]["Enums"]["post_format"] | null;
          founder_id: string;
          id: string;
          kind: Database["public"]["Enums"]["writing_example_kind"];
          published_at: string | null;
          source_url: string | null;
          topics: string[];
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          added_by?: string | null;
          approved_for_voice?: boolean;
          body: string;
          body_hash?: never;
          company_id: string;
          created_at?: string;
          eval_holdout?: boolean;
          format?: Database["public"]["Enums"]["post_format"] | null;
          founder_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["writing_example_kind"];
          published_at?: string | null;
          source_url?: string | null;
          topics?: string[];
          updated_at?: string;
        };
        Update: {
          added_by?: string | null;
          approved_for_voice?: boolean;
          body?: string;
          body_hash?: never;
          company_id?: string;
          created_at?: string;
          eval_holdout?: boolean;
          format?: Database["public"]["Enums"]["post_format"] | null;
          founder_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["writing_example_kind"];
          published_at?: string | null;
          source_url?: string | null;
          topics?: string[];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "writing_examples_added_by_fkey";
            columns: ["added_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "writing_examples_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "writing_examples_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      add_feedback_signal: {
        Args: {
          p_format: Database["public"]["Enums"]["post_format"];
          p_founder_id: string;
          p_kind: Database["public"]["Enums"]["feedback_kind"];
          p_statement: string;
        };
        Returns: string;
      };
      add_manual_slot: {
        Args: { p_date: string; p_founder_id: string; p_note: string; p_today: string };
        Returns: string;
      };
      add_writing_examples: { Args: { p_founder_id: string; p_items: Json }; Returns: Json };
      admin_deactivate_user: { Args: { p_user_id: string }; Returns: undefined };
      admin_set_user_role: {
        Args: { p_role: Database["public"]["Enums"]["user_role"]; p_user_id: string };
        Returns: undefined;
      };
      coverage_slot_counts: {
        Args: { p_founder_id: string; p_month: string };
        Returns: {
          filled: number;
          open: number;
          required: number;
          reserved_timely: number;
          skipped: number;
        }[];
      };
      delete_writing_example: { Args: { p_example_id: string }; Returns: undefined };
      founder_brief: {
        Args: { p_month: string };
        Returns: {
          emphasis: string;
          month: string;
          theme: string;
          version_no: number;
        }[];
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
      review_feedback_signal: { Args: { p_decision: string; p_note: string; p_signal_id: string }; Returns: undefined };
      save_brief_version: {
        Args: {
          p_approved_facts: Json;
          p_change_note: string;
          p_content: Json;
          p_founder_emphasis: Json;
          p_month: string;
          p_title: string;
        };
        Returns: number;
      };
      save_voice_profile_version: {
        Args: {
          p_attributes: Json;
          p_avoid_phrases: string[];
          p_change_reason: string;
          p_expertise_topics: string[];
          p_feedback_ids: string[];
          p_format_preferences: Json;
          p_founder_id: string;
          p_notes: string;
          p_preferred_phrases: string[];
          p_style_rules: string[];
          p_writing_habits: string[];
        };
        Returns: number;
      };
      set_cadence_rule: {
        Args: {
          p_buffer_target: number;
          p_candidate_target_max: number;
          p_candidate_target_min: number;
          p_change_reason: string;
          p_effective_from: string;
          p_founder_id: string;
          p_low_buffer_threshold: number;
          p_max_posts: number;
          p_min_posts: number;
          p_period: Database["public"]["Enums"]["cadence_period"];
          p_publishing_days: number[];
          p_reserved_timely: number;
          p_today: string;
          p_weekly_pattern: number[];
        };
        Returns: string;
      };
      sync_calendar_slots: {
        Args: { p_founder_id: string; p_month: string; p_slots: Json; p_today: string };
        Returns: Json;
      };
      update_slot: {
        Args: { p_action: string; p_new_date: string; p_slot_id: string; p_today: string };
        Returns: string;
      };
      update_writing_example: {
        Args: {
          p_approved_for_voice: boolean;
          p_eval_holdout: boolean;
          p_example_id: string;
          p_format: Database["public"]["Enums"]["post_format"];
          p_topics: string[];
        };
        Returns: undefined;
      };
    };
    Enums: {
      actor_kind: "user" | "system" | "job";
      cadence_period: "week" | "month";
      feedback_kind: "stable_preference" | "format_preference" | "one_off" | "editorial_correction";
      feedback_proposer: "system" | "admin";
      feedback_status: "proposed" | "accepted" | "rejected";
      post_format:
        "story" | "opinion" | "how_to" | "data_insight" | "lesson" | "announcement" | "list" | "question" | "other";
      slot_kind: "regular" | "reserved_timely" | "manual";
      slot_status: "open" | "filled" | "skipped";
      user_role: "admin" | "founder";
      user_status: "invited" | "active" | "deactivated";
      visibility_scope: "calendar" | "approved_content" | "drafts";
      writing_example_kind: "published_linkedin" | "approved_example" | "slack_excerpt" | "other";
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
      cadence_period: ["week", "month"],
      feedback_kind: ["stable_preference", "format_preference", "one_off", "editorial_correction"],
      feedback_proposer: ["system", "admin"],
      feedback_status: ["proposed", "accepted", "rejected"],
      post_format: [
        "story",
        "opinion",
        "how_to",
        "data_insight",
        "lesson",
        "announcement",
        "list",
        "question",
        "other",
      ],
      slot_kind: ["regular", "reserved_timely", "manual"],
      slot_status: ["open", "filled", "skipped"],
      user_role: ["admin", "founder"],
      user_status: ["invited", "active", "deactivated"],
      visibility_scope: ["calendar", "approved_content", "drafts"],
      writing_example_kind: ["published_linkedin", "approved_example", "slack_excerpt", "other"],
    },
  },
} as const;

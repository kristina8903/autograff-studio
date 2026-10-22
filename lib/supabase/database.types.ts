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
      approvals: {
        Row: {
          approver_role: Database["public"]["Enums"]["user_role"];
          approver_user_id: string;
          body_hash: string;
          company_id: string;
          created_at: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          draft_id: string;
          draft_version_id: string;
          id: string;
          invalidated_at: string | null;
          invalidated_by_version_id: string | null;
          invalidated_reason: string | null;
          note: string;
          selected_hook: string | null;
        };
        ComputedFields: never;
        Insert: {
          approver_role: Database["public"]["Enums"]["user_role"];
          approver_user_id: string;
          body_hash: string;
          company_id: string;
          created_at?: string;
          decision: Database["public"]["Enums"]["approval_decision"];
          draft_id: string;
          draft_version_id: string;
          id?: string;
          invalidated_at?: string | null;
          invalidated_by_version_id?: string | null;
          invalidated_reason?: string | null;
          note?: string;
          selected_hook?: string | null;
        };
        Update: {
          approver_role?: Database["public"]["Enums"]["user_role"];
          approver_user_id?: string;
          body_hash?: string;
          company_id?: string;
          created_at?: string;
          decision?: Database["public"]["Enums"]["approval_decision"];
          draft_id?: string;
          draft_version_id?: string;
          id?: string;
          invalidated_at?: string | null;
          invalidated_by_version_id?: string | null;
          invalidated_reason?: string | null;
          note?: string;
          selected_hook?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "approvals_approver_user_id_fkey";
            columns: ["approver_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "approvals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_draft_version_id_fkey";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "approvals_invalidated_by_version_id_fkey";
            columns: ["invalidated_by_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
        ];
      };
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
      comments: {
        Row: {
          anchor: Json | null;
          author_role: Database["public"]["Enums"]["user_role"];
          author_user_id: string | null;
          body: string;
          company_id: string;
          created_at: string;
          draft_id: string;
          draft_version_id: string;
          id: string;
          resolved_at: string | null;
          resolved_by: string | null;
          visibility: Database["public"]["Enums"]["comment_visibility"];
        };
        ComputedFields: never;
        Insert: {
          anchor?: Json | null;
          author_role: Database["public"]["Enums"]["user_role"];
          author_user_id?: string | null;
          body: string;
          company_id: string;
          created_at?: string;
          draft_id: string;
          draft_version_id: string;
          id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          visibility: Database["public"]["Enums"]["comment_visibility"];
        };
        Update: {
          anchor?: Json | null;
          author_role?: Database["public"]["Enums"]["user_role"];
          author_user_id?: string | null;
          body?: string;
          company_id?: string;
          created_at?: string;
          draft_id?: string;
          draft_version_id?: string;
          id?: string;
          resolved_at?: string | null;
          resolved_by?: string | null;
          visibility?: Database["public"]["Enums"]["comment_visibility"];
        };
        Relationships: [
          {
            foreignKeyName: "comments_author_user_id_fkey";
            columns: ["author_user_id"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "comments_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_draft_version_id_fkey";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "comments_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
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
      concepts: {
        Row: {
          audience: string;
          brief_version_id: string;
          company_id: string;
          core_argument: string;
          created_at: string;
          edited_at: string | null;
          edited_by: string | null;
          evidence_requirements: string[];
          fingerprint: NonNullable<Json>;
          format: Database["public"]["Enums"]["post_format"];
          founder_id: string;
          generation_run_id: string | null;
          hook: string;
          id: string;
          needs_personal_story: boolean;
          status: Database["public"]["Enums"]["concept_status"];
          superseded_by: string | null;
          target_month: string;
          title: string;
          updated_at: string;
          voice_profile_version_id: string | null;
          why_this_founder: string;
        };
        ComputedFields: never;
        Insert: {
          audience?: string;
          brief_version_id: string;
          company_id: string;
          core_argument: string;
          created_at?: string;
          edited_at?: string | null;
          edited_by?: string | null;
          evidence_requirements?: string[];
          fingerprint?: NonNullable<Json>;
          format: Database["public"]["Enums"]["post_format"];
          founder_id: string;
          generation_run_id?: string | null;
          hook?: string;
          id?: string;
          needs_personal_story?: boolean;
          status?: Database["public"]["Enums"]["concept_status"];
          superseded_by?: string | null;
          target_month: string;
          title: string;
          updated_at?: string;
          voice_profile_version_id?: string | null;
          why_this_founder?: string;
        };
        Update: {
          audience?: string;
          brief_version_id?: string;
          company_id?: string;
          core_argument?: string;
          created_at?: string;
          edited_at?: string | null;
          edited_by?: string | null;
          evidence_requirements?: string[];
          fingerprint?: NonNullable<Json>;
          format?: Database["public"]["Enums"]["post_format"];
          founder_id?: string;
          generation_run_id?: string | null;
          hook?: string;
          id?: string;
          needs_personal_story?: boolean;
          status?: Database["public"]["Enums"]["concept_status"];
          superseded_by?: string | null;
          target_month?: string;
          title?: string;
          updated_at?: string;
          voice_profile_version_id?: string | null;
          why_this_founder?: string;
        };
        Relationships: [
          {
            foreignKeyName: "concepts_brief_version_id_fkey";
            columns: ["brief_version_id"];
            isOneToOne: false;
            referencedRelation: "brief_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concepts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concepts_edited_by_fkey";
            columns: ["edited_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "concepts_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concepts_generation_run_id_fkey";
            columns: ["generation_run_id"];
            isOneToOne: false;
            referencedRelation: "generation_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concepts_superseded_by_fkey";
            columns: ["superseded_by"];
            isOneToOne: false;
            referencedRelation: "concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "concepts_voice_profile_version_id_fkey";
            columns: ["voice_profile_version_id"];
            isOneToOne: false;
            referencedRelation: "voice_profile_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_claims: {
        Row: {
          approved_fact: string | null;
          claim_kind: Database["public"]["Enums"]["claim_kind"];
          claim_text: string;
          company_id: string;
          draft_version_id: string;
          finding_id: string | null;
          id: string;
          span_end: number | null;
          span_start: number | null;
          support_status: Database["public"]["Enums"]["claim_support"];
        };
        ComputedFields: never;
        Insert: {
          approved_fact?: string | null;
          claim_kind: Database["public"]["Enums"]["claim_kind"];
          claim_text: string;
          company_id: string;
          draft_version_id: string;
          finding_id?: string | null;
          id?: string;
          span_end?: number | null;
          span_start?: number | null;
          support_status: Database["public"]["Enums"]["claim_support"];
        };
        Update: {
          approved_fact?: string | null;
          claim_kind?: Database["public"]["Enums"]["claim_kind"];
          claim_text?: string;
          company_id?: string;
          draft_version_id?: string;
          finding_id?: string | null;
          id?: string;
          span_end?: number | null;
          span_start?: number | null;
          support_status?: Database["public"]["Enums"]["claim_support"];
        };
        Relationships: [
          {
            foreignKeyName: "draft_claims_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_claims_draft_version_id_fkey";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      draft_versions: {
        Row: {
          alternative_hooks: string[];
          author_kind: Database["public"]["Enums"]["draft_author_kind"];
          body: string;
          body_normalized_hash: string;
          change_note: string;
          company_id: string;
          created_at: string;
          created_by: string | null;
          draft_id: string;
          fingerprint: NonNullable<Json>;
          founder_id: string;
          generation_run_id: string | null;
          id: string;
          parent_version_id: string | null;
          placeholder_count: number;
          rationale: string;
          selected_hook_index: number | null;
          version_no: number;
          voice_profile_version_id: string | null;
        };
        ComputedFields: never;
        Insert: {
          alternative_hooks?: string[];
          author_kind: Database["public"]["Enums"]["draft_author_kind"];
          body: string;
          body_normalized_hash?: string;
          change_note?: string;
          company_id: string;
          created_at?: string;
          created_by?: string | null;
          draft_id: string;
          fingerprint?: NonNullable<Json>;
          founder_id: string;
          generation_run_id?: string | null;
          id?: string;
          parent_version_id?: string | null;
          placeholder_count?: number;
          rationale?: string;
          selected_hook_index?: number | null;
          version_no: number;
          voice_profile_version_id?: string | null;
        };
        Update: {
          alternative_hooks?: string[];
          author_kind?: Database["public"]["Enums"]["draft_author_kind"];
          body?: string;
          body_normalized_hash?: string;
          change_note?: string;
          company_id?: string;
          created_at?: string;
          created_by?: string | null;
          draft_id?: string;
          fingerprint?: NonNullable<Json>;
          founder_id?: string;
          generation_run_id?: string | null;
          id?: string;
          parent_version_id?: string | null;
          placeholder_count?: number;
          rationale?: string;
          selected_hook_index?: number | null;
          version_no?: number;
          voice_profile_version_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "draft_versions_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_versions_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "draft_versions_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_versions_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_versions_generation_run_id_fkey";
            columns: ["generation_run_id"];
            isOneToOne: false;
            referencedRelation: "generation_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_versions_parent_version_id_fkey";
            columns: ["parent_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "draft_versions_voice_profile_version_id_fkey";
            columns: ["voice_profile_version_id"];
            isOneToOne: false;
            referencedRelation: "voice_profile_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      drafts: {
        Row: {
          brief_version_id: string;
          company_id: string;
          concept_id: string | null;
          created_at: string;
          created_by: string | null;
          current_version_id: string | null;
          founder_id: string;
          generation_run_id: string | null;
          id: string;
          is_external: boolean;
          proposed_date: string | null;
          scheduled_for: string | null;
          shared_with_founder_at: string | null;
          status: Database["public"]["Enums"]["draft_status"];
          superseded_by_draft_id: string | null;
          target_month: string;
          updated_at: string;
        };
        ComputedFields: never;
        Insert: {
          brief_version_id: string;
          company_id: string;
          concept_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          founder_id: string;
          generation_run_id?: string | null;
          id?: string;
          is_external?: boolean;
          proposed_date?: string | null;
          scheduled_for?: string | null;
          shared_with_founder_at?: string | null;
          status?: Database["public"]["Enums"]["draft_status"];
          superseded_by_draft_id?: string | null;
          target_month: string;
          updated_at?: string;
        };
        Update: {
          brief_version_id?: string;
          company_id?: string;
          concept_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          current_version_id?: string | null;
          founder_id?: string;
          generation_run_id?: string | null;
          id?: string;
          is_external?: boolean;
          proposed_date?: string | null;
          scheduled_for?: string | null;
          shared_with_founder_at?: string | null;
          status?: Database["public"]["Enums"]["draft_status"];
          superseded_by_draft_id?: string | null;
          target_month?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "drafts_brief_version_id_fkey";
            columns: ["brief_version_id"];
            isOneToOne: false;
            referencedRelation: "brief_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_concept_id_fkey";
            columns: ["concept_id"];
            isOneToOne: false;
            referencedRelation: "concepts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "drafts_current_version_fk";
            columns: ["current_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_generation_run_id_fkey";
            columns: ["generation_run_id"];
            isOneToOne: false;
            referencedRelation: "generation_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "drafts_superseded_by_draft_id_fkey";
            columns: ["superseded_by_draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["id"];
          },
        ];
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
      generation_runs: {
        Row: {
          actual_cost_usd: number | null;
          attempt: number;
          cache_read_tokens: number;
          cache_write_tokens: number;
          company_id: string;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          estimated_cost_usd: number;
          finished_at: string | null;
          founder_id: string | null;
          id: string;
          idempotency_key: string;
          input_refs: NonNullable<Json>;
          input_tokens: number;
          kind: Database["public"]["Enums"]["generation_kind"];
          model: string;
          output_tokens: number;
          params: NonNullable<Json>;
          prompt_template: string;
          prompt_template_version: number;
          provider: string;
          requested_by: string | null;
          run_after: string;
          served_model: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["generation_status"];
          target_month: string | null;
        };
        ComputedFields: never;
        Insert: {
          actual_cost_usd?: number | null;
          attempt?: number;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          company_id: string;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          estimated_cost_usd: number;
          finished_at?: string | null;
          founder_id?: string | null;
          id?: string;
          idempotency_key: string;
          input_refs?: NonNullable<Json>;
          input_tokens?: number;
          kind: Database["public"]["Enums"]["generation_kind"];
          model: string;
          output_tokens?: number;
          params?: NonNullable<Json>;
          prompt_template: string;
          prompt_template_version: number;
          provider: string;
          requested_by?: string | null;
          run_after?: string;
          served_model?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["generation_status"];
          target_month?: string | null;
        };
        Update: {
          actual_cost_usd?: number | null;
          attempt?: number;
          cache_read_tokens?: number;
          cache_write_tokens?: number;
          company_id?: string;
          created_at?: string;
          error_code?: string | null;
          error_message?: string | null;
          estimated_cost_usd?: number;
          finished_at?: string | null;
          founder_id?: string | null;
          id?: string;
          idempotency_key?: string;
          input_refs?: NonNullable<Json>;
          input_tokens?: number;
          kind?: Database["public"]["Enums"]["generation_kind"];
          model?: string;
          output_tokens?: number;
          params?: NonNullable<Json>;
          prompt_template?: string;
          prompt_template_version?: number;
          provider?: string;
          requested_by?: string | null;
          run_after?: string;
          served_model?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["generation_status"];
          target_month?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "generation_runs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generation_runs_founder_id_fkey";
            columns: ["founder_id"];
            isOneToOne: false;
            referencedRelation: "founders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "generation_runs_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
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
      repetition_checks: {
        Row: {
          company_id: string;
          compared_id: string;
          compared_type: string;
          created_at: string;
          explanation: string;
          id: string;
          method: string;
          score: number | null;
          subject_id: string;
          subject_type: string;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          compared_id: string;
          compared_type: string;
          created_at?: string;
          explanation?: string;
          id?: string;
          method: string;
          score?: number | null;
          subject_id: string;
          subject_type: string;
        };
        Update: {
          company_id?: string;
          compared_id?: string;
          compared_type?: string;
          created_at?: string;
          explanation?: string;
          id?: string;
          method?: string;
          score?: number | null;
          subject_id?: string;
          subject_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "repetition_checks_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      review_flags: {
        Row: {
          company_id: string;
          compared_id: string | null;
          compared_type: string | null;
          created_at: string;
          draft_version_id: string;
          id: string;
          kind: Database["public"]["Enums"]["flag_kind"];
          message: string;
          resolution_note: string | null;
          resolved_at: string | null;
          resolved_by: string | null;
          severity: Database["public"]["Enums"]["flag_severity"];
          source: string;
          span_end: number | null;
          span_start: number | null;
          status: Database["public"]["Enums"]["flag_status"];
          visible_to_founder: boolean;
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          compared_id?: string | null;
          compared_type?: string | null;
          created_at?: string;
          draft_version_id: string;
          id?: string;
          kind: Database["public"]["Enums"]["flag_kind"];
          message: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity: Database["public"]["Enums"]["flag_severity"];
          source: string;
          span_end?: number | null;
          span_start?: number | null;
          status?: Database["public"]["Enums"]["flag_status"];
          visible_to_founder?: boolean;
        };
        Update: {
          company_id?: string;
          compared_id?: string | null;
          compared_type?: string | null;
          created_at?: string;
          draft_version_id?: string;
          id?: string;
          kind?: Database["public"]["Enums"]["flag_kind"];
          message?: string;
          resolution_note?: string | null;
          resolved_at?: string | null;
          resolved_by?: string | null;
          severity?: Database["public"]["Enums"]["flag_severity"];
          source?: string;
          span_end?: number | null;
          span_start?: number | null;
          status?: Database["public"]["Enums"]["flag_status"];
          visible_to_founder?: boolean;
        };
        Relationships: [
          {
            foreignKeyName: "review_flags_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_flags_draft_version_id_fkey";
            columns: ["draft_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "review_flags_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
        ];
      };
      rewrite_requests: {
        Row: {
          company_id: string;
          completed_at: string | null;
          created_at: string;
          draft_id: string;
          generation_run_id: string | null;
          id: string;
          instructions: string;
          requested_by: string | null;
          resulting_version_id: string | null;
          status: Database["public"]["Enums"]["rewrite_status"];
        };
        ComputedFields: never;
        Insert: {
          company_id: string;
          completed_at?: string | null;
          created_at?: string;
          draft_id: string;
          generation_run_id?: string | null;
          id?: string;
          instructions: string;
          requested_by?: string | null;
          resulting_version_id?: string | null;
          status?: Database["public"]["Enums"]["rewrite_status"];
        };
        Update: {
          company_id?: string;
          completed_at?: string | null;
          created_at?: string;
          draft_id?: string;
          generation_run_id?: string | null;
          id?: string;
          instructions?: string;
          requested_by?: string | null;
          resulting_version_id?: string | null;
          status?: Database["public"]["Enums"]["rewrite_status"];
        };
        Relationships: [
          {
            foreignKeyName: "rewrite_requests_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rewrite_requests_draft_id_fkey";
            columns: ["draft_id"];
            isOneToOne: false;
            referencedRelation: "drafts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rewrite_requests_generation_run_id_fkey";
            columns: ["generation_run_id"];
            isOneToOne: false;
            referencedRelation: "generation_runs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "rewrite_requests_requested_by_fkey";
            columns: ["requested_by"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["user_id"];
          },
          {
            foreignKeyName: "rewrite_requests_resulting_version_id_fkey";
            columns: ["resulting_version_id"];
            isOneToOne: false;
            referencedRelation: "draft_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      settings: {
        Row: {
          ai_monthly_budget_usd: number;
          ai_per_run_ceiling_usd: number;
          allowed_email_domains: string[];
          company_id: string;
          updated_at: string;
          updated_by: string | null;
        };
        ComputedFields: never;
        Insert: {
          ai_monthly_budget_usd?: number;
          ai_per_run_ceiling_usd?: number;
          allowed_email_domains?: string[];
          company_id: string;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: {
          ai_monthly_budget_usd?: number;
          ai_per_run_ceiling_usd?: number;
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
      add_comment: {
        Args: {
          p_body: string;
          p_draft_id: string;
          p_quote: string;
          p_visibility: Database["public"]["Enums"]["comment_visibility"];
        };
        Returns: string;
      };
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
      ai_spend_summary: {
        Args: Record<PropertyKey, never>;
        Returns: {
          monthly_budget_usd: number;
          per_run_ceiling_usd: number;
          spent_usd: number;
        }[];
      };
      approve_draft: { Args: { p_draft_id: string; p_note: string; p_version_id: string }; Returns: string };
      claim_generation_run: {
        Args: { p_run_id?: string };
        Returns: {
          actual_cost_usd: number | null;
          attempt: number;
          cache_read_tokens: number;
          cache_write_tokens: number;
          company_id: string;
          created_at: string;
          error_code: string | null;
          error_message: string | null;
          estimated_cost_usd: number;
          finished_at: string | null;
          founder_id: string | null;
          id: string;
          idempotency_key: string;
          input_refs: NonNullable<Json>;
          input_tokens: number;
          kind: Database["public"]["Enums"]["generation_kind"];
          model: string;
          output_tokens: number;
          params: NonNullable<Json>;
          prompt_template: string;
          prompt_template_version: number;
          provider: string;
          requested_by: string | null;
          run_after: string;
          served_model: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["generation_status"];
          target_month: string | null;
        }[];
        SetofOptions: {
          from: "*";
          to: "generation_runs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      complete_concept_run: {
        Args: { p_concepts: Json; p_run_id: string; p_served_model: string; p_usage: Json };
        Returns: number;
      };
      complete_draft_run: {
        Args: { p_payload: Json; p_run_id: string; p_served_model: string; p_usage: Json };
        Returns: string;
      };
      complete_feedback_run: {
        Args: { p_run_id: string; p_served_model: string; p_signals: Json; p_usage: Json };
        Returns: number;
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
      fail_generation_run: {
        Args: {
          p_error_code: string;
          p_error_message: string;
          p_retry_after_seconds: number;
          p_run_id: string;
          p_usage: Json;
        };
        Returns: Database["public"]["Enums"]["generation_status"];
      };
      founder_brief: {
        Args: { p_month: string };
        Returns: {
          emphasis: string;
          month: string;
          theme: string;
          version_no: number;
        }[];
      };
      founder_comments: {
        Args: { p_draft_id: string };
        Returns: {
          author_role: Database["public"]["Enums"]["user_role"];
          body: string;
          created_at: string;
          id: string;
          quote: string;
          resolved: boolean;
          version_no: number;
        }[];
      };
      founder_draft_flags: {
        Args: { p_draft_id: string };
        Returns: {
          id: string;
          kind: Database["public"]["Enums"]["flag_kind"];
          message: string;
          quote: string;
          severity: Database["public"]["Enums"]["flag_severity"];
          status: Database["public"]["Enums"]["flag_status"];
        }[];
      };
      founder_draft_versions: {
        Args: { p_draft_id: string };
        Returns: {
          alternative_hooks: string[];
          author_kind: Database["public"]["Enums"]["draft_author_kind"];
          body: string;
          change_note: string;
          created_at: string;
          id: string;
          is_current: boolean;
          placeholder_count: number;
          selected_hook_index: number;
          version_no: number;
        }[];
      };
      founder_drafts: {
        Args: Record<PropertyKey, never>;
        Returns: {
          approved: boolean;
          id: string;
          shared_at: string;
          status: Database["public"]["Enums"]["draft_status"];
          target_month: string;
          title: string;
          updated_at: string;
          version_no: number;
        }[];
      };
      founder_reject_draft: { Args: { p_draft_id: string; p_note: string }; Returns: undefined };
      founder_rewrite_requests: {
        Args: { p_draft_id: string };
        Returns: {
          created_at: string;
          id: string;
          instructions: string;
          status: Database["public"]["Enums"]["rewrite_status"];
        }[];
      };
      founder_save_version: { Args: { p_body: string; p_change_note: string; p_draft_id: string }; Returns: number };
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
      repetition_candidates: {
        Args: {
          p_argument_key: string;
          p_company_id: string;
          p_exclude_concept_id: string;
          p_exclude_draft_id: string;
          p_month: string;
          p_text: string;
        };
        Returns: {
          compared_id: string;
          compared_type: string;
          excerpt: string;
          founder_id: string;
          same_argument: boolean;
          similarity: number;
        }[];
      };
      request_changes: { Args: { p_comment: string; p_draft_id: string }; Returns: undefined };
      request_generation: {
        Args: {
          p_estimated_cost_usd: number;
          p_founder_id: string;
          p_idempotency_key: string;
          p_input_refs: Json;
          p_kind: Database["public"]["Enums"]["generation_kind"];
          p_model: string;
          p_params: Json;
          p_prompt_template: string;
          p_prompt_template_version: number;
          p_provider: string;
          p_target_month: string;
        };
        Returns: {
          message: string;
          run_id: string;
          run_status: Database["public"]["Enums"]["generation_status"];
        }[];
      };
      request_rewrite: {
        Args: { p_draft_id: string; p_idempotency_key: string; p_instructions: string };
        Returns: {
          message: string;
          request_id: string;
          run_id: string;
          run_status: Database["public"]["Enums"]["generation_status"];
        }[];
      };
      requeue_stale_runs: { Args: { p_older_than?: string }; Returns: number };
      resolve_comment: { Args: { p_comment_id: string }; Returns: undefined };
      resolve_review_flag: { Args: { p_action: string; p_flag_id: string; p_note: string }; Returns: undefined };
      review_feedback_signal: { Args: { p_decision: string; p_note: string; p_signal_id: string }; Returns: undefined };
      revoke_approval: { Args: { p_draft_id: string; p_reason: string }; Returns: undefined };
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
      save_draft_version: {
        Args: {
          p_alternative_hooks: string[];
          p_body: string;
          p_change_note: string;
          p_claims: Json;
          p_draft_id: string;
          p_flags: Json;
          p_selected_hook_index: number;
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
      set_concept_status: {
        Args: { p_concept_id: string; p_status: Database["public"]["Enums"]["concept_status"] };
        Returns: undefined;
      };
      set_run_input_refs: { Args: { p_refs: Json; p_run_id: string }; Returns: undefined };
      share_draft: { Args: { p_draft_id: string; p_visible_flag_ids: string[] }; Returns: undefined };
      sync_calendar_slots: {
        Args: { p_founder_id: string; p_month: string; p_slots: Json; p_today: string };
        Returns: Json;
      };
      transition_draft: {
        Args: { p_draft_id: string; p_reason: string; p_to: Database["public"]["Enums"]["draft_status"] };
        Returns: undefined;
      };
      update_concept: {
        Args: {
          p_audience: string;
          p_concept_id: string;
          p_core_argument: string;
          p_evidence_requirements: string[];
          p_format: Database["public"]["Enums"]["post_format"];
          p_hook: string;
          p_title: string;
          p_why_this_founder: string;
        };
        Returns: undefined;
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
      approval_decision: "approved" | "rejected";
      cadence_period: "week" | "month";
      claim_kind: "sourced_fact" | "opinion" | "interpretation" | "founder_experience";
      claim_support: "supported" | "weak" | "unsupported" | "disputed" | "not_applicable";
      comment_visibility: "shared" | "admin_internal";
      concept_status: "proposed" | "selected" | "drafted" | "rejected" | "archived";
      draft_author_kind: "ai" | "admin" | "founder";
      draft_status:
        | "drafting"
        | "admin_review"
        | "founder_review"
        | "changes_requested"
        | "approved"
        | "scheduled"
        | "published"
        | "rejected"
        | "archived";
      feedback_kind: "stable_preference" | "format_preference" | "one_off" | "editorial_correction";
      feedback_proposer: "system" | "admin";
      feedback_status: "proposed" | "accepted" | "rejected";
      flag_kind:
        | "unsupported_claim"
        | "weak_evidence"
        | "needs_personal_context"
        | "competitor_claim"
        | "product_claim"
        | "repetition"
        | "sensitive_content"
        | "style";
      flag_severity: "blocking" | "warning" | "info";
      flag_status: "open" | "resolved" | "overridden";
      generation_kind:
        | "concept_batch"
        | "concept_regen"
        | "draft"
        | "draft_regen"
        | "rewrite"
        | "research"
        | "finding_extraction"
        | "insight_extraction"
        | "fingerprint"
        | "repetition_judge"
        | "feedback_classification";
      generation_status: "queued" | "running" | "succeeded" | "failed" | "refused" | "cancelled";
      post_format:
        "story" | "opinion" | "how_to" | "data_insight" | "lesson" | "announcement" | "list" | "question" | "other";
      rewrite_status: "requested" | "completed" | "failed";
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
      approval_decision: ["approved", "rejected"],
      cadence_period: ["week", "month"],
      claim_kind: ["sourced_fact", "opinion", "interpretation", "founder_experience"],
      claim_support: ["supported", "weak", "unsupported", "disputed", "not_applicable"],
      comment_visibility: ["shared", "admin_internal"],
      concept_status: ["proposed", "selected", "drafted", "rejected", "archived"],
      draft_author_kind: ["ai", "admin", "founder"],
      draft_status: [
        "drafting",
        "admin_review",
        "founder_review",
        "changes_requested",
        "approved",
        "scheduled",
        "published",
        "rejected",
        "archived",
      ],
      feedback_kind: ["stable_preference", "format_preference", "one_off", "editorial_correction"],
      feedback_proposer: ["system", "admin"],
      feedback_status: ["proposed", "accepted", "rejected"],
      flag_kind: [
        "unsupported_claim",
        "weak_evidence",
        "needs_personal_context",
        "competitor_claim",
        "product_claim",
        "repetition",
        "sensitive_content",
        "style",
      ],
      flag_severity: ["blocking", "warning", "info"],
      flag_status: ["open", "resolved", "overridden"],
      generation_kind: [
        "concept_batch",
        "concept_regen",
        "draft",
        "draft_regen",
        "rewrite",
        "research",
        "finding_extraction",
        "insight_extraction",
        "fingerprint",
        "repetition_judge",
        "feedback_classification",
      ],
      generation_status: ["queued", "running", "succeeded", "failed", "refused", "cancelled"],
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
      rewrite_status: ["requested", "completed", "failed"],
      slot_kind: ["regular", "reserved_timely", "manual"],
      slot_status: ["open", "filled", "skipped"],
      user_role: ["admin", "founder"],
      user_status: ["invited", "active", "deactivated"],
      visibility_scope: ["calendar", "approved_content", "drafts"],
      writing_example_kind: ["published_linkedin", "approved_example", "slack_excerpt", "other"],
    },
  },
} as const;

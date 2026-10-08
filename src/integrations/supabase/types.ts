export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      assignments: {
        Row: {
          brainstorm: string | null;
          chat: Json;
          chosen: string;
          created_at: string;
          draft: string;
          id: string;
          ideas: string;
          instructions: string;
          outline: string | null;
          rubric: string;
          set_id: string | null;
          sources: string;
          title: string;
          understanding: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          brainstorm?: string | null;
          chat?: Json;
          chosen?: string;
          created_at?: string;
          draft?: string;
          id?: string;
          ideas?: string;
          instructions?: string;
          outline?: string | null;
          rubric?: string;
          set_id?: string | null;
          sources?: string;
          title?: string;
          understanding?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          brainstorm?: string | null;
          chat?: Json;
          chosen?: string;
          created_at?: string;
          draft?: string;
          id?: string;
          ideas?: string;
          instructions?: string;
          outline?: string | null;
          rubric?: string;
          set_id?: string | null;
          sources?: string;
          title?: string;
          understanding?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "assignments_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      audio_study_events: {
        Row: {
          content: string;
          context: Json;
          created_at: string;
          id: string;
          kind: string;
          session_id: string;
          user_id: string;
        };
        Insert: {
          content?: string;
          context?: Json;
          created_at?: string;
          id?: string;
          kind: string;
          session_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          context?: Json;
          created_at?: string;
          id?: string;
          kind?: string;
          session_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audio_study_events_session_id_fkey";
            columns: ["session_id"];
            isOneToOne: false;
            referencedRelation: "audio_study_sessions";
            referencedColumns: ["id"];
          },
        ];
      };
      audio_study_sessions: {
        Row: {
          audio_error: string | null;
          audio_paths: string[];
          completed: boolean;
          created_at: string;
          duration_seconds: number;
          id: string;
          mode: string;
          position_seconds: number;
          request_key: string | null;
          script: string;
          section_index: number;
          sections: Json;
          set_id: string;
          status: string;
          title: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          audio_error?: string | null;
          audio_paths?: string[];
          completed?: boolean;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          mode: string;
          position_seconds?: number;
          request_key?: string | null;
          script?: string;
          section_index?: number;
          sections?: Json;
          set_id: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          audio_error?: string | null;
          audio_paths?: string[];
          completed?: boolean;
          created_at?: string;
          duration_seconds?: number;
          id?: string;
          mode?: string;
          position_seconds?: number;
          request_key?: string | null;
          script?: string;
          section_index?: number;
          sections?: Json;
          set_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audio_study_sessions_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      essay_grades: {
        Row: {
          created_at: string;
          essay: string;
          final_score: number | null;
          id: string;
          instructions: string;
          result: Json | null;
          rubric: string;
          set_id: string | null;
          sources: string;
          teacher_notes: string;
          title: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          essay: string;
          final_score?: number | null;
          id?: string;
          instructions?: string;
          result?: Json | null;
          rubric?: string;
          set_id?: string | null;
          sources?: string;
          teacher_notes?: string;
          title?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          essay?: string;
          final_score?: number | null;
          id?: string;
          instructions?: string;
          result?: Json | null;
          rubric?: string;
          set_id?: string | null;
          sources?: string;
          teacher_notes?: string;
          title?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "essay_grades_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      flashcards: {
        Row: {
          answer: string;
          created_at: string;
          due_at: string;
          id: string;
          interval_days: number;
          is_custom: boolean;
          lapses: number;
          last_reviewed_at: string | null;
          position: number;
          question: string;
          reps: number;
          set_id: string;
          status: string;
          topic: string;
          user_id: string;
        };
        Insert: {
          answer: string;
          created_at?: string;
          due_at?: string;
          id?: string;
          interval_days?: number;
          is_custom?: boolean;
          lapses?: number;
          last_reviewed_at?: string | null;
          position?: number;
          question: string;
          reps?: number;
          set_id: string;
          status?: string;
          topic?: string;
          user_id: string;
        };
        Update: {
          answer?: string;
          created_at?: string;
          due_at?: string;
          id?: string;
          interval_days?: number;
          is_custom?: boolean;
          lapses?: number;
          last_reviewed_at?: string | null;
          position?: number;
          question?: string;
          reps?: number;
          set_id?: string;
          status?: string;
          topic?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "flashcards_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      lectures: {
        Row: {
          audio_paths: string[];
          created_at: string;
          duration_seconds: number;
          guide: string | null;
          id: string;
          in_material: boolean;
          notes: string | null;
          set_id: string;
          title: string;
          transcript: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          audio_paths?: string[];
          created_at?: string;
          duration_seconds?: number;
          guide?: string | null;
          id?: string;
          in_material?: boolean;
          notes?: string | null;
          set_id: string;
          title?: string;
          transcript?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          audio_paths?: string[];
          created_at?: string;
          duration_seconds?: number;
          guide?: string | null;
          id?: string;
          in_material?: boolean;
          notes?: string | null;
          set_id?: string;
          title?: string;
          transcript?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "lectures_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      material_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          role: string;
          set_id: string;
          sources: Json | null;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          role: string;
          set_id: string;
          sources?: Json | null;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          role?: string;
          set_id?: string;
          sources?: Json | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "material_messages_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      mistakes: {
        Row: {
          correct_answer: string;
          created_at: string;
          explanation: string;
          id: string;
          key: string;
          last_seen_at: string;
          last_wrong_at: string;
          question: string;
          question_data: Json | null;
          right_streak: number;
          set_id: string;
          source_kind: string;
          status: string;
          student_answer: string;
          topic: string;
          user_id: string;
          wrong_count: number;
        };
        Insert: {
          correct_answer?: string;
          created_at?: string;
          explanation?: string;
          id?: string;
          key: string;
          last_seen_at?: string;
          last_wrong_at?: string;
          question: string;
          question_data?: Json | null;
          right_streak?: number;
          set_id: string;
          source_kind?: string;
          status?: string;
          student_answer?: string;
          topic?: string;
          user_id: string;
          wrong_count?: number;
        };
        Update: {
          correct_answer?: string;
          created_at?: string;
          explanation?: string;
          id?: string;
          key?: string;
          last_seen_at?: string;
          last_wrong_at?: string;
          question?: string;
          question_data?: Json | null;
          right_streak?: number;
          set_id?: string;
          source_kind?: string;
          status?: string;
          student_answer?: string;
          topic?: string;
          user_id?: string;
          wrong_count?: number;
        };
        Relationships: [
          {
            foreignKeyName: "mistakes_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      quiz_attempts: {
        Row: {
          created_at: string;
          difficulty: string;
          duration_seconds: number | null;
          id: string;
          kind: string;
          results: Json;
          score: number;
          set_id: string;
          total: number;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          difficulty?: string;
          duration_seconds?: number | null;
          id?: string;
          kind?: string;
          results?: Json;
          score: number;
          set_id: string;
          total: number;
          user_id: string;
        };
        Update: {
          created_at?: string;
          difficulty?: string;
          duration_seconds?: number | null;
          id?: string;
          kind?: string;
          results?: Json;
          score?: number;
          set_id?: string;
          total?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "quiz_attempts_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      study_activity: {
        Row: {
          count: number;
          created_at: string;
          duration_seconds: number | null;
          id: string;
          kind: string;
          meta: Json | null;
          score: number | null;
          set_id: string | null;
          total: number | null;
          user_id: string;
        };
        Insert: {
          count?: number;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          kind: string;
          meta?: Json | null;
          score?: number | null;
          set_id?: string | null;
          total?: number | null;
          user_id: string;
        };
        Update: {
          count?: number;
          created_at?: string;
          duration_seconds?: number | null;
          id?: string;
          kind?: string;
          meta?: Json | null;
          score?: number | null;
          set_id?: string | null;
          total?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_activity_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      study_files: {
        Row: {
          chars: number;
          created_at: string;
          id: string;
          mime: string;
          name: string;
          path: string;
          set_id: string;
          size: number;
          user_id: string;
        };
        Insert: {
          chars?: number;
          created_at?: string;
          id?: string;
          mime?: string;
          name: string;
          path: string;
          set_id: string;
          size?: number;
          user_id: string;
        };
        Update: {
          chars?: number;
          created_at?: string;
          id?: string;
          mime?: string;
          name?: string;
          path?: string;
          set_id?: string;
          size?: number;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "study_files_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
      study_sets: {
        Row: {
          created_at: string;
          custom_instructions: string;
          description: string;
          error: string | null;
          exam_date: string | null;
          id: string;
          material_filename: string | null;
          material_source: string;
          material_text: string;
          minutes_per_day: number | null;
          name: string;
          notes: string | null;
          plan: Json | null;
          quiz_score: number | null;
          quiz_total: number | null;
          status: string;
          study_guide: string | null;
          study_guide_at: string | null;
          subject: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          custom_instructions?: string;
          description?: string;
          error?: string | null;
          exam_date?: string | null;
          id?: string;
          material_filename?: string | null;
          material_source?: string;
          material_text?: string;
          minutes_per_day?: number | null;
          name: string;
          notes?: string | null;
          plan?: Json | null;
          quiz_score?: number | null;
          quiz_total?: number | null;
          status?: string;
          study_guide?: string | null;
          study_guide_at?: string | null;
          subject?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          created_at?: string;
          custom_instructions?: string;
          description?: string;
          error?: string | null;
          exam_date?: string | null;
          id?: string;
          material_filename?: string | null;
          material_source?: string;
          material_text?: string;
          minutes_per_day?: number | null;
          name?: string;
          notes?: string | null;
          plan?: Json | null;
          quiz_score?: number | null;
          quiz_total?: number | null;
          status?: string;
          study_guide?: string | null;
          study_guide_at?: string | null;
          subject?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      trash: {
        Row: {
          created_at: string;
          data: Json;
          id: string;
          kind: string;
          label: string;
          set_id: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          data?: Json;
          id?: string;
          kind: string;
          label?: string;
          set_id?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string;
          data?: Json;
          id?: string;
          kind?: string;
          label?: string;
          set_id?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      tutor_messages: {
        Row: {
          content: string;
          created_at: string;
          id: string;
          role: string;
          set_id: string;
          user_id: string;
        };
        Insert: {
          content: string;
          created_at?: string;
          id?: string;
          role: string;
          set_id: string;
          user_id: string;
        };
        Update: {
          content?: string;
          created_at?: string;
          id?: string;
          role?: string;
          set_id?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "tutor_messages_set_id_fkey";
            columns: ["set_id"];
            isOneToOne: false;
            referencedRelation: "study_sets";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
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
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
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
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

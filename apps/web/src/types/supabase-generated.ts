export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          key: string
          value: string
        }
        Insert: {
          key: string
          value: string
        }
        Update: {
          key?: string
          value?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          deleted_at: string | null
          id: string
          name: string
          sync_seq: number
          updated_at: string
        }
        Insert: {
          deleted_at?: string | null
          id?: string
          name: string
          sync_seq?: number
          updated_at?: string
        }
        Update: {
          deleted_at?: string | null
          id?: string
          name?: string
          sync_seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          barcode: string | null
          category_id: string | null
          deleted_at: string | null
          emoji: string | null
          expiry_date: string | null
          id: string
          image_url: string | null
          name: string
          price: number
          stock: number
          sync_seq: number
          updated_at: string
        }
        Insert: {
          barcode?: string | null
          category_id?: string | null
          deleted_at?: string | null
          emoji?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          name: string
          price: number
          stock?: number
          sync_seq?: number
          updated_at?: string
        }
        Update: {
          barcode?: string | null
          category_id?: string | null
          deleted_at?: string | null
          emoji?: string | null
          expiry_date?: string | null
          id?: string
          image_url?: string | null
          name?: string
          price?: number
          stock?: number
          sync_seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          first_name: string
          full_name: string | null
          id: string
          last_name: string
          pin_code: string
          preferred_language: string
          role: Database["public"]["Enums"]["user_role"]
          sync_seq: number
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          first_name?: string
          full_name?: string | null
          id: string
          last_name?: string
          pin_code: string
          preferred_language?: string
          role: Database["public"]["Enums"]["user_role"]
          sync_seq?: number
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          first_name?: string
          full_name?: string | null
          id?: string
          last_name?: string
          pin_code?: string
          preferred_language?: string
          role?: Database["public"]["Enums"]["user_role"]
          sync_seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          device_label: string | null
          endpoint: string
          id: string
          last_used_at: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          device_label?: string | null
          endpoint: string
          id?: string
          last_used_at?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          device_label?: string | null
          endpoint?: string
          id?: string
          last_used_at?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      sale_items: {
        Row: {
          id: string
          product_id: string
          quantity: number
          sale_id: string
          sync_seq: number
          unit_price: number
          updated_at: string
        }
        Insert: {
          id?: string
          product_id: string
          quantity: number
          sale_id: string
          sync_seq?: number
          unit_price: number
          updated_at?: string
        }
        Update: {
          id?: string
          product_id?: string
          quantity?: number
          sale_id?: string
          sync_seq?: number
          unit_price?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          cashier_id: string
          created_at: string
          device_label: string | null
          id: string
          id_text: string | null
          momo_verification_status: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          status: Database["public"]["Enums"]["sale_status"]
          student_id: string | null
          sync_seq: number
          total_amount: number
          updated_at: string
        }
        Insert: {
          cashier_id: string
          created_at?: string
          device_label?: string | null
          id?: string
          id_text?: string | null
          momo_verification_status?: string | null
          payment_method: Database["public"]["Enums"]["payment_method"]
          status?: Database["public"]["Enums"]["sale_status"]
          student_id?: string | null
          sync_seq?: number
          total_amount: number
          updated_at?: string
        }
        Update: {
          cashier_id?: string
          created_at?: string
          device_label?: string | null
          id?: string
          id_text?: string | null
          momo_verification_status?: string | null
          payment_method?: Database["public"]["Enums"]["payment_method"]
          status?: Database["public"]["Enums"]["sale_status"]
          student_id?: string | null
          sync_seq?: number
          total_amount?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sales_cashier_id_fkey"
            columns: ["cashier_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sales_student_wallet_id_fkey"
            columns: ["student_id"]
            isOneToOne: false
            referencedRelation: "student_wallets"
            referencedColumns: ["id"]
          },
        ]
      }
      shop_status: {
        Row: {
          id: number
          is_open: boolean
          sync_seq: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: number
          is_open?: boolean
          sync_seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: number
          is_open?: boolean
          sync_seq?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "shop_status_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      student_wallets: {
        Row: {
          badge_code: string
          balance: number
          email: string | null
          email_opt_in: boolean
          id: string
          phone: string | null
          student_name: string
          sync_seq: number
          updated_at: string
        }
        Insert: {
          badge_code: string
          balance?: number
          email?: string | null
          email_opt_in?: boolean
          id?: string
          phone?: string | null
          student_name: string
          sync_seq?: number
          updated_at?: string
        }
        Update: {
          badge_code?: string
          balance?: number
          email?: string | null
          email_opt_in?: boolean
          id?: string
          phone?: string | null
          student_name?: string
          sync_seq?: number
          updated_at?: string
        }
        Relationships: []
      }
      sync_events: {
        Row: {
          context: Json | null
          device_id: string | null
          entity_id: string | null
          entity_table: string | null
          event_type: string
          id: string
          message: string | null
          occurred_at: string
          operation_id: string | null
          pg_error_code: string | null
          profile_id: string | null
          session_id: string | null
          severity: string
        }
        Insert: {
          context?: Json | null
          device_id?: string | null
          entity_id?: string | null
          entity_table?: string | null
          event_type: string
          id?: string
          message?: string | null
          occurred_at?: string
          operation_id?: string | null
          pg_error_code?: string | null
          profile_id?: string | null
          session_id?: string | null
          severity: string
        }
        Update: {
          context?: Json | null
          device_id?: string | null
          entity_id?: string | null
          entity_table?: string | null
          event_type?: string
          id?: string
          message?: string | null
          occurred_at?: string
          operation_id?: string | null
          pg_error_code?: string | null
          profile_id?: string | null
          session_id?: string | null
          severity?: string
        }
        Relationships: []
      }
      sync_operations: {
        Row: {
          created_at: string
          created_by: string | null
          entity_id: string | null
          entity_table: string | null
          id: string
          op_type: string
          outcome: string
          result: Json | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_table?: string | null
          id: string
          op_type: string
          outcome: string
          result?: Json | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          entity_id?: string | null
          entity_table?: string | null
          id?: string
          op_type?: string
          outcome?: string
          result?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      adjust_product_stock: {
        Args: {
          p_delta: number
          p_operation_id: string
          p_product_id: string
          p_reason?: string
        }
        Returns: Json
      }
      adjust_wallet_balance:
        | {
            Args: {
              p_delta: number
              p_operation_id: string
              p_reason?: string
              p_wallet_id: string
            }
            Returns: Json
          }
        | {
            Args: { p_delta: number; p_wallet_id: string }
            Returns: {
              badge_code: string
              balance: number
              email: string | null
              email_opt_in: boolean
              id: string
              phone: string | null
              student_name: string
              sync_seq: number
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "student_wallets"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      complete_sale:
        | {
            Args: { p_items: Json; p_operation_id: string; p_sale: Json }
            Returns: Json
          }
        | {
            Args: { p_items: Json; p_sale: Json }
            Returns: {
              cashier_id: string
              created_at: string
              device_label: string | null
              id: string
              id_text: string | null
              momo_verification_status: string | null
              payment_method: Database["public"]["Enums"]["payment_method"]
              status: Database["public"]["Enums"]["sale_status"]
              student_id: string | null
              sync_seq: number
              total_amount: number
              updated_at: string
            }
            SetofOptions: {
              from: "*"
              to: "sales"
              isOneToOne: true
              isSetofReturn: false
            }
          }
      current_role: {
        Args: never
        Returns: Database["public"]["Enums"]["user_role"]
      }
      decrement_product_stock: {
        Args: { p_product_id: string; p_quantity: number }
        Returns: {
          barcode: string | null
          category_id: string | null
          deleted_at: string | null
          emoji: string | null
          expiry_date: string | null
          id: string
          image_url: string | null
          name: string
          price: number
          stock: number
          sync_seq: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      get_public_receipt: { Args: { p_sale_id: string }; Returns: Json }
      oauth_provider_linked: {
        Args: { provider_name: string }
        Returns: boolean
      }
      update_own_pin_code: { Args: { new_pin: string }; Returns: undefined }
      void_sale: {
        Args: { p_admin_id: string; p_operation_id: string; p_sale_id: string }
        Returns: Json
      }
    }
    Enums: {
      payment_method: "cash" | "momo_mtn" | "momo_orange" | "student_wallet"
      sale_status:
        | "completed"
        | "pending_sync"
        | "conflict_warning"
        | "refunded"
      user_role: "admin" | "cashier"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      payment_method: ["cash", "momo_mtn", "momo_orange", "student_wallet"],
      sale_status: [
        "completed",
        "pending_sync",
        "conflict_warning",
        "refunded",
      ],
      user_role: ["admin", "cashier"],
    },
  },
} as const


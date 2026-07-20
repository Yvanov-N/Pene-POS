// Hand-authored to mirror supabase/migrations/00001_initial_schema.sql,
// 00002_relax_sync_rls.sql, 00003_push_subscriptions.sql,
// 00004_momo_verification.sql, 00005_sale_refund_status.sql,
// 00006_public_receipt_rpc.sql, 00007_product_categories.sql,
// 00008_student_sale_attribution.sql, 00009_public_receipt_student_name.sql,
// 00010_profile_identity_and_wallet_debt.sql, and
// 00011_avatar_storage_and_account_email_sync.sql.
// Regenerate from the real database once it's stable:
//   supabase gen types typescript --local > src/types/supabase.ts

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = "admin" | "cashier";
export type PaymentMethod = "cash" | "momo_mtn" | "momo_orange" | "student_wallet";
export type SaleStatus = "completed" | "pending_sync" | "conflict_warning" | "refunded";
export type MomoVerificationStatus = "pending" | "confirmed" | "rejected";
export type PreferredLanguage = "fr" | "en";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          // Generated always as trim(first_name || ' ' || last_name) --
          // never sent in an Insert/Update, only ever read back.
          full_name: string;
          first_name: string;
          last_name: string;
          avatar_url: string | null;
          preferred_language: PreferredLanguage;
          role: UserRole;
          pin_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          first_name?: string;
          last_name?: string;
          avatar_url?: string | null;
          preferred_language?: PreferredLanguage;
          role: UserRole;
          pin_code: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      categories: {
        Row: {
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["categories"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          price: number;
          stock: number;
          barcode: string | null;
          category_id: string | null;
          image_url: string | null;
          emoji: string | null;
          expiry_date: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          price: number;
          stock?: number;
          barcode?: string | null;
          category_id?: string | null;
          image_url?: string | null;
          emoji?: string | null;
          expiry_date?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          created_at: string;
          cashier_id: string;
          total_amount: number;
          payment_method: PaymentMethod;
          student_id: string | null;
          status: SaleStatus;
          momo_verification_status: MomoVerificationStatus | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          cashier_id: string;
          total_amount: number;
          payment_method: PaymentMethod;
          student_id?: string | null;
          status?: SaleStatus;
          momo_verification_status?: MomoVerificationStatus | null;
        };
        Update: Partial<Database["public"]["Tables"]["sales"]["Insert"]>;
        Relationships: [];
      };
      sale_items: {
        Row: {
          id: string;
          sale_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
        };
        Insert: {
          id?: string;
          sale_id: string;
          product_id: string;
          quantity: number;
          unit_price: number;
        };
        Update: Partial<Database["public"]["Tables"]["sale_items"]["Insert"]>;
        Relationships: [];
      };
      student_wallets: {
        Row: {
          id: string;
          student_name: string;
          badge_code: string;
          balance: number;
          email: string | null;
          email_opt_in: boolean;
        };
        Insert: {
          id?: string;
          student_name: string;
          badge_code: string;
          balance?: number;
          email?: string | null;
          email_opt_in?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["student_wallets"]["Insert"]>;
        Relationships: [];
      };
      shop_status: {
        Row: {
          id: number;
          is_open: boolean;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          id?: number;
          is_open?: boolean;
          updated_at?: string;
          updated_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["shop_status"]["Insert"]>;
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["push_subscriptions"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      decrement_product_stock: {
        Args: { p_product_id: string; p_quantity: number };
        Returns: Database["public"]["Tables"]["products"]["Row"];
      };
      adjust_wallet_balance: {
        Args: { p_wallet_id: string; p_delta: number };
        Returns: Database["public"]["Tables"]["student_wallets"]["Row"];
      };
      get_public_receipt: {
        Args: { p_sale_id: string };
        Returns: Json | null;
      };
    };
    Enums: {
      user_role: UserRole;
      payment_method: PaymentMethod;
      sale_status: SaleStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

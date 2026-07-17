// Hand-authored to mirror supabase/migrations/00001_initial_schema.sql,
// 00002_relax_sync_rls.sql, 00003_push_subscriptions.sql, and
// 00004_momo_verification.sql. Regenerate from the real database once it's
// stable:
//   supabase gen types typescript --local > src/types/supabase.ts

export type UserRole = "admin" | "cashier";
export type PaymentMethod = "cash" | "momo_mtn" | "momo_orange" | "student_wallet";
export type SaleStatus = "completed" | "pending_sync" | "conflict_warning";
export type MomoVerificationStatus = "pending" | "confirmed" | "rejected";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          pin_code: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email: string;
          full_name: string;
          role: UserRole;
          pin_code: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          price: number;
          stock: number;
          barcode: string | null;
          category: string | null;
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
          category?: string | null;
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
          student_wallet_id: string | null;
          status: SaleStatus;
          momo_verification_status: MomoVerificationStatus | null;
        };
        Insert: {
          id?: string;
          created_at?: string;
          cashier_id: string;
          total_amount: number;
          payment_method: PaymentMethod;
          student_wallet_id?: string | null;
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
        };
        Insert: {
          id?: string;
          student_name: string;
          badge_code: string;
          balance?: number;
          email?: string | null;
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
    };
    Enums: {
      user_role: UserRole;
      payment_method: PaymentMethod;
      sale_status: SaleStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}

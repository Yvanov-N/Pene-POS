import { db } from "@/lib/db";
import type { Product } from "@/types/db";

function daysFromNow(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

const now = new Date().toISOString();

const MOCK_PRODUCTS: Product[] = [
  {
    id: crypto.randomUUID(),
    name: "Coca-Cola 33cl",
    price: 500,
    stock: 40,
    barcode: "6001234567890",
    category: "Boissons",
    emoji: "🥤",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Eau minerale 50cl",
    price: 300,
    stock: 60,
    barcode: "6001234567891",
    category: "Boissons",
    emoji: "💧",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Chips Plantain",
    price: 400,
    stock: 25,
    barcode: "6001234567892",
    category: "Snacks",
    emoji: "🍟",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Biscuits Choco",
    price: 350,
    stock: 2,
    barcode: "6001234567893",
    category: "Snacks",
    emoji: "🍪",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Yaourt Nature",
    price: 450,
    stock: 15,
    barcode: "6001234567894",
    category: "Laiterie",
    emoji: "🥛",
    expiry_date: daysFromNow(3),
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Fromage Fondu",
    price: 600,
    stock: 10,
    barcode: "6001234567895",
    category: "Laiterie",
    emoji: "🧀",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Recharge MoMo 1000F",
    price: 1000,
    stock: 999,
    barcode: "6001234567896",
    category: "Recharge",
    emoji: "💳",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Sardine Boite",
    price: 550,
    stock: 12,
    barcode: "6001234567897",
    category: "Epicerie",
    emoji: "🐟",
    updated_at: now,
  },
  {
    id: crypto.randomUUID(),
    name: "Savon",
    price: 250,
    stock: 0,
    barcode: "6001234567898",
    category: "Hygiene",
    emoji: "🧼",
    updated_at: now,
  },
];

export async function seedLocalProducts(): Promise<void> {
  const existing = await db.products.count();
  if (existing > 0) return;
  await db.products.bulkPut(MOCK_PRODUCTS);
}
